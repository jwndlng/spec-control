// What became of the work in a session's worktree (design.md D1, D2). Read-only git, never a remote: `merged` is as
// of the user's last fetch. Worktree directories are listed themselves, because they outlive session records.
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { CONFLICTABLE_WORK, type ChangeSession, type RepoConfig, type SessionAction, type SessionWorktree, type WorkConflicts, type WorkStatus } from "../../shared/types.ts";
import { OPENSPEC_PATHS } from "../frameworks/registry.ts";
import { mergeScratchDir, worktreesDir } from "../paths.ts";

const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
const MAX_COMPARED_FILES = 500;
/** Conflicting paths reported per worktree; the rest is summarised as `truncated`. */
export const MAX_CONFLICT_FILES = 50;
/** One path segment; also what `POST /api/worktrees/remove` accepts. */
export const WORKTREE_NAME = /^[a-z0-9][a-z0-9._-]*$/;

async function run(cwd: string, args: string[], env: Record<string, string> = {}, trim = true): Promise<{ code: number; out: string }> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore", env: { ...process.env, ...ENV, ...env } });
    const out = await new Response(proc.stdout).text();
    return { code: await proc.exited, out: trim ? out.trim() : out };
  } catch {
    return { code: -1, out: "" };
  }
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const { code, out } = await run(cwd, args);
  return { ok: code === 0, out };
}

