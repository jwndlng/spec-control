import { realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { resolveDependencies } from "../shared/dependencies.ts";
import { deriveStage, isPlanned } from "../shared/columns.ts";
import { ISSUE_FILE, toSourceIssue } from "../shared/issues.ts";
import { detectLabels } from "../shared/labels.ts";
import { sessionBranch } from "../shared/sessionBranch.ts";
import type { ChangeRecord, ChangeSnapshot, Config, DetectedLabel, DuplicateAfterArchive, RepoConfig, RepoSnapshot, SharedConfig, Snapshot, StaleLeftovers, Worktree } from "../shared/types.ts";
import { summarizeWorkInProgress } from "../shared/workInProgress.ts";
import { emptySnapshot, writeSnapshot } from "./cache.ts";
import type { FrameworkProject, SpecFramework } from "./frameworks/framework.ts";
import { claimFramework, FRAMEWORKS, unclaimedMessage } from "./frameworks/registry.ts";
import { type ChangeCopy, foldLeftovers, mergeChanges } from "./mergeChanges.ts";
import { worktreesDir } from "./paths.ts";
import { loadSharedConfig, repoSharedConfig } from "./sharedConfig.ts";
import type { SessionHint } from "./staleChanges.ts";
import { type BoundedRead, boundedReadWarning, CHANGE_NAME, LocalRepoSource, MAX_REPO_FILE_BYTES, type ChangeDirEntry, type DirtyFile, type RepoSource } from "./source.ts";

export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_REPO_TIMEOUT_MS = 30_000;
/** Only the most recent archives get a git lookup; older ones are rarely looked at. */
export const ARCHIVED_ACTIVITY_LIMIT = 25;
/** Linked worktrees that get a `git status` per repository; the main checkout always does. The rest are listed uninspected. */
export const MAX_INSPECTED_WORKTREES = 12;
const CHECKOUT_CONCURRENCY = 3;
/** Cap the size of a change's `prompt.md` in the snapshot; a tooltip does not need more. */
export const PROMPT_LIMIT_BYTES = 8 * 1024;
/** A dependency list is a handful of names; anything larger is not one. */
export const DEPENDS_ON_LIMIT_BYTES = 16 * 1024;
export const DEPENDS_ON_FILE = "depends-on.yaml";

/**
 * The `depends_on` list of a change's `depends-on.yaml`: valid, de-duplicated names in file order. `unreadable` when the
 * file is not YAML or `depends_on` is not a list of strings — the author meant the change to wait, so it is blocked.
 */
export function parseDependsOn(text: string): { names: string[]; unreadable: boolean; warnings: string[] } {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return { names: [], unreadable: true, warnings: [`${DEPENDS_ON_FILE} is not valid YAML; Implement is held back until it is fixed`] };
  }
  const malformed = { names: [], unreadable: true, warnings: [`${DEPENDS_ON_FILE}: depends_on must be a list of change names; Implement is held back until it is fixed`] };
  if (doc == null) return { names: [], unreadable: false, warnings: [] };
  if (typeof doc !== "object" || Array.isArray(doc)) return malformed;
  const list = (doc as Record<string, unknown>).depends_on;
  if (list == null) return { names: [], unreadable: false, warnings: [] };
  if (!Array.isArray(list) || !list.every((n) => typeof n === "string")) return malformed;
  const names: string[] = [];
  const warnings: string[] = [];
  for (const name of list as string[]) {
    if (!CHANGE_NAME.test(name)) warnings.push(`${DEPENDS_ON_FILE}: ignored "${name}", which is not a valid change name`);
    else if (!names.includes(name)) names.push(name);
  }
  return { names, unreadable: false, warnings };
}

/** Bound on `issue.yaml`, which holds three short values. */
export const ISSUE_LIMIT_BYTES = 16 * 1024;

/** A change's `issue.yaml`, validated; `undefined` for a file that is not YAML or not a well-formed source issue. */
export function parseIssueFile(text: string): ChangeSnapshot["sourceIssue"] {
  try {
    return toSourceIssue(parseYaml(text));
  } catch {
    return undefined;
  }
}

