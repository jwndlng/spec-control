// The shared OpenSpec config: named profiles of guidance for agents (`context`, per-artifact `rules`) kept once in the
// dashboard home and merged into many repositories' `openspec/config.yaml`.
//
// Shared content lives in *managed sections* that are recognisable in the file itself — one delimited block per profile
// at the start of the `context` text, and rule entries carrying a marker comment with the profile id. Which profiles a
// repository carries, and whether they are current, is therefore derived from the repository alone, and everything
// outside the markers stays the project's own. Applying is the only operation here that writes to a tracked
// repository; it touches nothing but those sections of that one file.
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isMap, isScalar, isSeq, parseDocument, Scalar, YAMLSeq } from "yaml";
import type { AppliedProfile, RepoConfig, RepoSharedConfig, SharedConfig, SharedConfigApplyResult, SharedConfigPreview, SharedProfile } from "../shared/types.ts";
import { sharedConfigPath } from "./paths.ts";
import { boundedReadWarning, linkedSegment, MAX_REPO_FILE_BYTES, readBounded } from "./source.ts";

export const MARKER = "spec-control:shared";
/** Written by versions before the rename. Still read as a managed section; never written. */
export const FORMER_MARKER = "openspec-dashboard:shared";
const MARKERS = [MARKER, FORMER_MARKER];
/** OpenSpec ignores `context` entirely above this many UTF-8 bytes. */
export const MAX_CONTEXT_BYTES = 50 * 1024;

const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ARTIFACT_ID = /^[A-Za-z0-9._-]+$/;
const PREFIX = `(${MARKERS.join("|")})`;
const BEGIN_LINE = new RegExp(`^<!-- ${PREFIX}:begin ([a-z0-9-]+)\\b.*-->$`);
const END_LINE = new RegExp(`^<!-- ${PREFIX}:end ([a-z0-9-]+) -->$`);
const RULE_COMMENT = new RegExp(`^${PREFIX}:([a-z0-9-]+)$`);

export const contextBegin = (id: string) => `<!-- ${MARKER}:begin ${id} — managed by spec-control, edits here are overwritten -->`;
export const contextEnd = (id: string) => `<!-- ${MARKER}:end ${id} -->`;
export const ruleComment = (id: string) => `${MARKER}:${id}`;

export const EMPTY_SHARED_CONFIG: SharedConfig = { profiles: [] };

