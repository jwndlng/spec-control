// The git *writes* the dashboard performs for agent sessions (design.md D17), both on an explicit user action:
// creating a session's worktree, and removing it after read-only checks proved it holds nothing that exists nowhere else.
// The one more is `repairMovedWorktree`, run by the home migration once the user started a binary that moved the home.
// Every one of those writes goes through `gitWrite` (no hooks, no automatic maintenance); `git` below only reads.
import { cp, mkdir, realpath, stat } from "node:fs/promises";
import { OPENSPEC_PATHS } from "../frameworks/registry.ts";
import { parseWorktrees } from "../git.ts";
import { gitWrite } from "../gitWrite.ts";
import { dirname, join } from "node:path";

const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, ...ENV } });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { ok: (await proc.exited) === 0, out: out.trim(), err: err.trim() };
  } catch (e) {
    return { ok: false, out: "", err: String(e) };
  }
}

export interface Removable {
  removable: boolean;
  reason?: string;
}

/**
 * Read-only: is the worktree clean, and is every commit on it also reachable from somewhere else — or is its work
 * merged (`merged`, from the work status)? Removing a worktree never deletes its branch, so merged work whose upstream
 * was deleted after a squash merge can go as well.
 */
export async function checkWorktreeRemovable(worktreePath: string, merged = false): Promise<Removable> {
  try {
    if (!(await stat(worktreePath)).isDirectory()) return { removable: false, reason: "worktree path is not a directory" };
  } catch {
    return { removable: false, reason: "worktree no longer exists" };
  }
  const status = await git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok) return { removable: false, reason: "could not read the worktree's status" };
  if (status.out) return { removable: false, reason: "the worktree has uncommitted changes" };
  if (merged) return { removable: true };

  const upstream = await git(worktreePath, ["rev-list", "--count", "@{u}..HEAD"]);
  if (upstream.ok) {
    return upstream.out === "0" ? { removable: true } : { removable: false, reason: `${upstream.out} commit(s) have not been pushed` };
  }
  // No upstream: every commit must be reachable from another local branch or a remote-tracking branch.
  const head = await git(worktreePath, ["symbolic-ref", "--quiet", "HEAD"]);
  const refs = await git(worktreePath, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]);
  if (!refs.ok) return { removable: false, reason: "could not list branches" };
  const others = refs.out.split("\n").filter((ref) => ref && ref !== head.out);
  const unique = await git(worktreePath, ["rev-list", "--count", "HEAD", "--not", ...others]);
  if (!unique.ok) return { removable: false, reason: "could not compare the worktree's commits" };
  return unique.out === "0" ? { removable: true } : { removable: false, reason: `${unique.out} commit(s) exist only on this worktree's branch` };
}

/**
 * `git worktree unlock` (the CLI leaves its worktrees locked) followed by a non-forcing `git worktree remove`. Only
 * worktrees the dashboard created are unlocked (`unlock`); a lock on anyone else's worktree makes git refuse.
 */