/** A change's branch candidates, in order: its recorded branches, then the dashboard's own session branches. */
function branchCandidates(name: string, recorded: ChangeRecord | undefined): Set<string> {
  return new Set([recorded?.branch, recorded?.archiveBranch, sessionBranch("implement", name), sessionBranch("archive", name)].filter((b): b is string => b !== undefined));
}

/**
 * The main checkout's own branch when it is exactly one of the change's branch candidates, else the first linked
 * worktree's branch that is. Never containment: `feat/add-validate-phase` is another change's branch, not
 * `add-validate`'s (change-scanner: "Branch and worktree matching").
 */
function findBranchMatch(candidates: Set<string>, mainBranch: string | undefined, worktrees: Worktree[]): string | undefined {
  if (mainBranch !== undefined && candidates.has(mainBranch)) return mainBranch;
  return worktrees.find((w) => !w.isMain && w.branch !== undefined && candidates.has(w.branch))?.branch;
}

/**
 * A linked worktree's branch is a change's only when it is one of its candidates or the worktree holds work on it:
 * every branch carries the changes of the commit it was cut from, and another change's branch would link that change's
 * pull request. Otherwise the change is matched as if it lived in the main checkout.
 */
async function branchMatchFor(ctx: RepoContext, entry: ChangeDirEntry, recorded: ChangeRecord | undefined): Promise<string | undefined> {
  const candidates = branchCandidates(entry.name, recorded);
  if (!ctx.isMain && ctx.branch !== undefined && (candidates.has(ctx.branch) || (await ctx.holdsWork?.(entry)))) return ctx.branch;
  return findBranchMatch(candidates, ctx.mainBranch, ctx.worktrees);
}

/**
 * Adds the working-tree status to the checkouts `git worktree list` reported — the only paths ever used as a working
 * directory here. Stale and bare entries are never inspected; one checkout failing leaves it "unknown" and the rest intact.
 */
async function inspectCheckouts(source: RepoSource, listed: Worktree[]): Promise<Worktree[]> {
  const checkouts = listed.map((w) => ({ ...w }));
  const targets: Worktree[] = [];
  let linked = 0;
  for (const w of checkouts) {
    if (w.prunable || w.bare) continue;
    if (w.isMain || linked++ < MAX_INSPECTED_WORKTREES) targets.push(w);
    else w.inspected = false;
  }
  if (targets.length === 0) return checkouts;
  const hasRemotes = await source.hasRemoteRefs().catch(() => undefined);

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < targets.length) {
      const w = targets[next++];
      const status = await source.checkoutStatus(w.path).catch(() => undefined);
      if (!status) {
        w.status = "unknown";
        continue;
      }
      const { modified, untracked, conflicts, upstream, ahead, behind } = status;
      w.status = { modified, untracked, conflicts, upstream, ahead, behind };
      if (ahead !== undefined) {
        w.unpushed = ahead;
      } else if (hasRemotes) {
        // No upstream to be ahead of (never pushed, or detached): count what no remote-tracking ref has.
        const localOnly = await source.localOnlyCommits(w.path).catch(() => undefined);
        if (localOnly !== undefined) w.unpushed = localOnly;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHECKOUT_CONCURRENCY, targets.length) }, worker));
  return checkouts;
}

/** Latest of several instants. Compared as instants because commit dates carry an offset and mtimes are UTC. */
export function latestIso(...values: (string | undefined)[]): string | undefined {
  let best: string | undefined;
  for (const v of values) {
    if (v && !Number.isNaN(Date.parse(v)) && (!best || Date.parse(v) > Date.parse(best))) best = v;
  }
  return best;
}

function newestDirty(files: DirtyFile[], under: string): string | undefined {
  const prefix = under.endsWith(sep) ? under : under + sep;
  let newest = 0;
  for (const f of files) if (f.path.startsWith(prefix)) newest = Math.max(newest, f.mtimeMs);
  return newest ? new Date(newest).toISOString() : undefined;
}

/** At most this many linked worktrees are read per repository; the most recently touched ones win. */
export const WORKTREE_LIMIT = 12;
const WORKTREE_CONCURRENCY = 3;
const WORKTREE_TIMEOUT_MS = 10_000;