export class SharedConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid shared config: ${issues.join("; ")}`);
  }
}

export function validateSharedConfig(body: unknown): SharedConfig {
  const issues: string[] = [];
  const list = (body as { profiles?: unknown } | null)?.profiles;
  if (!Array.isArray(list)) throw new SharedConfigValidationError(["profiles: must be a list"]);
  const profiles: SharedProfile[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of list.entries()) {
    const at = `profiles.${i}`;
    const input = (raw ?? {}) as { id?: unknown; name?: unknown; context?: unknown; rules?: unknown };
    if (typeof input.id !== "string" || !PROFILE_ID.test(input.id)) issues.push(`${at}.id: must be a lower-case slug matching ${PROFILE_ID}`);
    else if (seen.has(input.id)) issues.push(`${at}.id: duplicate profile id ${JSON.stringify(input.id)}`);
    else seen.add(input.id);
    if (typeof input.name !== "string" || input.name.trim() === "") issues.push(`${at}.name: must be a non-empty string`);
    if (typeof input.context !== "string") issues.push(`${at}.context: must be a string`);
    // A marker line inside shared text would be read back as a section boundary.
    else for (const marker of MARKERS) if (input.context.includes(marker)) issues.push(`${at}.context: must not contain ${JSON.stringify(marker)}`);
    const rules: Record<string, string[]> = {};
    if (typeof input.rules !== "object" || input.rules === null || Array.isArray(input.rules)) {
      issues.push(`${at}.rules: must be an object of artifact id → list of rules`);
    } else {
      for (const [artifact, entries] of Object.entries(input.rules)) {
        if (!ARTIFACT_ID.test(artifact)) issues.push(`${at}.rules.${JSON.stringify(artifact)}: artifact id must match ${ARTIFACT_ID}`);
        else if (!Array.isArray(entries) || entries.some((r) => typeof r !== "string" || r.trim() === "" || /[\r\n]/.test(r))) issues.push(`${at}.rules.${artifact}: must be a list of non-empty single-line strings`);
        else if (entries.length > 0) rules[artifact] = entries.map((r: string) => r.trim());
      }
    }
    if (issues.length === 0) profiles.push({ id: input.id as string, name: (input.name as string).trim(), context: (input.context as string).trim(), rules });
  }
  if (issues.length) throw new SharedConfigValidationError(issues);
  return { profiles };
}

async function writeAtomic(path: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    if (mode !== undefined) await chmod(tmp, mode);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** The stored shared config, or undefined when none has been saved (or the file is unusable). */
export async function loadSharedConfig(): Promise<SharedConfig | undefined> {
  try {
    return validateSharedConfig(JSON.parse(await readFile(sharedConfigPath(), "utf8")));
  } catch {
    return undefined;
  }
}

export async function saveSharedConfig(body: unknown): Promise<SharedConfig> {
  const valid = validateSharedConfig(body);
  await writeAtomic(sharedConfigPath(), `${JSON.stringify(valid, null, 2)}\n`);
  return valid;
}

/** Managed content found in a file for one profile id. */
interface ManagedProfile {
  /** Text between this profile's context markers; undefined when it has no context block. */
  context?: string;
  rules: Record<string, string[]>;
}

interface Managed {
  /** Profile id → its managed content, in the order the ids first appear in the file. */
  profiles: Map<string, ManagedProfile>;
  /** The project's own context: everything outside the managed blocks. */
  localContext: string;
  /** Some section still carries `FORMER_MARKER`; an apply then rewrites the file even when its content is current. */
  former: boolean;
}

/** Splits a context string into managed blocks and local text. Throws on unbalanced, nested or repeated blocks. */
function splitContext(context: string, into: Map<string, ManagedProfile>): { local: string; former: boolean } {
  const local: string[] = [];
  let former = false;
  let open: { prefix: string; id: string; lines: string[] } | undefined;
  for (const line of context.replace(/\r\n?/g, "\n").split("\n")) {
    const begin = BEGIN_LINE.exec(line.trim());
    const end = END_LINE.exec(line.trim());
    if (begin) {
      if (open || into.get(begin[2])?.context !== undefined) throw new Error("malformed shared-config markers in context");
      open = { prefix: begin[1], id: begin[2], lines: [] };
      former ||= begin[1] === FORMER_MARKER;
    } else if (end) {
      // A block opened with one prefix and closed with the other is as mismatched as two different ids.
      if (!open || open.id !== end[2] || open.prefix !== end[1]) throw new Error("malformed shared-config markers in context");
      into.set(open.id, { ...(into.get(open.id) ?? { rules: {} }), context: open.lines.join("\n") });
      open = undefined;
    } else if (MARKERS.some((m) => line.includes(`${m}:begin`) || line.includes(`${m}:end`))) {
      throw new Error("malformed shared-config markers in context");
    } else {
      (open ? open.lines : local).push(line);
    }
  }
  if (open) throw new Error("malformed shared-config markers in context");
  return { local: local.join("\n"), former };
}

type Doc = ReturnType<typeof parseDocument>;

const ruleMarker = (item: unknown) => (isScalar(item) ? RULE_COMMENT.exec(item.comment?.trim() ?? "") : null);
const profileOfRule = (item: unknown): string | undefined => ruleMarker(item)?.[2];

/** Parses a config and extracts the managed sections. Throws when the file is not something apply may touch. */
function readManaged(text: string): { doc: Doc; managed: Managed } {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`invalid YAML: ${doc.errors[0].message}`);
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error("config is not a YAML mapping");

  const context = doc.get("context");
  if (context !== undefined && context !== null && typeof context !== "string") throw new Error("`context` is not a string");

  const profiles = new Map<string, ManagedProfile>();
  const split = splitContext(typeof context === "string" ? context : "", profiles);
  let former = split.former;

  const rules = doc.get("rules", true);
  if (rules !== undefined && !(isScalar(rules) && rules.value === null)) {
    if (!isMap(rules)) throw new Error("`rules` is not a mapping");
    for (const pair of rules.items) {
      const artifact = String(isScalar(pair.key) ? pair.key.value : pair.key);
      if (pair.value === null || (isScalar(pair.value) && pair.value.value === null)) continue;
      if (!isSeq(pair.value)) throw new Error(`\`rules.${artifact}\` is not a list`);
      for (const item of pair.value.items) {
        const marker = ruleMarker(item);
        if (!marker) continue;
        const id = marker[2];
        former ||= marker[1] === FORMER_MARKER;
        const entry = profiles.get(id) ?? { rules: {} };
        entry.rules[artifact] = [...(entry.rules[artifact] ?? []), String((item as Scalar).value)];
        profiles.set(id, entry);
      }
    }
  }
  return { doc, managed: { profiles, localContext: split.local, former } };
}

function sameRules(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const ids = (r: Record<string, string[]>) => Object.keys(r).filter((id) => r[id].length > 0).sort();
  const [ia, ib] = [ids(a), ids(b)];
  return ia.length === ib.length && ia.every((id, i) => id === ib[i] && a[id].length === b[id].length && a[id].every((rule, j) => rule === b[id][j]));
}

