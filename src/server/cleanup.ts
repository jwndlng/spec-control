// Repository cleanup (openspec/specs/repository-cleanup; dashboard-api "never writes", exception 6): removing a
// repository's leftover worktrees, stale worktree records and merged local branches, on the user's confirmation.
//
// This is the ONLY place in the dashboard that deletes a branch. The preview is read-only; applying re-checks every
// item against the current state and never trusts what the client sends. Nothing here contacts a remote, deletes a
// remote-tracking ref or touches the main checkout's branch, index or files. The one forced worktree removal is
// `deleteBranch`, for the single worktree the user confirmed after seeing what it holds, and only after a copy of its
// uncommitted files is safe under the dashboard's home.
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
  type BranchDeletePreview,
  type BranchDeleteRequest,
  type BranchDeleteResult,
  UNCOMMITTED_LISTED,
} from "../shared/types.ts";
import type {
  CleanupBranch,
  CleanupItemResult,
  CleanupPreview,
  CleanupResult,
  CleanupSelection,
  CleanupWorktree,
  RepoConfig,
  Worktree,
} from "../shared/types.ts";
import { parseWorktrees } from "./git.ts";
import { branchBackupsDir, worktreesDir } from "./paths.ts";
import { backupDirName } from "./pull.ts";
import { contentIsInBase, readWorkStatus } from "./sessions/workStatus.ts";
import { checkWorktreeRemovable, removeWorktree } from "./sessions/worktree.ts";

const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
const BRANCH_CONCURRENCY = 8;

/** `raw` keeps the output as git wrote it: porcelain status lines may begin with a space. */
async function git(cwd: string, args: string[], raw = false): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, ...ENV } });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { ok: (await proc.exited) === 0, out: raw ? out : out.trim(), err: err.trim() };
  } catch (e) {
    return { ok: false, out: "", err: String(e) };
  }
}

/** A local branch name as git would create it; anything else never reaches git (and nothing option-like does). */
export function isBranchName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.includes("/.") &&
    !/[./]$/.test(name) &&
    !name.endsWith(".lock")
  );
}

export class CleanupBusyError extends Error {
  constructor() {
    super("a cleanup of this repository is already running");
  }
}

const running = new Set<string>();

/** While true, sessions must not start in the repository: a worktree could be removed between its check and its use. */
export function isCleaningUp(repoId: string): boolean {
  return running.has(repoId);
}