/** The commit a worktree has checked out (read-only `rev-parse`); undefined when git cannot say. */
export async function headCommit(worktreePath: string): Promise<string | undefined> {
  const head = await git(worktreePath, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  return head.ok && /^[0-9a-f]{40}$/.test(head.out) ? head.out : undefined;
}

/**
 * The object store the conflict check writes into, with the layout git expects of an object directory. Made on every
 * check rather than remembered: a recursive mkdir of an existing directory is a cheap no-op next to spawning git, and
 * remembering it would hand back a path that has since been emptied or removed.
 */
export async function ensureMergeScratch(): Promise<string> {
  const dir = mergeScratchDir();
  await mkdir(join(dir, "info"), { recursive: true });
  await mkdir(join(dir, "pack"), { recursive: true });
  return dir;
}

/** Start-up housekeeping: the merges of previous runs are of no use to anyone. */
export async function pruneMergeScratch(): Promise<void> {
  await rm(mergeScratchDir(), { recursive: true, force: true }).catch(() => undefined);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The default branch as the repository locally knows it; without a remote, whatever the main checkout is on. */
export async function baseRef(repoPath: string): Promise<string | undefined> {
  const remoteHead = await git(repoPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead.ok && remoteHead.out) return remoteHead.out;
  const head = await git(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  return head.ok && head.out ? head.out : undefined;
}

/**
 * Squash and rebase merges leave the branch's commits unreachable from the base, so content is compared instead: every
 * file `ref` changed since it forked from `base` has the same content in `base`. `cwd` is a worktree or the repository.
 */
export async function contentIsInBase(cwd: string, base: string, ref = "HEAD"): Promise<boolean> {
  const changed = await git(cwd, ["diff", "--name-only", "-z", `${base}...${ref}`]);
  if (!changed.ok) return false;
  const files = changed.out.split("\0").filter(Boolean);
  if (files.length > MAX_COMPARED_FILES) return false;
  if (files.length === 0) return true;
  return (await git(cwd, ["diff", "--quiet", base, ref, "--", ...files])).ok;
}

/** Where OpenSpec keeps its documents, as git prints repository-relative paths. Compared as written, no normalisation. */
const OPENSPEC_DIR = `${OPENSPEC_PATHS.root}/`;

/**
 * Whether Ship would hand over nothing but OpenSpec documents (auto-merge-docs design D3): every path the branch changed
 * since it forked from `base`, and every path the worktree's status reports — renames on both sides, untracked files
 * included, because Ship asks the agent to commit everything — lies under `openspec/`. Asked at the moment of Ship and
 * failing closed: an unknown base, a git error or no path at all is `false`.
 *
 * Archive asks it too, with `allowEmpty` (archive-auto-merge-docs design D1): an archive session normally starts in a
 * fresh worktree from the base, where nothing has changed yet, and that is the case its instruction is for.
 */
export async function shipsOnlyOpenSpec(worktreePath: string, base: string | undefined, { allowEmpty = false }: { allowEmpty?: boolean } = {}): Promise<boolean> {
  if (!base) return false;
  const [committed, status] = await Promise.all([
    // `--no-renames`: with rename detection a committed `src/x` moved into `openspec/` would list only its new path.
    git(worktreePath, ["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`]),
    // Untrimmed: a status entry starts with a space when only the worktree side changed.
    run(worktreePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {}, false),
  ]);
  if (!committed.ok || status.code !== 0) return false;
  const paths = committed.out.split("\0").filter(Boolean);
  // `XY path` entries; a rename or copy is followed by its source path as an entry of its own.
  const entries = status.out.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") paths.push(entries[++i] ?? "");
  }
  return (allowEmpty || paths.length > 0) && paths.every((path) => path.startsWith(OPENSPEC_DIR));
}

/**
 * Whether merging `ref` into `base` would conflict, and where (design D1). `git merge-tree --write-tree` runs git's own
 * merge in memory — exit 0 is a clean merge, exit 1 is a conflict, anything else means the question could not be asked.
 *
 * Its one side effect is the tree it writes, so its object directory is pointed at the dashboard's scratch store and
 * the repository's own objects are offered only as an alternate: git reads everything it needs and writes nothing into
 * the tracked repository. No working tree, index or ref is involved, and nothing is fetched — so the answer is about
 * the base as of the user's last fetch.
 *
 * `undefined` means "no answer": an old git without `--write-tree`, an unreadable base, anything. Never an error.
 */
export async function readConflicts(worktreePath: string, base: string, ref = "HEAD"): Promise<WorkConflicts | undefined> {
  const common = await git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok || !common.out) return undefined;
  const scratch = await ensureMergeScratch().catch(() => undefined);
  if (!scratch) return undefined;
  const { code, out } = await run(worktreePath, ["merge-tree", "--write-tree", "--name-only", base, ref], {
    GIT_OBJECT_DIRECTORY: scratch,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(common.out, "objects"),
  });
  if (code === 0) return undefined; // merges cleanly
  if (code !== 1) return undefined; // too old, bad base, or no answer for any other reason
  // stdout is the merged tree's OID, then the conflicting paths, then a blank line and informational text.
  const [, ...rest] = out.split("\n");
  const files = rest.slice(0, rest.indexOf("") === -1 ? undefined : rest.indexOf("")).filter(Boolean);
  if (files.length === 0) return undefined; // conflicting exit without a path is no answer we can show
  const capped = files.slice(0, MAX_CONFLICT_FILES);
  return { base, files: capped, ...(files.length > capped.length ? { truncated: true } : {}) };
}

export async function readWorkStatus(repoPath: string, worktreePath: string): Promise<{ work: WorkStatus; branch?: string; lastCommitAt?: string }> {
  const inside = (await isDirectory(worktreePath)) ? await git(worktreePath, ["rev-parse", "--is-inside-work-tree"]) : { ok: false, out: "" };
  if (!inside.ok || inside.out !== "true") return { work: { state: "missing" } };
  const [branchRef, status, lastCommit, base] = await Promise.all([
    git(worktreePath, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]),
    git(worktreePath, ["log", "-1", "--format=%cI"]),
    baseRef(repoPath),
  ]);
  const branch = branchRef.ok && branchRef.out ? branchRef.out : undefined;
  const common = { branch, lastCommitAt: lastCommit.ok && lastCommit.out ? lastCommit.out : undefined };
  const label = base && /^[0-9a-f]{40}$/.test(base) ? "the main checkout" : base;
  // Only where there is work the base lacks, and always against the branch's last commit — git merges commits, so a
  // dirty worktree's conflict is still a statement about what is committed.
  const withConflicts = async (work: WorkStatus): Promise<WorkStatus> => {
    if (!base || !CONFLICTABLE_WORK.includes(work.state)) return work;
    const conflicts = await readConflicts(worktreePath, base);
    return conflicts ? { ...work, conflicts: { ...conflicts, base: label ?? conflicts.base } } : work;
  };
  if (!status.ok) return { ...common, work: { state: "missing" } };
  const dirty = status.out ? status.out.split("\n").length : 0;
  if (dirty > 0) return { ...common, work: await withConflicts({ state: "uncommitted", count: dirty, base: label }) };

  const ahead = base ? await git(worktreePath, ["rev-list", "--count", `${base}..HEAD`]) : { ok: false, out: "" };
  const aheadOfBase = ahead.ok ? Number(ahead.out) : undefined;
  if (base && aheadOfBase === 0) {
    const onRemote = branch ? (await git(worktreePath, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`])).ok : false;
    return { ...common, work: { state: onRemote ? "merged" : "clean", base: label } };
  }
  if (base && (await contentIsInBase(worktreePath, base))) return { ...common, work: { state: "merged", base: label } };

  const upstream = await git(worktreePath, ["rev-list", "--count", "@{u}..HEAD"]);
  const unpushed = upstream.ok ? Number(upstream.out) : (aheadOfBase ?? 1);
  if (unpushed > 0) return { ...common, work: await withConflicts({ state: "unpushed", count: unpushed, base: label }) };
  return { ...common, work: await withConflicts({ state: "pushed", base: label }) };
}

/** The inverse of `worktreeName` in the manager, for worktrees whose session record is gone. */
export function changeOfWorktree(name: string): { change: string; action: SessionAction } {
  return name.startsWith("archive-") ? { change: name.slice("archive-".length), action: "archive" } : { change: name, action: "implement" };
}

const latest = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);

export async function listWorktrees(repos: RepoConfig[], sessions: ChangeSession[]): Promise<SessionWorktree[]> {
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const dir = join(worktreesDir(), repo.id);
      const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => WORKTREE_NAME.test(name));
      return Promise.all(
        names.map(async (name): Promise<SessionWorktree | undefined> => {
          const path = join(dir, name);
          if (!(await isDirectory(path))) return undefined;
          const session = sessions.find((s) => s.worktreePath === path); // sessions arrive newest first
          const { work, branch, lastCommitAt } = await readWorkStatus(repo.path, path);
          const owner = session ? { change: session.change, action: session.action } : changeOfWorktree(name);
          return { repoId: repo.id, name, path, ...owner, branch: branch ?? session?.branch, work, lastActivityAt: latest(lastCommitAt, session?.updatedAt), sessionId: session?.id };
        }),
      );
    }),
  );
  return perRepo.flat().filter((w): w is SessionWorktree => w !== undefined);
}