/** One checkout of a repository being scanned: the main working tree or a linked worktree. */
interface RepoContext {
  repo: RepoConfig;
  /** Reads from this checkout. */
  source: RepoSource;
  /** This checkout's directory; changes, specs and git commands are resolved against it. */
  root: string;
  isMain: boolean;
  isGit: boolean;
  /** The branch checked out here. */
  branch?: string;
  /** The branch the main checkout is on. */
  mainBranch?: string;
  /** For a linked worktree: whether it holds work on the change (uncommitted, or committed since its fork from the base). */
  holdsWork?: (entry: ChangeDirEntry) => Promise<boolean>;
  worktrees: Worktree[];
  /** Files under the framework's root that differ from HEAD, with their mtimes. */
  dirty: DirtyFile[];
  /** The module that reads this repository; every checkout of it is read by the same one. */
  framework: SpecFramework;
  /** This checkout's framework settings (for OpenSpec, the schema from `openspec/config.yaml`). */
  project: FrameworkProject;
}

/**
 * One of the dashboard's own files of a change (`prompt.md`, `depends-on.yaml`, `issue.yaml`): read only when the entry
 * in the change directory is itself a regular file, never through a link (change-scanner spec).
 */
function readOwnFile(ctx: RepoContext, entry: ChangeDirEntry, file: string, maxBytes: number, truncate = false): Promise<BoundedRead> {
  return ctx.source.readBounded(join(entry.dir, file), { within: entry.dir, maxBytes, truncate, inPlace: true });
}

async function scanChange(ctx: RepoContext, entry: ChangeDirEntry, withGit: boolean): Promise<ChangeSnapshot> {
  const { schema, artifacts, tasksPath, created, recorded, warnings } = await ctx.framework.readChange(ctx.source, ctx.project, entry);

  // A tasks file that is not there means no tasks yet; one that cannot be read is said so.
  const tasksRead = tasksPath ? await ctx.source.readBounded(tasksPath, { within: entry.dir, maxBytes: MAX_REPO_FILE_BYTES }) : undefined;
  const tasksWarning = tasksPath && tasksRead ? boundedReadWarning(relative(entry.dir, tasksPath).split(sep).join("/"), tasksRead, MAX_REPO_FILE_BYTES) : undefined;
  if (tasksWarning) warnings.push(tasksWarning);
  const tasks = tasksRead?.ok ? ctx.framework.parseTasks(tasksRead.text) : null;

  // `prompt.md` is a free-text hint, not an artifact: read it when it exists, do not fail the change on a bad read.
  let prompt: string | undefined;
  const promptRead = await readOwnFile(ctx, entry, "prompt.md", PROMPT_LIMIT_BYTES, true);
  if (promptRead.ok) {
    prompt = promptRead.text;
    if (promptRead.truncated) warnings.push(`prompt.md is larger than ${PROMPT_LIMIT_BYTES} bytes and was truncated`);
  } else if (promptRead.reason !== "missing") {
    warnings.push(promptRead.reason === "not-a-file" ? "prompt.md is not a regular file in the change directory and is ignored" : "could not read prompt.md");
  }
  // `depends-on.yaml` is the dashboard's own convention, not an artifact; archived changes never wait for anything.
  let dependsOn: ChangeSnapshot["dependsOn"];
  let dependsOnUnreadable = false;
  const dependsOnRead = entry.archived ? undefined : await readOwnFile(ctx, entry, DEPENDS_ON_FILE, DEPENDS_ON_LIMIT_BYTES);
  if (dependsOnRead && !dependsOnRead.ok && dependsOnRead.reason !== "missing") {
    dependsOnUnreadable = true;
    warnings.push(`could not read ${DEPENDS_ON_FILE}; Implement is held back until it can be read`);
  } else if (dependsOnRead?.ok) {
    const parsed = parseDependsOn(dependsOnRead.text);
    dependsOnUnreadable = parsed.unreadable;
    warnings.push(...parsed.warnings);
    // Provisional: the states are resolved against the whole repository once every copy is merged.
    if (parsed.names.length) dependsOn = parsed.names.map((name) => ({ name, state: "waiting" }));
  }
  // `issue.yaml` records the GitHub issue the change was imported from: display only, read for archived changes too so
  // an issue stays marked as imported. Anything malformed simply leaves the change without a source issue.
  let sourceIssue: ChangeSnapshot["sourceIssue"];
  const issueRead = await readOwnFile(ctx, entry, ISSUE_FILE, ISSUE_LIMIT_BYTES);
  if (issueRead.ok || issueRead.reason !== "missing") {
    sourceIssue = issueRead.ok ? parseIssueFile(issueRead.text) : undefined;
    if (!sourceIssue) warnings.push(`${ISSUE_FILE} could not be read as a GitHub issue reference and is ignored`);
  }
  if (tasks && tasks.total === 0 && isPlanned(artifacts)) {
    warnings.push("tasks file has no tasks");
  }

  // Commit date, or an uncommitted edit if newer. Clean files' mtimes are ignored: a checkout rewrites them.
  let lastActivityAt = latestIso(
    withGit && ctx.isGit ? await ctx.source.lastActivity(entry.dir) : undefined,
    newestDirty(ctx.dirty, entry.dir),
  );
  if (!lastActivityAt) lastActivityAt = await ctx.source.newestMtime(entry.dir);

  // Sync state is only reported for a finished, unarchived change, so only then is it worth reading its delta specs.
  let specsSynced: boolean | undefined;
  if (!entry.archived && tasks && tasks.total > 0 && tasks.done === tasks.total) {
    const sync = await ctx.framework.specsSynced(ctx.source, entry);
    specsSynced = sync?.synced;
    warnings.push(...(sync?.warnings ?? []));
  }

  const { stage, column, subState } = deriveStage({ archived: Boolean(entry.archived), artifacts, tasks });
  return {
    repoId: ctx.repo.id,
    name: entry.name,
    schema,
    artifacts,
    tasks,
    created,
    archived: entry.archived,
    lastActivityAt,
    specsSynced,
    branchMatch: entry.archived ? undefined : await branchMatchFor(ctx, entry, recorded),
    ...(recorded ? { recorded } : {}),
    stage,
    column,
    subState,
    prompt,
    ...(dependsOn ? { dependsOn } : {}),
    ...(dependsOnUnreadable ? { blocked: true } : {}),
    ...(sourceIssue ? { sourceIssue } : {}),
    warnings: warnings.length ? warnings : undefined,
  };
}