async function real(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

interface Context {
  repo: RepoConfig;
  /** What merged-ness is judged against: `origin/<default>`, else a local `main`/`master`. */
  base?: string;
  /** The default branch's local name; never a cleanup candidate. */
  defaultName?: string;
  listed: Worktree[];
  mainBranch?: string;
  /** Real path of this repository's folder under the dashboard's worktrees directory. */
  managedRoot: string;
  /** Real paths of worktrees with a running agent session. */
  sessions: Set<string>;
}

async function context(repo: RepoConfig, sessions: Set<string>): Promise<Context> {
  const [remoteHead, listedOut, root] = await Promise.all([
    git(repo.path, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]),
    git(repo.path, ["worktree", "list", "--porcelain"]),
    real(worktreesDir()),
  ]);
  let base: string | undefined;
  let defaultName: string | undefined;
  if (remoteHead.ok && remoteHead.out) {
    base = remoteHead.out;
    defaultName = remoteHead.out.replace(/^origin\//, "");
  } else {
    for (const candidate of ["main", "master"]) {
      if ((await git(repo.path, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`])).ok) {
        base = defaultName = candidate;
        break;
      }
    }
  }
  const listed = listedOut.ok ? parseWorktrees(`${listedOut.out}\n`) : [];
  return { repo, base, defaultName, listed, mainBranch: listed.find((w) => w.isMain)?.branch, managedRoot: join(root, repo.id), sessions };
}

const linked = (ctx: Context) => ctx.listed.filter((w) => !w.isMain && !w.bare && !w.prunable);

async function judgeWorktree(ctx: Context, w: Worktree): Promise<CleanupWorktree> {
  const managed = w.path.startsWith(ctx.managedRoot + sep);
  const { work, lastCommitAt } = await readWorkStatus(ctx.repo.path, w.path);
  const item: CleanupWorktree = { path: w.path, branch: w.branch, work, lastCommitAt, managed, locked: w.locked || undefined, removable: false };
  if (ctx.sessions.has(w.path)) return { ...item, reason: "an agent session is running in it" };
  if (w.locked && !managed) return { ...item, reason: `it is locked${w.lockReason ? ` (${w.lockReason})` : ""}` };
  const check = await checkWorktreeRemovable(w.path, work.state === "merged");
  return check.removable ? { ...item, removable: true } : { ...item, reason: check.reason };
}

interface BranchRef {
  name: string;
  commit: string;
  lastCommitAt?: string;
  upstream?: string;
}

async function branchRefs(repoPath: string): Promise<BranchRef[]> {
  const listed = await git(repoPath, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(upstream:short)", "refs/heads"]);
  if (!listed.ok) return [];
  return listed.out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, commit, date, upstream] = line.split("\0");
      return { name: ref.replace(/^refs\/heads\//, ""), commit, lastCommitAt: date || undefined, upstream: upstream || undefined };
    });
}

/**
 * `worktreeRemovable` says whether the linked worktree a branch is checked out in is itself removable (the preview);
 * applying passes nothing, since by then every worktree that was going to be removed is gone.
 */
async function judgeBranch(ctx: Context, ref: BranchRef, worktreeRemovable: (path: string) => boolean = () => false): Promise<CleanupBranch> {
  const item: CleanupBranch = { ...ref, removable: false };
  if (ref.name === ctx.mainBranch) return { ...item, reason: "it is checked out in the main checkout" };
  const base = ctx.base;
  if (!base) return { ...item, reason: "the default branch is unknown" };

  const ahead = await git(ctx.repo.path, ["rev-list", "--count", `${base}..${ref.commit}`]);
  if (!ahead.ok) return { ...item, reason: `could not compare it with ${base}` };
  if (ahead.out === "0") item.mergedBy = "ancestry";
  else if (await contentIsInBase(ctx.repo.path, base, ref.commit)) item.mergedBy = "content";
  else return { ...item, reason: `${ahead.out} commit(s) not in ${base}` };

  const stale = ctx.listed.find((w) => !w.isMain && w.prunable && w.branch === ref.name);
  if (stale) return { ...item, reason: "it is checked out in a stale worktree record — prune it, then clean up again" };
  const holder = linked(ctx).find((w) => w.branch === ref.name);
  if (holder) {
    item.worktreePath = holder.path;
    if (!worktreeRemovable(holder.path)) return { ...item, reason: `it is checked out in the worktree ${holder.path}, which is kept` };
  }
  return { ...item, removable: true };
}

/** Read-only: what cleanup could remove in `repo`, and why everything else is kept. */
export async function previewCleanup(repo: RepoConfig, sessions: Set<string> = new Set()): Promise<CleanupPreview> {
  const ctx = await context(repo, sessions);
  const worktrees = await Promise.all(linked(ctx).map((w) => judgeWorktree(ctx, w)));
  const removable = new Set(worktrees.filter((w) => w.removable).map((w) => w.path));
  const refs = (await branchRefs(repo.path)).filter((b) => b.name !== ctx.defaultName);
  const branches = await mapLimit(refs, BRANCH_CONCURRENCY, (b) => judgeBranch(ctx, b, (path) => removable.has(path)));
  const prunable = ctx.listed.filter((w) => !w.isMain && w.prunable).map((w) => ({ path: w.path }));
  return { repoId: repo.id, base: ctx.base, worktrees, prunable, branches };
}

/**
 * Removes what the user selected, in order — worktrees, stale records, branches — re-checking each item first. Items
 * that are no longer safe, or were never the repository's own, are kept and reported. One failure never stops the rest.
 */
export async function applyCleanup(repo: RepoConfig, selection: CleanupSelection, sessions: Set<string> = new Set()): Promise<CleanupResult> {
  if (running.has(repo.id)) throw new CleanupBusyError();
  running.add(repo.id);
  try {
    const items: CleanupItemResult[] = [];

    let ctx = await context(repo, sessions);
    for (const requested of selection.worktrees) {
      const w = linked(ctx).find((l) => l.path === requested);
      if (!w) {
        items.push({ kind: "worktree", id: requested, outcome: "kept", reason: "not a worktree of this repository" });
        continue;
      }
      const judged = await judgeWorktree(ctx, w);
      if (!judged.removable) {
        items.push({ kind: "worktree", id: w.path, outcome: "kept", reason: judged.reason });
        continue;
      }
      const removed = await removeWorktree(repo.path, w.path, judged.work.state === "merged", judged.managed);
      items.push(
        removed.removable ? { kind: "worktree", id: w.path, outcome: "removed" } : { kind: "worktree", id: w.path, outcome: "kept", reason: removed.reason },
      );
    }

    if (selection.prune) {
      const before = (await context(repo, sessions)).listed.filter((w) => !w.isMain && w.prunable).map((w) => w.path);
      if (before.length > 0) {
        const pruned = await git(repo.path, ["worktree", "prune"]);
        const after = new Set((await context(repo, sessions)).listed.filter((w) => w.prunable).map((w) => w.path));
        for (const path of before) {
          items.push(
            after.has(path)
              ? { kind: "prune", id: path, outcome: "kept", reason: pruned.ok ? "git kept the record" : "git refused to prune" }
              : { kind: "prune", id: path, outcome: "pruned" },
          );
        }
      }
    }

    if (selection.branches.length > 0) {
      ctx = await context(repo, sessions);
      const refs = new Map((await branchRefs(repo.path)).map((b) => [b.name, b]));
      for (const { name, commit } of selection.branches) {
        const id = typeof name === "string" ? name : String(name);
        if (!isBranchName(name)) {
          items.push({ kind: "branch", id, outcome: "kept", reason: "not a valid branch name" });
          continue;
        }
        const ref = refs.get(name);
        if (!ref) {
          items.push({ kind: "branch", id, outcome: "kept", reason: "no such branch" });
          continue;
        }
        if (name === ctx.defaultName) {
          items.push({ kind: "branch", id, outcome: "kept", reason: "it is the default branch" });
          continue;
        }
        if (ref.commit !== commit) {
          items.push({ kind: "branch", id, outcome: "kept", reason: "it changed since the preview" });
          continue;
        }
        const judged = await judgeBranch(ctx, ref);
        if (!judged.removable) {
          items.push({ kind: "branch", id, outcome: "kept", reason: judged.reason });
          continue;
        }
        const deleted = await git(repo.path, ["branch", "-D", "--", name]);
        items.push(
          deleted.ok
            ? { kind: "branch", id, outcome: "deleted", commit: ref.commit }
            : { kind: "branch", id, outcome: "kept", reason: deleted.err.split("\n").pop() || "git refused to delete it" },
        );
      }
    }
    return { repoId: repo.id, items };
  } finally {
    running.delete(repo.id);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Deleting one branch and its worktree whatever they hold (repository-cleanup: "One branch and its worktree can be
// deleted whatever they hold"). The preview reads; the deletion re-reads, compares with what the user saw, copies the
// uncommitted files under the dashboard's home, and only then forces the worktree's removal and deletes its branch.
// ---------------------------------------------------------------------------------------------------------------------

/** Beyond this, an untracked build tree would fill the disk with copies: the deletion is refused instead. */
export const BACKUP_LIMITS = { files: 10_000, bytes: 512 * 1024 * 1024 };

interface Backup {
  /** Worktree-relative paths of regular files and symbolic links to copy. */
  files: string[];
  bytes: number;
  /** Set when the limits were exceeded or something could not be read; nothing is deleted then. */
  problem?: string;
}

/** Paths of `git status --porcelain=v1 -z`, relative to the worktree; a rename's source is gone and needs no copy. */
function statusPaths(out: string): string[] {
  const fields = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i++;
  }
  return paths;
}

/** What a backup would copy: the status paths that exist, a listed directory (a nested repository) walked whole. */
async function planBackup(worktree: string, paths: string[]): Promise<Backup> {
  const plan: Backup = { files: [], bytes: 0 };
  const over = () => plan.files.length > BACKUP_LIMITS.files || plan.bytes > BACKUP_LIMITS.bytes;
  const visit = async (rel: string): Promise<void> => {
    if (plan.problem) return;
    const absolute = join(worktree, rel);
    if (relative(worktree, absolute).startsWith("..")) {
      plan.problem = `${rel} lies outside the worktree`;
      return;
    }
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(absolute);
    } catch {
      return; // deleted in the worktree: the commit still has it
    }
    if (info.isDirectory()) {
      for (const name of await readdir(absolute)) await visit(join(rel, name));
    } else if (info.isFile() || info.isSymbolicLink()) {
      plan.files.push(rel);
      if (info.isFile()) plan.bytes += info.size;
    }
    if (over()) plan.problem = `its uncommitted files exceed what a backup holds (${BACKUP_LIMITS.files} files, ${BACKUP_LIMITS.bytes / 1024 / 1024} MiB)`;
  };
  for (const path of paths) await visit(path.replace(/\/$/, ""));
  return plan;
}

interface Inspected {
  preview: BranchDeletePreview;
  backup: Backup;
}

/** `locked`: the caller holds the repository's cleanup lock itself, so a running cleanup is not a reason to refuse. */
async function inspectWorktree(repo: RepoConfig, path: string, sessions: Set<string>, locked = false): Promise<Inspected> {
  const ctx = await context(repo, sessions);
  const listed = ctx.listed.find((w) => !w.isMain && w.path === path);
  const empty: Backup = { files: [], bytes: 0 };
  const refusedAs = (refused: string): Inspected => ({
    preview: { repoId: repo.id, path, commit: "", statusDigest: "", uncommitted: [], uncommittedCount: 0, managed: false, refused },
    backup: empty,
  });
  if (!listed) return refusedAs("it is not a linked worktree of this repository");
  if (listed.bare) return refusedAs("it is a bare repository entry");
  if (listed.prunable) return refusedAs("its directory no longer exists — Clean up prunes the record");

  const [head, status, remotes] = await Promise.all([
    git(path, ["rev-parse", "--verify", "--quiet", "HEAD"]),
    git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], true),
    git(repo.path, ["for-each-ref", "--count=1", "--format=%(refname)", "refs/remotes"]),
  ]);
  const managed = path.startsWith(ctx.managedRoot + sep);
  if (!head.ok || !status.ok) return refusedAs("git could not read the worktree");
  const commit = head.out;
  const paths = statusPaths(status.out);
  const preview: BranchDeletePreview = {
    repoId: repo.id,
    path,
    branch: listed.branch,
    commit,
    statusDigest: createHash("sha256").update(status.out).digest("hex"),
    uncommitted: paths.slice(0, UNCOMMITTED_LISTED),
    uncommittedCount: paths.length,
    managed,
    ...(listed.locked ? { locked: true } : {}),
  };
  if (remotes.ok && remotes.out) {
    const unique = await git(repo.path, ["rev-list", "--count", commit, "--not", "--remotes"]);
    if (unique.ok) preview.notOnRemote = Number(unique.out);
  }
  if (ctx.base) {
    preview.base = ctx.base;
    const ahead = await git(repo.path, ["rev-list", "--count", `${ctx.base}..${commit}`]);
    if (ahead.ok) {
      preview.notInBase = Number(ahead.out);
      preview.merged = preview.notInBase === 0 || (await contentIsInBase(repo.path, ctx.base, commit));
    }
  }
  const backup = await planBackup(path, paths);

  const refused =
    listed.branch && listed.branch === ctx.defaultName
      ? "it is the default branch"
      : listed.branch && listed.branch === ctx.mainBranch
        ? "it is checked out in the main checkout"
        : listed.branch && !isBranchName(listed.branch)
          ? "its branch name is not one the dashboard deletes"
          : sessions.has(path)
            ? "an agent session is running in it — end the session first"
            : listed.locked && !managed
              ? `it is locked${listed.lockReason ? ` (${listed.lockReason})` : ""} — unlock it yourself first`
              : !locked && running.has(repo.id)
                ? "a cleanup of this repository is running"
                : backup.problem;
  return { preview: refused ? { ...preview, refused } : preview, backup };
}

/** Read-only: what deleting the worktree at `path` (and its branch) would lose, or why it is refused. */
export async function previewBranchDelete(repo: RepoConfig, path: string, sessions: Set<string> = new Set()): Promise<BranchDeletePreview> {
  return (await inspectWorktree(repo, path, sessions)).preview;
}

async function writeBackup(repo: RepoConfig, preview: BranchDeletePreview, files: string[]): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = (preview.branch ?? "detached").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const dir = join(branchBackupsDir(), backupDirName(repo.id), `${stamp}-${slug}`);
  await mkdir(join(dir, "files"), { recursive: true });
  for (const rel of files) {
    const source = join(preview.path, rel);
    const target = join(dir, "files", rel);
    await mkdir(dirname(target), { recursive: true });
    const info = await lstat(source);
    if (info.isSymbolicLink()) await symlink(await readlink(source), target);
    else await copyFile(source, target);
  }
  const record = { repoId: repo.id, repoPath: repo.path, worktree: preview.path, branch: preview.branch ?? null, commit: preview.commit, files, at: new Date().toISOString() };
  await writeFile(join(dir, "backup.json"), `${JSON.stringify(record, null, 2)}\n`);
  return dir;
}

/**
 * Deletes the worktree the user confirmed, and its branch, whatever they hold — if, and only if, they are still what the
 * user saw. Copies the uncommitted files first; a failed copy deletes nothing.
 */
export async function deleteBranch(repo: RepoConfig, request: BranchDeleteRequest, sessions: Set<string> = new Set()): Promise<BranchDeleteResult> {
  if (running.has(repo.id)) throw new CleanupBusyError();
  running.add(repo.id);
  try {
    const { preview, backup } = await inspectWorktree(repo, request.path, sessions, true);
    const refuse = (reason: string): BranchDeleteResult => ({ repoId: repo.id, path: request.path, outcome: "refused", reason });
    if (preview.refused) return refuse(preview.refused);
    if ((preview.branch ?? null) !== request.branch) return refuse("the worktree is on another branch now — look again");
    if (preview.commit !== request.commit) return refuse("the branch changed since you looked — look again");
    if (preview.statusDigest !== request.statusDigest) return refuse("the worktree's files changed since you looked — look again");

    let backupDir: string | undefined;
    if (backup.files.length > 0) {
      try {
        backupDir = await writeBackup(repo, preview, backup.files);
      } catch (err) {
        return refuse(`nothing was deleted: the backup failed (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    const backedUp = backupDir ? { backupDir, backedUp: backup.files.length } : {};
    if (preview.locked && preview.managed) await git(repo.path, ["worktree", "unlock", request.path]);
    const removed = await git(repo.path, ["worktree", "remove", "--force", request.path]);
    if (!removed.ok) return { ...refuse(`git refused to remove the worktree: ${removed.err.split("\n").pop() || "unknown error"}`), ...backedUp };

    const branch = preview.branch;
    if (!branch) return { repoId: repo.id, path: request.path, outcome: "removed", ...backedUp };
    const ctx = await context(repo, sessions);
    const ref = await git(repo.path, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    const keep =
      branch === ctx.defaultName || branch === ctx.mainBranch
        ? "it became the default branch or the main checkout's branch"
        : !ref.ok
          ? "it no longer exists"
          : ref.out !== preview.commit
            ? "it changed while the worktree was removed"
            : ctx.listed.some((w) => w.branch === branch)
              ? "it is checked out in another worktree"
              : undefined;
    if (keep) return { repoId: repo.id, path: request.path, outcome: "removed", branch, reason: `the branch was kept: ${keep}`, ...backedUp };
    const deleted = await git(repo.path, ["branch", "-D", "--", branch]);
    if (!deleted.ok) {
      return { repoId: repo.id, path: request.path, outcome: "removed", branch, reason: `the branch was kept: ${deleted.err.split("\n").pop() || "git refused to delete it"}`, ...backedUp };
    }
    return { repoId: repo.id, path: request.path, outcome: "deleted", branch, commit: preview.commit, ...backedUp };
  } finally {
    running.delete(repo.id);
  }
}