const matches = (found: ManagedProfile, profile: SharedProfile) => (found.context ?? "").trim() === profile.context.trim() && sameRules(found.rules, profile.rules);

/** Pure: which profiles a config file carries and whether they are current. `undefined` text means the file is missing. */
export function repoSharedConfig(text: string | undefined, shared: SharedConfig): RepoSharedConfig {
  if (text === undefined) return { unreadable: true, applied: [] };
  let managed: Managed;
  try {
    ({ managed } = readManaged(text));
  } catch {
    return { unreadable: true, applied: [] };
  }
  const known = new Map(shared.profiles.map((p) => [p.id, p]));
  const applied: AppliedProfile[] = [...managed.profiles].map(([id, found]) => {
    const profile = known.get(id);
    return { id, state: !profile ? "orphaned" : matches(found, profile) ? "in-sync" : "outdated" };
  });
  // dashboard order first, orphans last: stable for the UI whatever the order in the file
  const rank = (id: string) => (known.has(id) ? shared.profiles.findIndex((p) => p.id === id) : shared.profiles.length);
  return { unreadable: false, applied: applied.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id)) };
}

/**
 * Pure: the config text carrying exactly `desired` (in that order) as its managed content — other profiles' sections,
 * orphaned ones included, are removed; an empty list removes everything managed. Other keys, comments, and the
 * project's own context and rules are left as they are. Throws with the reason when the file must not be touched.
 */
export function applyShared(text: string, desired: SharedProfile[]): string {
  const { doc, managed } = readManaged(text);
  const effective = desired.filter((p) => p.context.trim() !== "" || Object.keys(p.rules).length > 0);
  const current = [...managed.profiles];
  const upToDate = current.length === effective.length && effective.every((p, i) => current[i][0] === p.id && matches(current[i][1], p));
  if (upToDate && !managed.former) return text; // never reserialise a file that needs no change

  // context: one block per profile, then the project's own text
  const local = managed.localContext.replace(/^\n+/, "").replace(/\s+$/, "");
  const blocks = effective.filter((p) => p.context.trim() !== "").map((p) => `${contextBegin(p.id)}\n${p.context.trim()}\n${contextEnd(p.id)}\n`);
  const context = [...blocks, ...(local ? [`${local}\n`] : [])].join("\n");
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  if (bytes(context) > MAX_CONTEXT_BYTES) {
    const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
    throw new Error(`context would be ${kb(bytes(context))} (shared ${kb(bytes(blocks.join("\n")))} + the project's own ${kb(bytes(local))}); OpenSpec ignores context above ${kb(MAX_CONTEXT_BYTES)}`);
  }
  if (context) {
    const node = new Scalar(context);
    node.type = Scalar.BLOCK_LITERAL;
    const existing = doc.get("context", true);
    if (isScalar(existing)) {
      node.comment = existing.comment;
      node.commentBefore = existing.commentBefore;
    }
    doc.set("context", node);
  } else if (doc.has("context")) {
    doc.delete("context");
  }

  // rules: marked entries first (profile order), the project's own entries after them, untouched
  const artifacts = new Set([...effective.flatMap((p) => Object.keys(p.rules)), ...current.flatMap(([, found]) => Object.keys(found.rules))]);
  for (const artifact of artifacts) {
    const existing = doc.getIn(["rules", artifact], true);
    const locals = isSeq(existing) ? existing.items.filter((item) => profileOfRule(item) === undefined) : [];
    const marked = effective.flatMap((p) =>
      (p.rules[artifact] ?? []).map((rule) => {
        const node = new Scalar(rule);
        node.comment = ` ${ruleComment(p.id)}`;
        return node;
      }),
    );
    if (marked.length + locals.length === 0) {
      doc.deleteIn(["rules", artifact]);
    } else if (isSeq(existing)) {
      existing.items = [...marked, ...locals];
    } else {
      const seq = new YAMLSeq();
      seq.items = [...marked, ...locals];
      doc.setIn(["rules", artifact], seq);
    }
  }
  const rules = doc.get("rules", true);
  if (isMap(rules) && rules.items.length === 0) doc.delete("rules");

  return doc.toString({ lineWidth: 0 });
}

function configYaml(repo: RepoConfig): string {
  return join(repo.path, "openspec", "config.yaml");
}

/**
 * Why apply must not write this repository's config: `openspec/` must be a real directory and `openspec/config.yaml` a
 * regular file, neither a symbolic link (shared-config spec), checked with `lstat`. Undefined when it may, or when the
 * file is missing — reading it says so.
 */