/**
 * `shared` is the dashboard's shared OpenSpec config, when one exists; it only adds the read-only sync state.
 * `frameworks` is the registry to claim the folder from (a test seam; the registered modules by default).
 */
export async function scanRepo(
  repo: RepoConfig,
  source: RepoSource = new LocalRepoSource(repo.path),
  shared?: SharedConfig,
  frameworks: readonly SpecFramework[] = FRAMEWORKS,
  sessions: readonly SessionHint[] = [],
): Promise<RepoSnapshot> {
  const base = { id: repo.id, name: repo.name, path: repo.path, scannedAt: new Date().toISOString() };
  const framework = await claimFramework(source, frameworks);
  if (!framework) {
    return { ...base, ok: false, error: unclaimedMessage(frameworks), isGit: false, worktrees: [], changes: [] };
  }
  const isGit = await source.isGit();
  const [branch, listed] = isGit ? await Promise.all([source.branch(), source.worktrees()]) : [undefined, []];
  const worktrees = await inspectCheckouts(source, listed);
  const workInProgress = isGit ? summarizeWorkInProgress(worktrees) : undefined;
  // Archives, specs and progress come from the main checkout; off its default branch they may be outdated.
  const mainBranch = isGit ? await source.defaultBranch().catch(() => undefined) : undefined;
  const onDefaultBranch = mainBranch === undefined ? undefined : branch === mainBranch;
  // Nothing to branch a session from: its change sessions run in place (agent-sessions spec).
  const noCommit = isGit && (await source.hasCommitToBranchFrom().catch(() => undefined)) === false;
  const fetched = isGit ? await source.fetchInfo().catch(() => undefined) : undefined;
  const project = await framework.readProject(source);
  // Shared config profiles are merged into a framework's own config file; a framework without one is not offered them.
  const sharedConfigFile = framework.sharedConfigFile;
  const configRead =
    sharedConfigFile && shared && shared.profiles.length > 0 ? await source.readBounded(join(repo.path, sharedConfigFile), { within: repo.path, maxBytes: MAX_REPO_FILE_BYTES }) : undefined;
  const sharedConfig = configRead && shared ? repoSharedConfig(configRead.ok ? configRead.text : undefined, shared) : undefined;
  const frameworkDir = join(repo.path, framework.layout.root);
  const dirty = isGit ? await source.dirtyFiles(framework.layout.root).catch(() => []) : [];
  const lastUpdatedAt = isGit
    ? latestIso(await source.lastActivity(frameworkDir), newestDirty(dirty, frameworkDir))
    : await source.newestMtime(frameworkDir);
  const ctx: RepoContext = { repo, source, root: repo.path, isMain: true, isGit, branch, mainBranch: branch, worktrees, dirty, framework, project };
  const detectedLabels = await scanLabels(source, repo.path, framework.layout.skipDirs);

  const listing = await framework.listChanges(source);
  const warnings = [...(project.warnings ?? []), ...listing.warnings];
  const mainCheckout = { path: repo.path, branch, isMain: true };
  const mainCopies: ChangeCopy[] = [];
  for (const entry of listing.active) mainCopies.push({ change: await scanChange(ctx, entry, true), checkout: mainCheckout });
  const scannedArchives: ChangeSnapshot[] = [];
  for (const [i, entry] of listing.archived.entries()) scannedArchives.push(await scanChange(ctx, entry, i < ARCHIVED_ACTIVITY_LIMIT));
  // An uncommitted change directory stays behind when its archive arrives; it is part of that archive, not a new change.
  const { copies, archived } = foldLeftovers(mainCopies, scannedArchives);

  // Newest archive date per name: `listing.archived` is sorted newest first, so the first one seen wins.
  const archivedOnMain = new Map<string, string>();
  for (const change of archived) if (change.archived && !archivedOnMain.has(change.name)) archivedOnMain.set(change.name, change.archived);

  // Work happens in linked worktrees; a board that only read the main checkout would show none of it.
  const fromWorktrees = await scanWorktrees(ctx, archivedOnMain);
  copies.push(...fromWorktrees.copies);
  warnings.push(...fromWorktrees.warnings);
  const unreadWorktrees = fromWorktrees.unread;

  const merged = isGit ? mergeChanges(copies, archivedOnMain, fromWorktrees.pending) : copies.map((c) => c.change);
  // An archive committed on a branch that never reached the default branch: marked, never moved (stale-changes spec).
  const open = merged.filter((c) => !c.archived);
  const stranded =
    isGit && !noCommit && open.length > 0 && source.strandedArchives && framework.layout.archiveDir
      ? await source.strandedArchives(framework.layout, open.map((c) => ({ name: c.name, created: c.created, ...(c.recorded ? { recorded: c.recorded } : {}) })), archivedOnMain, mainBranch, sessions).catch(() => undefined)
      : undefined;
  const active = stranded?.size ? merged.map((c) => (!c.archived && stranded.has(c.name) ? { ...c, strandedArchive: stranded.get(c.name) } : c)) : merged;
  // Archived on the default branch, merged, and something left over: marked, never moved (stale-changes spec).
  const stale =
    isGit && !noCommit && source.staleLeftovers && framework.layout.archiveDir
      ? await source
          .staleLeftovers({
            layout: framework.layout,
            metadata: framework.changeMetadata,
            defaultBranch: mainBranch,
            worktrees: listed,
            active: new Map(open.map((c) => [c.name, { name: c.name, created: c.created, ...(c.recorded ? { recorded: c.recorded } : {}) }])),
            archivedOnMain,
            sessions,
            managedRoot: await realpath(join(worktreesDir(), repo.id)).catch(() => join(worktreesDir(), repo.id)),
          })
          .catch(() => undefined)
      : undefined;
  // The default branch holds the change next to its archive: marked, never moved (stale-changes spec).
  const duplicates =
    isGit && !noCommit && source.duplicates && framework.layout.archiveDir
      ? await source.duplicates(framework.layout, framework.changeMetadata, archivedOnMain, listed).catch(() => undefined)
      : undefined;
  const changes = resolveDependencies(markStale([...active, ...archived], stale, duplicates));

  return {
    ...base,
    framework: framework.id,
    ok: true,
    warnings: warnings.length ? warnings : undefined,
    isGit,
    currentBranch: branch,
    defaultBranch: mainBranch,
    onDefaultBranch,
    ...(noCommit ? { noCommit: true as const } : {}),
    ...(fetched ? { hasRemote: fetched.hasRemote, lastFetchedAt: fetched.lastFetchedAt } : {}),
    worktrees,
    workInProgress,
    ...(unreadWorktrees.length ? { unreadWorktrees } : {}),
    // A repository whose only activity is in a worktree is still an active repository.
    lastUpdatedAt: latestIso(lastUpdatedAt, ...active.map((c) => c.lastActivityAt)),
    sharedConfig,
    detectedLabels,
    changes,
  };
}

