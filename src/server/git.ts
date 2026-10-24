// Read-only git helpers. Every call sets `cwd` to the repository and passes
// paths after `--`; nothing here ever mutates a repository.
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { CheckoutStatus, Worktree } from "../shared/types.ts";

const DEFAULT_TIMEOUT_MS = 10_000;

async function git(cwd: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string | undefined> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return code === 0 ? out : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
  const out = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim();
  return out && out !== "HEAD" ? out : undefined;
}

/** URL of the `origin` remote as configured; undefined without one or outside a git repository. Reads config only. */
export async function originUrl(cwd: string): Promise<string | undefined> {
  return (await git(cwd, ["config", "--get", "remote.origin.url"]))?.trim() || undefined;
}

/**
 * `host/org/repo` for the scp-style (`git@host:org/repo.git`) and URL (`https://host/org/repo`, `ssh://git@host/…`)
 * forms of a remote, so that two clones of one project compare equal whatever protocol they use. The host is
 * lower-cased; user, port, a trailing slash and `.git` are dropped. Anything else (a local path) is returned trimmed.
 */
export function normalizeRemote(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed) ?? /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(trimmed);
  if (!match) return trimmed.replace(/\/+$/, "");
  const path = match[2].replace(/\/+$/, "").replace(/\.git$/, "").replace(/^\/+/, "");
  return `${match[1].toLowerCase()}/${path}`;
}

/** Whether a local branch of that exact name exists; read-only `show-ref`. */
export async function hasLocalBranch(cwd: string, branch: string): Promise<boolean> {
  return (await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) !== undefined;
}

/**
 * The repository's default branch as it is known locally — never asks the remote: what `origin/HEAD` points to, else a
 * local `main`, else a local `master`.
 */
