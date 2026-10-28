// Dismissing a change (openspec/specs/change-dismissal; dashboard-api "never writes", exception 7): deleting an active
// change's directory from the main checkout on the user's confirmation, then staging that removal.
//
// This is the ONLY place in the dashboard that deletes a change directory. The preview is read-only; dismissing
// recomputes it and refuses unless it is exactly what the user was shown. Nothing here touches a linked worktree, a
// branch, a ref or anything outside `openspec/changes/<name>/` (the changes directory of the only framework whose write
// paths are enumerated, `writablePaths`), and nothing here commits.
import { createHash } from "node:crypto";
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isChangeDirName } from "../shared/changeNames.ts";
import type { DismissFile, DismissPreview, DismissResult, RepoConfig, RepoSnapshot } from "../shared/types.ts";
import { frameworkById, writablePaths } from "./frameworks/registry.ts";
import { knownStatusPaths, subdirectory } from "./git.ts";
import { gitWrite } from "./gitWrite.ts";
import { linkedSegment } from "./source.ts";

const GIT_TIMEOUT_MS = 10_000;

export class DismissError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const running = new Set<string>();

/** The changes directory of the repository's framework (`openspec/changes`); refused for one with no enumerated paths. */
function changesDir(scanned: RepoSnapshot): string {
  const framework = frameworkById(scanned.framework);
  const layout = writablePaths(framework);
  if (!layout) throw new DismissError(409, `the dashboard does not dismiss ${framework?.label ?? "these"} changes`);
  return layout.changesDir;
}
const key = (repoId: string, name: string) => `${repoId}\0${name}`;

/** While true, no session may start for the change: an agent could write into the directory being deleted. */
export function isDismissing(repoId: string, name: string): boolean {
  return running.has(key(repoId, name));
}

/**
 * The one writing git command dismissing may run: no hooks, no prompt, no stdin (`gitWrite`). Any failure resolves to
 * `false`, because by then the directory is gone.
 */
async function stageRemoval(cwd: string, dir: string): Promise<boolean> {
  return (await gitWrite(cwd, ["add", "--all", "--", dir], { timeoutMs: GIT_TIMEOUT_MS })).ok;
}

/** Why a change without an active directory in the main checkout cannot be dismissed. */
function notInMain(scanned: RepoSnapshot, name: string): DismissError {
  const change = scanned.changes.find((c) => c.name === name && !c.archived);
  const holder = change && [change.checkout, ...(change.otherCheckouts ?? [])].find((c) => c && !c.isMain);
  if (holder) return new DismissError(404, `"${name}" lives only in the worktree ${holder.branch ? `on ${holder.branch}` : holder.path}; it leaves the board when that worktree is removed`);
  if (scanned.changes.some((c) => c.name === name && c.archived)) return new DismissError(404, `"${name}" is archived; only active changes can be dismissed`);
  return new DismissError(404, `there is no active change named "${name}" in the main checkout`);
}

/**
 * The change's directory in the main checkout, directly inside the framework's changes directory (`openspec/changes/`)
 * and reached through real directories only: no segment below the repository's folder — `openspec`, `openspec/changes`,
 * the change directory — may be a symbolic link (change-dismissal spec). Throws the reason otherwise.
 */
async function activeDir(repo: RepoConfig, scanned: RepoSnapshot, name: string): Promise<string> {
  if (!isChangeDirName(name)) throw new DismissError(400, "invalid change name");
  const changes = changesDir(scanned);
  const found = await linkedSegment(repo.path, `${changes}/${name}`);
  if (found?.reason === "symbolic link") throw new DismissError(409, `${found.segment} is a symbolic link; only a change reached through real directories can be dismissed`);
  if (found) throw notInMain(scanned, name);
  return join(repo.path, changes, name);
}