/**
 * Puts each change's leftovers and duplicate report on the card it is shown as: the active change while the main
 * checkout has not pulled the archive, else its newest archive. Kept leftovers too — a running session's worktree tells
 * the end-session dialog the archive is on the default branch — but only a stale leftover marks the card (`staleReason`).
 */
function markStale(changes: ChangeSnapshot[], stale: Map<string, StaleLeftovers> | undefined, duplicates?: Map<string, DuplicateAfterArchive>): ChangeSnapshot[] {
  if (!stale?.size && !duplicates?.size) return changes;
  const marked = new Set<string>();
  return changes.map((c) => {
    const found = stale?.get(c.name);
    const duplicate = duplicates?.get(c.name);
    if ((!found && !duplicate) || marked.has(c.name)) return c;
    if (c.archived && changes.some((o) => o.name === c.name && !o.archived)) return c;
    marked.add(c.name);
    return { ...c, ...(found ? { stale: found } : {}), ...(duplicate ? { duplicate } : {}) };
  });
}

const LABEL_SKIP_DIRS = ["node_modules", "vendor", "dist", "build", "target"];
const LABEL_MAX_SUBDIRS = 64;
const LABEL_MAX_ENTRIES = 500;

/**
 * Technology labels of a project folder: the names of its entries and of its immediate subdirectories' entries, and
 * nothing deeper. Lists directories only — no file is opened, no git runs — so a scan stays read-only. `frameworkDirs`
 * are the framework module's own directories (`layout.skipDirs`), skipped like dependency folders.
 */