export async function defaultBranch(cwd: string): Promise<string | undefined> {
  const head = (await git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]))?.trim();
  if (head) return head.replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    if ((await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`])) !== undefined) return candidate;
  }
  return undefined;
}

/**
 * Whether a session's branch has something to be created from: `HEAD` names a commit, or `origin/HEAD` exists. False
 * for a repository with no commit yet (`git init` and nothing else); undefined when git itself cannot be asked.
 */
export async function hasCommitToBranchFrom(cwd: string): Promise<boolean | undefined> {
  if ((await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])) !== undefined) return true;
  if ((await git(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])) !== undefined) return true;
  return (await git(cwd, ["rev-parse", "--git-dir"])) !== undefined ? false : undefined;
}

/**
 * Parses `git worktree list --porcelain`: one entry per record, in git's order — the main working tree first, then the
 * linked worktrees. Detached worktrees have no branch; locked, prunable and bare records are kept and flagged. Flags are
 * only set when they apply.
 */
export function parseWorktrees(porcelain: string): Worktree[] {
  const result: Worktree[] = [];
  let current: Worktree | undefined;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length) };
      if (result.length === 0) current.isMain = true;
      result.push(current);
    } else if (!current) {
      // stray line before the first record
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length, "HEAD ".length + 7);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.locked = true;
      if (line.length > "locked ".length) current.lockReason = line.slice("locked ".length);
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      current.prunable = true;
    } else if (line === "") {
      current = undefined;
    }
  }
  return result;
}

export async function worktrees(cwd: string): Promise<Worktree[]> {
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  return out ? parseWorktrees(out) : [];
}

/** Where `cwd` sits below its repository's top level (`""` at the top level), so the same project can be found in a linked worktree. */
export async function subdirectory(cwd: string): Promise<string> {
  return ((await git(cwd, ["rev-parse", "--show-prefix"]))?.trim() ?? "").replace(/\/+$/, "");
}

/** Committer date (ISO 8601) of the last commit touching `relPath`, or undefined if none. */
export async function lastCommitDate(cwd: string, relPath: string): Promise<string | undefined> {
  const out = (await git(cwd, ["log", "-1", "--format=%cI", "--", relPath]))?.trim();
  return out || undefined;
}

export interface StatusPath {
  /** Path relative to the repository's top level. */
  path: string;
  deleted: boolean;
}

/** Parses `git status --porcelain=v1 -z`. Rename/copy records carry the old name as an extra field, which is skipped. */
export function parseStatusPaths(porcelainZ: string): StatusPath[] {
  const result: StatusPath[] = [];
  const fields = porcelainZ.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (record.length < 4) continue;
    const xy = record.slice(0, 2);
    result.push({ path: record.slice(3), deleted: xy.includes("D") });
    if (xy.includes("R") || xy.includes("C")) i++;
  }
  return result;
}

/**
 * Absolute paths under `relPath` that differ from HEAD (modified, added, deleted, renamed, untracked).
 * Read-only: `GIT_OPTIONAL_LOCKS=0` (set for every call here) stops `status` from refreshing `.git/index`.
 * Empty on any failure.
 */
export async function statusPaths(cwd: string, relPath: string): Promise<{ path: string; deleted: boolean }[]> {
  return (await knownStatusPaths(cwd, relPath)) ?? [];
}

/**
 * `statusPaths`, but undefined when git failed — for callers that must not read a failure as "nothing differs". With
 * `ignored`, ignored files are listed too, each on its own.
 */
export async function knownStatusPaths(cwd: string, relPath: string, options: { ignored?: boolean } = {}): Promise<{ path: string; deleted: boolean }[] | undefined> {
  // Porcelain paths are relative to the top level, which is not `cwd` when the project sits in a subdirectory.
  // `--show-cdup` keeps `cwd`'s own spelling (`--show-toplevel` would resolve symlinks such as /var → /private/var).
  const cdup = (await git(cwd, ["rev-parse", "--show-cdup"]))?.trim();
  if (cdup === undefined) return undefined;
  const top = join(cwd, cdup);
  const out = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", ...(options.ignored ? ["--ignored"] : []), "--", relPath]);
  if (out === undefined) return undefined;
  return parseStatusPaths(out).map((p) => ({ path: join(top, p.path), deleted: p.deleted }));
}

/** What one `git status --porcelain=v2 --branch` says about a checkout. Counts only: entry paths are never kept. */
export interface ParsedStatus extends CheckoutStatus {
  /** Branch name; absent when detached. */
  head?: string;
  detached: boolean;
  /** The branch has no commits yet. */
  unborn: boolean;
}

/**
 * Parses `git status --porcelain=v2 --branch`. `1` (changed), `2` (renamed/copied) and `u` (unmerged) entries count as
 * modified, `?` entries as untracked (git collapses an untracked directory into one entry). `branch.upstream` and
 * `branch.ab` only appear when an upstream is configured.
 */
export function parseStatusV2(text: string): ParsedStatus {
  const result: ParsedStatus = { detached: false, unborn: false, modified: 0, untracked: 0, conflicts: 0 };
  for (const line of text.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length);
      if (head === "(detached)") result.detached = true;
      else result.head = head;
    } else if (line.startsWith("# branch.oid ")) {
      result.unborn = line.slice("# branch.oid ".length) === "(initial)";
    } else if (line.startsWith("# branch.upstream ")) {
      result.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const ab = /^\+(\d+) -(\d+)$/.exec(line.slice("# branch.ab ".length));
      if (ab) {
        result.ahead = Number(ab[1]);
        result.behind = Number(ab[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      result.modified++;
    } else if (line.startsWith("u ")) {
      result.modified++;
      result.conflicts++;
    } else if (line.startsWith("? ")) {
      result.untracked++;
    }
  }
  return result;
}

/** Working-tree status of the checkout at `path` (the main checkout or a linked worktree). Undefined when it cannot be determined. */
export async function checkoutStatus(path: string): Promise<ParsedStatus | undefined> {
  const out = await git(path, ["status", "--porcelain=v2", "--branch"]);
  return out === undefined ? undefined : parseStatusV2(out);
}

/** Whether the repository has any remote-tracking ref; without one "unpushed" means nothing. */
export async function hasRemoteRefs(cwd: string): Promise<boolean | undefined> {
  const out = await git(cwd, ["rev-parse", "--symbolic", "--remotes"]);
  return out === undefined ? undefined : out.trim() !== "";
}

/**
 * Whether the repository can be fetched from, and when it last was — by anyone, the dashboard or the user's terminal.
 * Reads `origin`'s URL, the remote-tracking refs and the time of `FETCH_HEAD`; nothing is written.
 */
export async function fetchInfo(cwd: string): Promise<{ hasRemote: boolean; lastFetchedAt?: string }> {
  const [refs, origin, fetchHead] = await Promise.all([hasRemoteRefs(cwd), originUrl(cwd), git(cwd, ["rev-parse", "--git-path", "FETCH_HEAD"])]);
  const hasRemote = refs === true || origin !== undefined;
  const path = fetchHead?.trim();
  if (!path) return { hasRemote };
  try {
    const { mtime } = await stat(isAbsolute(path) ? path : join(cwd, path));
    return { hasRemote, lastFetchedAt: mtime.toISOString() };
  } catch {
    return { hasRemote };
  }
}

export const LOCAL_ONLY_LIMIT = 100;

/** Commits reachable from `HEAD` but from no remote-tracking ref, capped at `LOCAL_ONLY_LIMIT`. 0 for a branch without commits. */
export async function localOnlyCommits(path: string): Promise<number | undefined> {
  const out = await git(path, ["log", "--format=%H", "-n", String(LOCAL_ONLY_LIMIT), "HEAD", "--not", "--remotes"]);
  if (out !== undefined) return out.split("\n").filter(Boolean).length;
  // `log` fails on an unborn branch: a work tree whose HEAD does not resolve has no commits to push.
  const inside = (await git(path, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
  return inside && (await git(path, ["rev-parse", "--verify", "--quiet", "HEAD"])) === undefined ? 0 : undefined;
}