interface Entry {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

/** Every non-directory entry below `dir`, without following symbolic links (a link is an entry of its own). */
async function walk(dir: string, rel = ""): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(abs, path)));
    else {
      const info = await lstat(abs);
      out.push({ rel: path, abs, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  return out;
}

/**
 * Linked worktrees whose checkout has the change's directory. Looked up on disk rather than taken from the snapshot:
 * the board mentions only copies that differ from the main checkout's, but every copy brings the card back once the
 * main checkout's is gone.
 */
async function worktreeCopies(repo: RepoConfig, scanned: RepoSnapshot, name: string): Promise<{ path: string; branch?: string }[]> {
  const linked = scanned.worktrees.filter((w) => !w.isMain && !w.bare && !w.prunable);
  if (linked.length === 0) return [];
  const sub = await subdirectory(repo.path);
  const held = await Promise.all(linked.map((w) => lstat(join(w.path, sub, changesDir(scanned), name)).then((i) => i.isDirectory(), () => false)));
  return linked.filter((_, i) => held[i]).map((w) => ({ path: w.path, branch: w.branch }));
}

async function inspect(repo: RepoConfig, scanned: RepoSnapshot, name: string): Promise<{ dir: string; preview: DismissPreview }> {
  const dir = await activeDir(repo, scanned, name);
  const entries = await walk(dir);
  const isGit = scanned.isGit;

  // Anything git lists — untracked, ignored, modified, added — is not in HEAD as it is on disk. When git cannot say,
  // every file counts as lost: a failure must never read as "restorable".
  const listed = isGit ? await knownStatusPaths(repo.path, `${changesDir(scanned)}/${name}`, { ignored: true }) : undefined;
  const differing = new Set(listed?.filter((p) => !p.deleted).map((p) => p.path));
  const restorable = (abs: string) => listed !== undefined && !differing.has(abs);
  const files: (DismissFile & { size?: number; mtimeMs?: number })[] = entries.map((e) => ({ path: e.rel, state: restorable(e.abs) ? "restorable" : "lost", size: e.size, mtimeMs: e.mtimeMs }));
  // Tracked files already deleted from the working tree: git still has them, and their removal is staged too.
  for (const p of listed ?? []) {
    if (!p.deleted || !p.path.startsWith(`${dir}/`)) continue;
    const rel = p.path.slice(dir.length + 1);
    if (!files.some((f) => f.path === rel)) files.push({ path: rel, state: "restorable" });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const fingerprint = createHash("sha256")
    .update(JSON.stringify([isGit, files.map((f) => [f.path, f.state, f.size ?? null, f.mtimeMs ?? null])]))
    .digest("hex");

  const copies = isGit ? await worktreeCopies(repo, scanned, name) : [];
  return { dir, preview: { repoId: repo.id, name, isGit, files: files.map(({ path, state }) => ({ path, state })), copies, fingerprint } };
}

/** Read-only: what dismissing `name` would delete, and whether git could bring each file back. */
export async function previewDismiss(repo: RepoConfig, scanned: RepoSnapshot, name: string): Promise<DismissPreview> {
  return (await inspect(repo, scanned, name)).preview;
}

/**
 * Deletes the change directory the user confirmed and stages its removal. Refused — nothing deleted, no git run — when a
 * session for the change is open, another dismissal of it runs, or the directory is no longer what `fingerprint` says.
 * Staging is best-effort: a repository without git, an untracked change or a git failure report `staged: false`.
 */
export async function dismissChange(repo: RepoConfig, scanned: RepoSnapshot, name: string, fingerprint: string, hasOpenSession: () => boolean = () => false): Promise<DismissResult> {
  if (!isChangeDirName(name)) throw new DismissError(400, "invalid change name");
  const k = key(repo.id, name);
  if (running.has(k)) throw new DismissError(409, `"${name}" is already being dismissed`);
  running.add(k);
  try {
    if (hasOpenSession()) throw new DismissError(409, `an agent session is running for "${name}"; end it first`);
    const { preview } = await inspect(repo, scanned, name);
    if (preview.fingerprint !== fingerprint) throw new DismissError(409, `"${name}" changed since it was shown; look at it again before dismissing`);
    return { name, staged: await deleteAndStage(repo, scanned, name) };
  } finally {
    running.delete(k);
  }
}

/** The dismissal's one write: the directory goes, then its removal is staged, best-effort. */
async function deleteAndStage(repo: RepoConfig, scanned: RepoSnapshot, name: string): Promise<boolean> {
  // Checked again immediately before the delete: a link may have replaced a directory since the preview.
  const dir = await activeDir(repo, scanned, name);
  await rm(dir, { recursive: true });
  // The files are gone; whatever git does, the deletion has succeeded.
  return scanned.isGit ? await stageRemoval(repo.path, `${changesDir(scanned)}/${name}/`) : false;
}

/**
 * The main checkout's copy of a change that is archived and merged, confirmed in a stale change's cleanup
 * (stale-changes: "A stale change's leftovers are cleaned up on one confirmation"): deleted and its removal staged
 * exactly as a dismissal does. `verify` re-checks, under the dismissal's lock, that the directory is what the user saw and
 * backs up what differs from the archive; it returns why not to go ahead, and then nothing is deleted.
 */
export async function removeStaleChangeDirectory(
  repo: RepoConfig,
  scanned: RepoSnapshot,
  name: string,
  verify: (dir: string) => Promise<string | undefined>,
): Promise<{ removed: false; reason: string } | { removed: true; staged: boolean }> {
  if (!isChangeDirName(name)) return { removed: false, reason: "invalid change name" };
  const k = key(repo.id, name);
  if (running.has(k)) return { removed: false, reason: `"${name}" is being dismissed` };
  running.add(k);
  try {
    const reason = (err: unknown) => ({ removed: false as const, reason: err instanceof Error ? err.message : String(err) });
    let dir: string;
    try {
      dir = await activeDir(repo, scanned, name);
    } catch (err) {
      return reason(err);
    }
    const refused = await verify(dir);
    if (refused) return { removed: false, reason: refused };
    try {
      return { removed: true, staged: await deleteAndStage(repo, scanned, name) };
    } catch (err) {
      if (err instanceof DismissError) return reason(err);
      throw err;
    }
  } finally {
    running.delete(k);
  }
}