export async function scanLabels(source: Pick<RepoSource, "listEntries">, root: string, frameworkDirs: readonly string[]): Promise<DetectedLabel[]> {
  const skip = new Set([...LABEL_SKIP_DIRS, ...frameworkDirs]);
  const top = (await source.listEntries(root)).slice(0, LABEL_MAX_ENTRIES);
  const subdirs = top
    .filter((e) => e.kind === "dir" && !e.name.startsWith(".") && !skip.has(e.name))
    .map((e) => e.name)
    .sort()
    .slice(0, LABEL_MAX_SUBDIRS);
  const nested = await Promise.all(subdirs.map(async (name) => (await source.listEntries(join(root, name))).slice(0, LABEL_MAX_ENTRIES)));
  return detectLabels([...top, ...nested.flat()]);
}

const worktreeLabel = (w: Worktree) => w.branch ?? w.path;

interface WorktreeCopies {
  copies: ChangeCopy[];
  /** Archives this worktree has and the main checkout does not (yet): agents archive on a branch, in a worktree. */
  pending: ChangeCopy[];
}

/**
 * Changes of every readable linked worktree. A worktree that cannot be read becomes a warning, never an error, and its
 * path is listed in `unread` with those the limit left out — so a change missing from this scan is not taken for gone.
 */