async function linkRefusal(repo: RepoConfig): Promise<string | undefined> {
  const linked = await linkedSegment(repo.path, "openspec");
  if (linked?.reason === "missing") return undefined;
  if (linked) return `openspec is ${linked.reason === "symbolic link" ? "a symbolic link" : "not a directory"}; only a real openspec/config.yaml is written`;
  const info = await lstat(configYaml(repo)).catch(() => undefined);
  if (info?.isSymbolicLink()) return "openspec/config.yaml is a symbolic link; only a regular file is written";
  if (info && !info.isFile()) return "openspec/config.yaml is not a regular file";
  return undefined;
}

/** The config's text through the scanner's bounded read, or why it cannot be read. */
async function readConfigYaml(repo: RepoConfig): Promise<{ text?: string; refusal?: string }> {
  const read = await readBounded(configYaml(repo), { within: repo.path, maxBytes: MAX_REPO_FILE_BYTES });
  if (read.ok) return { text: read.text };
  return { refusal: boundedReadWarning("openspec/config.yaml", read, MAX_REPO_FILE_BYTES) ?? "openspec/config.yaml does not exist or cannot be read" };
}

/**
 * Renames a new file over `path` (`openspec/config.yaml`): written first to a temporary file beside it whose name is
 * this write's own and that is created exclusively, so two applies never share one; removed whenever the rename did not
 * happen. Nothing else is ever created or removed (dashboard-api "never writes", exception 1).
 */
async function replaceViaTemporary(path: string, content: string, mode: number, io: ApplyIo): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let created = false;
  try {
    await writeFile(tmp, content, { encoding: "utf8", flag: "wx", mode });
    created = true;
    await chmod(tmp, mode);
    await io.rename(tmp, path);
  } catch (err) {
    if (created) await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** File operations apply uses that a test may replace to make one fail. */
export interface ApplyIo {
  rename: (from: string, to: string) => Promise<void>;
}

/** Resolves ids to profiles in dashboard order; unknown ids are an error, not silently dropped. */
export function resolveProfiles(shared: SharedConfig, profileIds: string[]): SharedProfile[] {
  const unknown = profileIds.filter((id) => !shared.profiles.some((p) => p.id === id));
  if (unknown.length) throw new Error(`unknown profile${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
  return shared.profiles.filter((p) => profileIds.includes(p.id));
}

/** Digest of what a preview showed: the file text and the text apply would write. */
export function previewDigest(before: string, after: string): string {
  return createHash("sha256").update(`${before}\0${after}`).digest("hex");
}

export const CHANGED_SINCE_PREVIEW = "the file or the profiles changed since the preview; preview again";

/** What apply would do to one repository. Reads only. `repo` must come from the dashboard config, never a request. */
export async function previewFor(repo: RepoConfig, shared: SharedConfig, profileIds: string[]): Promise<SharedConfigPreview> {
  const linked = await linkRefusal(repo);
  const { text: before, refusal } = linked ? { text: undefined, refusal: linked } : await readConfigYaml(repo);
  const base = { repoId: repo.id, current: repoSharedConfig(before, shared), before: before ?? "" };
  const withDigest = (preview: Omit<SharedConfigPreview, "digest">): SharedConfigPreview => ({ ...preview, digest: previewDigest(preview.before, preview.after) });
  if (before === undefined) return withDigest({ ...base, after: "", refusal });
  try {
    return withDigest({ ...base, after: applyShared(before, resolveProfiles(shared, profileIds)) });
  } catch (err) {
    return withDigest({ ...base, after: before, refusal: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Writes the managed sections into one repository's `openspec/config.yaml`. Re-reads the file and never trusts a
 * preview's text: it writes only what it computes now, and only when that matches the preview's `digest`.
 */
export async function applyTo(repo: RepoConfig, shared: SharedConfig, profileIds: string[], digest: string | undefined, io: ApplyIo = { rename }): Promise<SharedConfigApplyResult> {
  const preview = await previewFor(repo, shared, profileIds);
  if (preview.refusal) return { repoId: repo.id, result: "refused", reason: preview.refusal };
  if (digest !== preview.digest) return { repoId: repo.id, result: "refused", reason: CHANGED_SINCE_PREVIEW };
  if (preview.after === preview.before) return { repoId: repo.id, result: "unchanged" };
  // Checked again immediately before writing: a link may have replaced the file or `openspec/` since the read.
  const linked = await linkRefusal(repo);
  if (linked) return { repoId: repo.id, result: "refused", reason: linked };
  try {
    const mode = (await lstat(configYaml(repo))).mode & 0o777;
    await replaceViaTemporary(configYaml(repo), preview.after, mode, io);
    return { repoId: repo.id, result: "written" };
  } catch (err) {
    return { repoId: repo.id, result: "refused", reason: `could not write: ${err instanceof Error ? err.message : String(err)}` };
  }
}