export async function removeWorktree(repoPath: string, worktreePath: string, merged = false, unlock = true): Promise<Removable> {
  const check = await checkWorktreeRemovable(worktreePath, merged);
  if (!check.removable) return check;
  if (unlock) await gitWrite(repoPath, ["worktree", "unlock", worktreePath]); // fails harmlessly when it was not locked
  const removed = await gitWrite(repoPath, ["worktree", "remove", worktreePath]);
  return removed.ok ? { removable: true } : { removable: false, reason: "git refused to remove the worktree" };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A repository with no commit yet (`git init` and nothing else, as **New project** leaves it): `HEAD` names no commit, so
 * there is nothing to branch from. Its change sessions normally run in place — the scan says so (`noCommit`) — so this is
 * only reached when that scan is out of date; said plainly instead of git's `invalid reference: HEAD`.
 */
export class NoCommitError extends Error {
  constructor() {
    super("this repository has no commit yet, so there is no branch to work on; refresh the board and start again — the agent will then work in the checkout itself");
  }
}

/**
 * Makes sure `worktreePath` is a worktree of `repoPath` on `branch`. An existing one is reused (an earlier session for
 * the same change); an existing branch is checked out; otherwise the branch is created from the repository's default
 * branch as the repository currently knows it (`origin/HEAD`, else `HEAD`; refused with `NoCommitError` when that names
 * no commit). Deliberately no `git fetch`: the dashboard does not talk to the network, and remotes behind a hardware key
 * would block.
 */
/**
 * The linked worktree that has `branch` checked out, if any. git allows a branch in one worktree only, so a session
 * for that branch cannot get a worktree of its own and works there instead. Never the main checkout.
 */
/** The default branch as the repository knows it locally: `origin/HEAD`, else `HEAD`. Read-only, never a remote. */
async function defaultRef(repoPath: string): Promise<string> {
  const remoteHead = await git(repoPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  return remoteHead.ok && remoteHead.out ? remoteHead.out : "HEAD";
}

/**
 * Where an implementation branch that does not exist yet starts (ship-proposals-as-docs-prs D4), read-only: the local
 * `proposal` branch (`docs/<change>`) when it exists and the default branch's tree does not hold the change yet — its
 * proposal pull request is still open, or was never opened — so the implementation builds on the proposal; otherwise
 * `undefined`, the default branch as always. A failing `ls-tree` keeps the default branch too.
 */
export async function implementStartPoint(repoPath: string, change: string, proposal: string): Promise<string | undefined> {
  if (!(await git(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${proposal}`])).ok) return undefined;
  const held = await git(repoPath, ["ls-tree", "-d", "--name-only", await defaultRef(repoPath), "--", join(OPENSPEC_PATHS.changesDir, change)]);
  return held.ok && held.out === "" ? proposal : undefined;
}

export async function linkedWorktreeOf(repoPath: string, branch: string): Promise<string | undefined> {
  const listed = await git(repoPath, ["worktree", "list", "--porcelain"]);
  if (!listed.ok) return undefined;
  return parseWorktrees(`${listed.out}\n`).find((w) => !w.isMain && !w.prunable && !w.bare && w.branch === branch)?.path;
}

/**
 * A pull request's head branch that is known neither locally nor as `origin/<branch>` (resolve-pr-conflicts D2). The
 * dashboard does not fetch for it; the user does.
 */
export class UnknownBranchError extends Error {
  constructor(branch: string) {
    super(`the branch ${branch} is not known locally — fetch or pull first`);
  }
}

/**
 * `fromRemote`: the branch is a pull request's head branch, so a missing local branch is created from
 * `origin/<branch>` with it as upstream — never from the base — and refused with `UnknownBranchError` when that does
 * not exist either. An existing local branch is checked out as it is, whether or not it is level with the remote.
 * `startPoint`: where a missing branch is created instead of the default branch (`implementStartPoint`).
 */
export async function ensureWorktree(repoPath: string, worktreePath: string, branch: string, options: { fromRemote?: boolean; startPoint?: string } = {}): Promise<{ created: boolean; base?: string }> {
  if (await isDirectory(worktreePath)) {
    const inside = await git(worktreePath, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.ok && inside.out === "true") return { created: false };
    throw new Error(`${worktreePath} exists but is not a git worktree`);
  }
  // Everything is decided read-only first, so a refusal leaves nothing behind — not even the worktree's parent folder.
  const hasBranch = (await git(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
  if (options.fromRemote && !hasBranch) {
    const remote = `origin/${branch}`;
    if (!(await git(repoPath, ["show-ref", "--verify", "--quiet", `refs/remotes/${remote}`])).ok) throw new UnknownBranchError(branch);
    await mkdir(dirname(worktreePath), { recursive: true });
    await gitWrite(repoPath, ["worktree", "prune"]);
    // `--track` writes the same two `branch.<name>` keys git's default `branch.autoSetupMerge` gives every session branch.
    const added = await gitWrite(repoPath, ["worktree", "add", "--track", "-b", branch, worktreePath, remote]);
    if (!added.ok) throw new Error(`could not create the worktree: ${added.err.split("\n").pop()}`);
    return { created: true, base: remote };
  }
  const base = hasBranch ? "HEAD" : (options.startPoint ?? (await defaultRef(repoPath)));
  if (!hasBranch && base === "HEAD" && !(await git(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])).ok) throw new NoCommitError();
  await mkdir(dirname(worktreePath), { recursive: true });
  await gitWrite(repoPath, ["worktree", "prune"]); // forget worktrees whose directory was deleted by hand
  if (hasBranch) {
    const added = await gitWrite(repoPath, ["worktree", "add", worktreePath, branch]);
    if (!added.ok) throw new Error(`could not create the worktree: ${added.err.split("\n").pop()}`);
    return { created: true };
  }
  const added = await gitWrite(repoPath, ["worktree", "add", "-b", branch, worktreePath, base]);
  if (!added.ok) throw new Error(`could not create the worktree: ${added.err.split("\n").pop()}`);
  return { created: true, base };
}

/** A change that exists only uncommitted in the main checkout is copied into the worktree, so the agent can see it. */
/** `fromCheckout` is the checkout the change lives in: the main one, or a linked worktree. */
export async function copyChangeIfMissing(fromCheckout: string, worktreePath: string, change: string): Promise<boolean> {
  // Pinned to OpenSpec's changes directory, whose copy the agent-sessions spec describes; nothing else is ever copied.
  const source = join(fromCheckout, OPENSPEC_PATHS.changesDir, change);
  const target = join(worktreePath, OPENSPEC_PATHS.changesDir, change);
  if ((await isDirectory(target)) || !(await isDirectory(source))) return false;
  await cp(source, target, { recursive: true });
  return true;
}

/**
 * After the home migration moved a session worktree, tells its repository where it is now: `git worktree repair` with
 * the new path, run against the repository's common git directory, which the moved worktree still names (its `.git`
 * file points at an administrative directory that did not move). Rewrites only that record and the worktree's `.git`
 * file. Resolves with the reason when it cannot; `undefined` means repaired.
 */
export async function repairMovedWorktree(worktreePath: string): Promise<string | undefined> {
  try {
    if (!(await stat(join(worktreePath, ".git"))).isFile()) return "not a linked worktree";
  } catch {
    return "not a linked worktree";
  }
  const common = await git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok || !common.out) return `its repository could not be found${common.err ? `: ${common.err.split("\n").pop()}` : ""}`;
  const repaired = await gitWrite(worktreePath, [`--git-dir=${common.out}`, "worktree", "repair", worktreePath]);
  if (!repaired.ok) return `git worktree repair failed: ${repaired.err.split("\n").pop() || "no reason given"}`;
  // git reports some problems on stderr and still exits 0, so the record itself decides.
  const listed = await git(worktreePath, [`--git-dir=${common.out}`, "worktree", "list", "--porcelain"]);
  const real = await realpath(worktreePath).catch(() => worktreePath);
  const paths = parseWorktrees(`${listed.out}\n`).map((w) => w.path);
  if (!listed.ok || !(paths.includes(worktreePath) || paths.includes(real))) return `git worktree repair did not update the record: ${repaired.err.split("\n").pop() || "no reason given"}`;
  return undefined;
}