async function scanWorktrees(main: RepoContext, archivedOnMain: Map<string, string>): Promise<WorktreeCopies & { warnings: string[]; unread: string[] }> {
  const warnings: string[] = [];
  const candidates: { worktree: Worktree; source: RepoSource; mtime: number }[] = [];
  // A project in a subdirectory of its repository is in that same subdirectory of every worktree; a worktree's top
  // level would be some other project's `openspec/` (or none).
  const subdir = await main.source.subdirectory().catch(() => "");
  for (const listed of main.worktrees) {
    if (listed.isMain || listed.prunable || listed.bare) continue;
    const worktree = subdir ? { ...listed, path: join(listed.path, subdir) } : listed;
    if (worktree.path === main.root) continue;
    const source = main.source.forCheckout(worktree.path);
    const mtime = await source.mtimeMs(join(worktree.path, main.framework.layout.changesDir)).catch(() => undefined);
    if (mtime !== undefined) candidates.push({ worktree, source, mtime });
  }
  candidates.sort((a, b) => b.mtime - a.mtime || a.worktree.path.localeCompare(b.worktree.path));
  const selected = candidates.slice(0, WORKTREE_LIMIT);
  if (candidates.length > selected.length) warnings.push(`${candidates.length - selected.length} of ${candidates.length} worktrees were not read (limit ${WORKTREE_LIMIT}; the most recently changed ones are)`);
  const unread = candidates.slice(WORKTREE_LIMIT).map((c) => c.worktree.path);

  // Committed work on a change is read against the fork point from this base; none means no worktree holds any.
  const base = selected.length ? await main.source.baseRef().catch(() => undefined) : undefined;
  const results: WorktreeCopies[] = new Array(selected.length).fill({ copies: [], pending: [] });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < selected.length) {
      const index = next++;
      const { worktree, source } = selected[index];
      try {
        results[index] = await withTimeout(scanWorktree(main, worktree, source, archivedOnMain, base), WORKTREE_TIMEOUT_MS, `worktree ${worktreeLabel(worktree)}`);
      } catch (err) {
        warnings.push(`worktree ${worktreeLabel(worktree)}: ${err instanceof Error ? err.message : String(err)}`);
        unread.push(worktree.path);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKTREE_CONCURRENCY, selected.length) }, worker));
  return { copies: results.flatMap((r) => r.copies), pending: results.flatMap((r) => r.pending), warnings, unread: unread.sort() };
}

async function scanWorktree(main: RepoContext, worktree: Worktree, source: RepoSource, archivedOnMain: Map<string, string>, base: string | undefined): Promise<WorktreeCopies> {
  const listing = await main.framework.listChanges(source);
  // Every branch carries main's archives along; only what main lacks (by name, as of that date) is news worth reading.
  const pendingEntries = listing.archived.filter((entry) => !((archivedOnMain.get(entry.name) ?? "") >= (entry.archived ?? "")));
  if (listing.active.length === 0 && pendingEntries.length === 0) return { copies: [], pending: [] };
  // A branch may carry its own config; it is that checkout's changes it applies to.
  const project = await main.framework.readProject(source, main.project);
  const dirty = await source.dirtyFiles(main.framework.layout.root).catch(() => []);
  // Asked at most once per worktree, and only for a change whose candidates do not include the worktree's branch.
  let touched: Promise<Set<string> | undefined> | undefined;
  const holdsWork = async (entry: ChangeDirEntry): Promise<boolean> => {
    if (newestDirty(dirty, entry.dir) !== undefined) return true;
    if (base === undefined) return false;
    touched ??= source.changesTouchedSinceFork(main.framework.layout.changesDir, base).catch(() => undefined);
    return (await touched)?.has(entry.name) ?? false;
  };
  const ctx: RepoContext = { ...main, source, root: worktree.path, isMain: false, branch: worktree.branch, dirty, project, holdsWork };
  const checkout = { path: worktree.path, branch: worktree.branch, isMain: false };
  const copies: ChangeCopy[] = [];
  for (const entry of listing.active) copies.push({ change: await scanChange(ctx, entry, true), checkout });
  const pending: ChangeCopy[] = [];
  for (const entry of pendingEntries) pending.push({ change: await scanChange(ctx, entry, true), checkout });
  return { copies, pending };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export interface ScannerOptions {
  concurrency?: number;
  repoTimeoutMs?: number;
  /** Test seam; defaults to the local filesystem source. */
  sourceFor?: (repo: RepoConfig) => RepoSource;
  /** Test seam; defaults to the shared config stored in the dashboard home. */
  sharedConfig?: () => Promise<SharedConfig | undefined>;
  persist?: boolean;
  /** Called after every completed scan with the snapshot that was current before it and the new one. */
  onSnapshots?: (previous: Snapshot, next: Snapshot) => void;
  /** The dashboard's change sessions of a repository: their branches name a change's branches, a running one keeps its worktree. */
  sessionsFor?: (repoId: string) => SessionHint[];
}

/** Owns the current snapshot and the polling schedule (design.md D4). */
export class Scanner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<Snapshot> | undefined;
  /** The one scan queued by triggers while another ran; not started yet, so it reads the configuration afresh. */
  private followUp: Promise<Snapshot> | undefined;
  snapshot: Snapshot;

  constructor(
    private readonly getConfig: () => Config,
    private readonly options: ScannerOptions = {},
    initial: Snapshot = emptySnapshot(),
  ) {
    this.snapshot = initial;
  }

  get scanning(): boolean {
    return this.inFlight !== undefined || this.followUp !== undefined;
  }

  start(): void {
    this.stop();
    const seconds = this.getConfig().pollIntervalSeconds;
    this.timer = setInterval(() => void this.trigger(), seconds * 1000);
    void this.trigger();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Starts a scan unless one is running. Returns whether a new scan started; otherwise `done` is the one follow-up
   * scan every trigger during the running scan shares, which starts once it has settled (design D1).
   */
  trigger(): { started: boolean; done: Promise<Snapshot> } {
    if (this.followUp) return { started: false, done: this.followUp };
    if (!this.inFlight) return { started: true, done: this.run() };
    const settled = () => {
      this.followUp = undefined;
      return this.run();
    };
    this.followUp = this.inFlight.then(settled, settled);
    return { started: false, done: this.followUp };
  }

  private run(): Promise<Snapshot> {
    const scan = this.scanAll().finally(() => {
      if (this.inFlight === scan) this.inFlight = undefined;
    });
    this.inFlight = scan;
    return scan;
  }

  private async scanAll(): Promise<Snapshot> {
    const config = this.getConfig();
    const repos = config.repos.filter((r) => r.enabled);
    const previous = new Map(this.snapshot.repos.map((r) => [r.id, r]));
    const shared = await (this.options.sharedConfig ?? loadSharedConfig)();
    const results: RepoSnapshot[] = new Array(repos.length);
    const concurrency = this.options.concurrency ?? DEFAULT_CONCURRENCY;
    const timeoutMs = this.options.repoTimeoutMs ?? DEFAULT_REPO_TIMEOUT_MS;
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < repos.length) {
        const index = next++;
        const repo = repos[index];
        const source = this.options.sourceFor?.(repo) ?? new LocalRepoSource(repo.path);
        try {
          results[index] = await withTimeout(scanRepo(repo, source, shared, FRAMEWORKS, this.options.sessionsFor?.(repo.id) ?? []), timeoutMs, repo.name);
        } catch (err) {
          // Keep the last good changes so the board never blanks out on a transient failure.
          const prev = previous.get(repo.id);
          results[index] = {
            id: repo.id,
            name: repo.name,
            path: repo.path,
            ...(prev?.framework ? { framework: prev.framework } : {}),
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            scannedAt: new Date().toISOString(),
            isGit: prev?.isGit ?? false,
            currentBranch: prev?.currentBranch,
            defaultBranch: prev?.defaultBranch,
            onDefaultBranch: prev?.onDefaultBranch,
            ...(prev?.noCommit ? { noCommit: true as const } : {}),
            hasRemote: prev?.hasRemote,
            lastFetchedAt: prev?.lastFetchedAt,
            worktrees: prev?.worktrees ?? [],
            workInProgress: prev?.workInProgress,
            lastUpdatedAt: prev?.lastUpdatedAt,
            sharedConfig: shared && shared.profiles.length > 0 ? prev?.sharedConfig : undefined,
            changes: prev?.changes ?? [],
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, repos.length) }, worker));

    const before = this.snapshot;
    this.snapshot = { generatedAt: new Date().toISOString(), repos: results };
    try {
      this.options.onSnapshots?.(before, this.snapshot);
    } catch (err) {
      console.warn("activity could not be recorded:", err); // history is never a reason to fail a scan
    }
    if (this.options.persist !== false) {
      await writeSnapshot(this.snapshot).catch((err) => console.warn("could not write snapshot cache:", err));
    }
    return this.snapshot;
  }
}
