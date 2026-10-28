// The pull action: fetch a repository's remote, then fast-forward its main checkout — and nothing more adventurous.
//
// This is the ONLY place in the dashboard that contacts a remote or changes a main checkout. A pull only ever runs on
// the user's explicit request (openspec/specs/dashboard-api: "never writes", exception 3; openspec/specs/repository-pull);
// the one thing that runs on a timer is `fetchRepository`, the same fetch and nothing more, for a project whose
// auto-fetch setting the user switched on (exception 9; `autoFetch.ts` schedules it).
// It never merges with a commit, rebases, stashes, resets, forces or switches branches, never touches linked worktrees,
// and never runs repository hooks: a click in a browser must not execute a repository's scripts.
//
// The one thing it removes: when a fast-forward is refused because uncommitted files would be overwritten, it lists
// them, and when every one of them is a **change leftover** — a file the dashboard's own create-change wrote and staged
// that the incoming commits already contain — it offers Resolve and pull. Only then, only after the user confirms and
// only after re-proving the whole classification, does it copy what differs into `~/.spec-control/`, remove
// exactly those files and run the fast-forward again, putting them back if that is still refused.
import { constants } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PullBlockingFile, PullResolve, PullResult, RepoConfig } from "../shared/types.ts";
import { defaultBranch, repositoryKey } from "./git.ts";
import { gitWrite } from "./gitWrite.ts";
import { dashboardHome } from "./paths.ts";
import { OPENSPEC_PATHS } from "./frameworks/registry.ts";
import { CHANGE_NAME } from "./source.ts";

export const FETCH_TIMEOUT_MS = 60_000;
const LOCAL_TIMEOUT_MS = 15_000;
const PULL_ALL_CONCURRENCY = 3;

interface Run {
  ok: boolean;
  out: string;
  /** stdout exactly as git wrote it. `-z` output must not be trimmed: ` M path` starts with a significant space. */
  rawOut: string;
  err: string;
  timedOut: boolean;
}

/** SSH in batch mode — unless the user brought their own `GIT_SSH_COMMAND`, which is theirs to keep. */
function sshEnv(): Record<string, string> {
  return process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
}

/**
 * Read-only git without a shell. Never prompts: no terminal prompt, no stdin, and SSH in batch mode. Credentials stay
 * entirely with git. Every command here that writes goes through `gitWrite` instead (`writeGit`).
 */
async function git(cwd: string, args: string[], timeoutMs = LOCAL_TIMEOUT_MS): Promise<Run> {
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...sshEnv() };
  let timedOut = false;
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", env });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    try {
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      return { ok: code === 0 && !timedOut, out: out.trim(), rawOut: out, err: err.trim(), timedOut };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, out: "", rawOut: "", err: String(e), timedOut };
  }
}

/** A writing command: no hooks, no automatic maintenance (`gitWrite`), and the same prompt-less environment. */
function writeGit(cwd: string, args: string[], timeoutMs = LOCAL_TIMEOUT_MS): Promise<Run> {
  return gitWrite(cwd, args, { env: sshEnv(), timeoutMs });
}

/**
 * The fast-forward, pinned against configuration: `--no-autostash` overrides `merge.autoStash`, and submodules are
 * never updated whatever `submodule.recurse` says. Hooks are off through `gitWrite`.
 */
function fastForward(cwd: string, upstream: string): Promise<Run> {
  return writeGit(cwd, ["-c", "submodule.recurse=false", "merge", "--ff-only", "--no-autostash", "--quiet", upstream]);
}

/** A pathspec for a path relative to the top level, taken literally: the same file from any working directory. */
export function topLiteral(path: string): string {
  return `:(top,literal)${path}`;
}

/** `https://user:secret@host/…` must never reach the browser. */
export function maskCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1***@");
}

/** The part of git's stderr worth showing: its error and fatal lines, else the last line; hints are dropped. */
export function reasonFrom(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "" && !l.startsWith("hint:"));
  const telling = lines.filter((l) => /^(error|fatal):/.test(l) || /^\t/.test(l));
  const chosen = telling.length ? telling : lines.slice(-1);
  return maskCredentials(chosen.map((l) => l.replace(/^(error|fatal):\s*/, "").trim()).join(" ")) || "git gave no reason";
}

interface Inspection {
  branch?: string;
  upstream?: string;
  remote?: string;
  ahead: number;
  behind: number;
  hasRemote: boolean;
}

/** Read-only look at the main checkout. */
async function inspect(repoPath: string): Promise<Inspection> {
  const head = await git(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = head.ok && head.out ? head.out : undefined;
  let upstream: string | undefined;
  let remote: string | undefined;
  let ahead = 0;
  let behind = 0;
  if (branch) {
    const ref = await git(repoPath, ["for-each-ref", "--format=%(upstream:short)|%(upstream:remotename)|%(upstream:track)", `refs/heads/${branch}`]);
    const [short, remoteName, track = ""] = ref.out.split("|");
    upstream = short || undefined;
    remote = remoteName || undefined;
    ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0);
    behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0);
  }
  // Remote-tracking refs exist exactly when a remote has been fetched from before; `origin` is what a clone has.
  const remotes = await git(repoPath, ["for-each-ref", "--count=1", "--format=%(refname)", "refs/remotes/"]);
  return { branch, upstream, remote, ahead, behind, hasRemote: remote !== undefined || (remotes.ok && remotes.out !== "") };
}

async function hasPostMergeHook(repoPath: string): Promise<boolean> {
  const dir = await git(repoPath, ["rev-parse", "--git-path", "hooks/post-merge"]);
  if (!dir.ok || !dir.out) return false;
  try {
    await access(join(repoPath, dir.out), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Blocking files: what stops a fast-forward, computed rather than read out of git's message.
//
// git's "would be overwritten" wording is localised, differs between the index and the untracked case and stops after
// the first class of error, so the set is derived instead: the paths the incoming commits change, intersected with the
// paths the main checkout has uncommitted. Everything below is read-only.
// ---------------------------------------------------------------------------------------------------------------------

/** `git status --porcelain` states a change leftover may have: staged new, staged new and edited, untracked. */
const LEFTOVER_STATES = new Set(["A ", "AM", "??"]);
/** A leftover is an ordinary file. A symlink, a gitlink or a submodule is never removed, whatever its path. */
const REGULAR_MODES = new Set(["100644", "100755"]);
/** Pinned to OpenSpec's changes directory: another framework's files never match it, so they are never a leftover. */
const CHANGES_PREFIX = `${OPENSPEC_PATHS.changesDir}/`;

/** Beyond this many blocking files something larger is going on than a change leftover: list them, offer nothing. */
export const MAX_BLOCKING_FILES = 500;

const LOCAL_WORK_HINT = "Commit or set aside the listed files, then pull again.";
const LEFTOVER_HINT =
  "These files are left over from changes created here that the incoming commits already contain. Resolve and pull replaces them with the incoming version and keeps a copy of anything that differs.";
const DIVERGED_HINT = "Reconcile the local commits outside the dashboard, then pull again.";

/** git's `-z` output: NUL-terminated records, never quoted. */
export function parseNulList(text: string): string[] {
  return text.split("\u0000").filter((record) => record !== "");
}

/** `status --porcelain=v1 -z --untracked-files=all --no-renames` → each path's two-letter state (`XY path`). */
export function parseStatusStates(text: string): Map<string, string> {
  const states = new Map<string, string>();
  for (const record of parseNulList(text)) {
    if (record.length < 4) continue;
    states.set(record.slice(3), record.slice(0, 2));
  }
  return states;
}

/** A blob as git names it: the file mode matters as much as the content id. */
export interface BlobEntry {
  mode: string;
  id: string;
}

/** `ls-tree -z -r` (`<mode> <type> <id>\t<path>`) and `ls-files -s -z` (`<mode> <id> <stage>\t<path>`). */
export function parseBlobEntries(text: string): Map<string, BlobEntry> {
  const entries = new Map<string, BlobEntry>();
  for (const record of parseNulList(text)) {
    const tab = record.indexOf("\t");
    if (tab <= 0) continue;
    const fields = record.slice(0, tab).split(" ").filter((f) => f !== "");
    const id = fields.find((f) => /^[0-9a-f]{40,64}$/.test(f));
    if (fields[0] && id) entries.set(record.slice(tab + 1), { mode: fields[0], id });
  }
  return entries;
}

/** The paths the incoming commits change that also have an uncommitted change locally, in git's own order, deduplicated. */
export function blockingSet(incoming: string[], states: Map<string, string>): string[] {
  const blocking = new Set(incoming.filter((path) => states.has(path)));
  return [...blocking].sort();
}

/**
 * `openspec/changes/<name>/…` for a change name the scanner would accept, never the archive, and with no odd segment
 * below it. A path that is not exactly this can never be a leftover, whatever git says about it.
 */
export function isChangeLeftoverPath(path: string): boolean {
  if (!path.startsWith(CHANGES_PREFIX)) return false;
  const rest = path.slice(CHANGES_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return false;
  const name = rest.slice(0, slash);
  if (!CHANGE_NAME.test(name) || name === "archive" || name === "." || name === "..") return false;
  return rest
    .slice(slash + 1)
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * `isChangeLeftoverPath` for a path relative to the repository's top level, in a project whose folder is `prefix` below
 * it (`rev-parse --show-prefix`, `""` at the top level, else ending in `/`). Paths elsewhere are never a leftover.
 */
export function isProjectLeftoverPath(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && isChangeLeftoverPath(path.slice(prefix.length));
}

/** What is known about one blocking path, gathered by `blockingReport`. */
export interface BlockingFacts {
  /** The blob the incoming commit has at this path, when it has one at all. */
  incoming?: BlobEntry;
  /** The blob the index has, when the file is staged. */
  staged?: BlobEntry;
  /** `hash-object --path` of the working-tree file, so git's own filters decide what "the same content" means. */
  worktree?: string;
  /** The working-tree entry is an ordinary file — not a symlink, a directory or anything else. */
  regularFile?: boolean;
}

/**
 * A leftover is a file that only exists locally because the dashboard created the change here, and that the incoming
 * commits bring along: inside a change directory, new (staged or untracked, never also deleted), an ordinary file both
 * locally and upstream, and present upstream. Anything that fails any part of that is the user's own work.
 */
export function classifyBlocking(path: string, state: string, facts: BlockingFacts, prefix = ""): PullBlockingFile {
  const { incoming, staged, worktree } = facts;
  const leftover =
    isProjectLeftoverPath(path, prefix) &&
    LEFTOVER_STATES.has(state) &&
    incoming !== undefined &&
    REGULAR_MODES.has(incoming.mode) &&
    (staged === undefined || REGULAR_MODES.has(staged.mode)) &&
    facts.regularFile === true &&
    worktree !== undefined;
  if (!leftover || incoming === undefined || worktree === undefined) return { path, kind: "local-work" };
  const differs = worktree !== incoming.id || (staged !== undefined && (staged.id !== incoming.id || staged.mode !== incoming.mode));
  return { path, kind: "leftover", differs, incoming: incoming.id, staged: staged?.id, worktree };
}

/** True when two files are the same claim, field for field — how "unchanged since it was shown" is decided. */
function sameClaim(a: PullBlockingFile, b: PullBlockingFile): boolean {
  return a.path === b.path && a.kind === b.kind && a.differs === b.differs && a.incoming === b.incoming && a.staged === b.staged && a.worktree === b.worktree;
}

interface BlockingReport {
  /** Paths relative to the repository's top level, as git reports them. */
  files: PullBlockingFile[];
  /** The repository's top level in the project's own spelling: what every blocking path is read and touched against. */
  top: string;
  /** The full commit the classification was made against; the claim a confirmation has to still match. */
  upstream: string;
  /** More blocking files than `MAX_BLOCKING_FILES`: the list is cut short, so nothing is offered. */
  capped: boolean;
}

/**
 * Read-only throughout: `rev-parse`, `diff`, `status`, `ls-tree`, `ls-files` and `hash-object` without `-w`. Every path
 * is relative to the repository's top level and read that way by every command and file operation, so in a project in a
 * subfolder the file that is judged is the file that is touched.
 */
async function blockingReport(repoPath: string, upstreamRef: string): Promise<BlockingReport | undefined> {
  const [at, cdup, prefixed] = await Promise.all([
    git(repoPath, ["rev-parse", "--verify", "--quiet", `${upstreamRef}^{commit}`]),
    git(repoPath, ["rev-parse", "--show-cdup"]),
    git(repoPath, ["rev-parse", "--show-prefix"]),
  ]);
  if (!at.ok || !/^[0-9a-f]{40,64}$/.test(at.out) || !cdup.ok || !prefixed.ok) return undefined;
  // `--show-cdup` keeps the project's own spelling (`--show-toplevel` would resolve symlinks).
  const top = join(repoPath, cdup.out);
  const prefix = prefixed.out;
  const [incoming, status] = await Promise.all([
    git(top, ["diff", "--name-only", "-z", "--no-relative", "--no-renames", "HEAD", at.out]),
    git(top, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]),
  ]);
  if (!incoming.ok || !status.ok) return undefined;
  const states = parseStatusStates(status.rawOut);
  const all = blockingSet(parseNulList(incoming.rawOut), states);
  const paths = all.slice(0, MAX_BLOCKING_FILES);
  if (paths.length === 0) return { files: [], top, upstream: at.out, capped: false };

  const specs = paths.map(topLiteral);
  const [tree, index] = await Promise.all([
    git(top, ["ls-tree", "--full-name", "-z", "-r", at.out, "--", ...specs]),
    git(top, ["ls-files", "--full-name", "-s", "-z", "--", ...specs]),
  ]);
  const upstreamBlobs = tree.ok ? parseBlobEntries(tree.rawOut) : new Map<string, BlobEntry>();
  const stagedBlobs = index.ok ? parseBlobEntries(index.rawOut) : new Map<string, BlobEntry>();
  const files: PullBlockingFile[] = [];
  for (const path of paths) {
    const state = states.get(path) as string;
    // Only a candidate leftover is looked at any closer; anything else is local work and is never touched.
    const candidate = isProjectLeftoverPath(path, prefix) && LEFTOVER_STATES.has(state) && upstreamBlobs.has(path);
    if (!candidate) {
      files.push({ path, kind: "local-work" });
      continue;
    }
    const absolute = join(top, ...path.split("/"));
    let regularFile = false;
    try {
      regularFile = (await lstat(absolute)).isFile();
    } catch {
      regularFile = false;
    }
    const hashed = regularFile ? await git(top, ["hash-object", `--path=${path}`, "--", path]) : undefined;
    const facts: BlockingFacts = {
      incoming: upstreamBlobs.get(path),
      staged: stagedBlobs.get(path),
      worktree: hashed?.ok && /^[0-9a-f]{40,64}$/.test(hashed.out) ? hashed.out : undefined,
      regularFile,
    };
    files.push(classifyBlocking(path, state, facts, prefix));
  }
  return { files, top, upstream: at.out, capped: all.length > paths.length };
}

/** The refusal a blocked fast-forward becomes: git's reason, the blocking files, and only then an offer. */
function refusalFrom(report: BlockingReport | undefined, reason: string): Pick<PullResult, "update" | "reason" | "blocking" | "resolvable" | "hint"> {
  if (!report || report.files.length === 0) return { update: "refused", reason };
  const resolvable = !report.capped && report.files.every((f) => f.kind === "leftover");
  return {
    update: "refused",
    reason,
    blocking: report.files,
    resolvable: resolvable ? { upstream: report.upstream, files: report.files } : undefined,
    hint: resolvable ? LEFTOVER_HINT : LOCAL_WORK_HINT,
  };
}

/**
 * One fetch per git repository at a time, whoever started it and for whichever of its tracked projects. A pull that
 * finds an automatic fetch running waits for it rather than being refused for something the user did not start; a
 * second pull is refused, and an automatic fetch that finds anything running is skipped (repository-pull: "An
 * automatic fetch and a pull never overlap", "Pulls and fetches are serialised per git repository").
 */
const inFlight = new Map<string, { kind: "pull" | "auto"; done: Promise<unknown> }>();

/** The repository's git common directory; a project whose git directory cannot be read keeps its id. */
async function lockKey(repo: RepoConfig): Promise<string> {
  const key = await repositoryKey(repo.path);
  return key ? `git:${key}` : `id:${repo.id}`;
}

export class PullBusyError extends Error {
  constructor() {
    super("already pulling");
  }
}

async function exclusively<T>(repo: RepoConfig, run: () => Promise<T>): Promise<T> {
  const key = await lockKey(repo);
  for (let running = inFlight.get(key); running; running = inFlight.get(key)) {
    if (running.kind === "pull") throw new PullBusyError();
    await running.done.catch(() => undefined);
  }
  const done = run();
  inFlight.set(key, { kind: "pull", done });
  try {
    return await done;
  } finally {
    inFlight.delete(key);
  }
}

/** `repo` must come from the dashboard config — never a path from a request. */
export function pullRepository(repo: RepoConfig, options: { fetchTimeoutMs?: number } = {}): Promise<PullResult> {
  return exclusively(repo, () => pull(repo, options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS));
}

export interface FetchOutcome {
  /** True when a pull or another fetch of the repository was running, so nothing ran at all. */
  skipped?: true;
  ok: boolean;
  at: string;
  /** Whether any remote-tracking ref moved, appeared or went away. */
  moved: boolean;
  /** git's reason when `ok` is false, credentials masked. */
  reason?: string;
}

/**
 * The automatic fetch: exactly the pull action's fetch, and nothing after it — no fast-forward, no prune, no hooks.
 * `repo` must come from the dashboard config. Skipped, running no git, while anything else fetches the repository.
 */
export async function fetchRepository(repo: RepoConfig, options: { fetchTimeoutMs?: number } = {}): Promise<FetchOutcome> {
  const key = await lockKey(repo);
  if (inFlight.has(key)) return { skipped: true, ok: false, at: new Date().toISOString(), moved: false };
  const done = autoFetch(repo, options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS);
  inFlight.set(key, { kind: "auto", done });
  try {
    return await done;
  } finally {
    inFlight.delete(key);
  }
}

async function autoFetch(repo: RepoConfig, fetchTimeoutMs: number): Promise<FetchOutcome> {
  const before = await inspect(repo.path);
  if (!before.hasRemote) return { ok: false, at: new Date().toISOString(), moved: false, reason: "no remote configured" };
  const refsBefore = await remoteRefs(repo.path);
  const fetched = await fetchRemote(repo.path, before, fetchTimeoutMs);
  const at = new Date().toISOString();
  if (!fetched.ok) return { ok: false, at, moved: false, reason: fetched.timedOut ? "timed out" : reasonFrom(fetched.err) };
  return { ok: true, at, moved: (await remoteRefs(repo.path)) !== refsBefore };
}

/** Every remote-tracking ref with the commit it names, as one string to compare. */
async function remoteRefs(repoPath: string): Promise<string> {
  return (await git(repoPath, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes/"])).out;
}

/**
 * Refs, FETCH_HEAD and objects only. No auto-maintenance and no hooks (`gitWrite`): a click (or a timer) must not turn
 * into a repack or a repository's script. Submodules are left alone, and nothing is pruned whatever `fetch.prune`,
 * `fetch.pruneTags` or `remote.<name>.prune` say. The remote is the upstream's, else `origin`.
 */
function fetchRemote(repoPath: string, inspection: Inspection, fetchTimeoutMs: number): Promise<Run> {
  const remote = inspection.remote ?? "origin";
  return writeGit(repoPath, ["fetch", "--no-recurse-submodules", "--no-prune", "--no-prune-tags", "--quiet", remote], fetchTimeoutMs);
}

async function pull(repo: RepoConfig, fetchTimeoutMs: number): Promise<PullResult> {
  const path = repo.path;
  const before = await inspect(path);
  const base = { repoId: repo.id, branch: before.branch, upstream: before.upstream, defaultBranch: await defaultBranch(path) };
  if (!before.hasRemote) return { ...base, fetched: false, update: "skipped", reason: "no remote configured; there is nothing to pull" };

  const fetched = await fetchRemote(path, before, fetchTimeoutMs);
  if (!fetched.ok) return { ...base, fetched: false, update: "failed", reason: fetched.timedOut ? "timed out" : reasonFrom(fetched.err) };

  const now = await inspect(path);
  const result = { ...base, branch: now.branch, upstream: now.upstream, fetched: true };
  const on = now.branch ? `on ${now.branch}` : "on a detached HEAD";
  if (base.defaultBranch === undefined) return { ...result, update: "skipped", reason: "the default branch is unknown; only fetched" };
  if (now.branch !== base.defaultBranch) return { ...result, update: "skipped", reason: `${on}, not ${base.defaultBranch}; only fetched` };
  if (!now.upstream) return { ...result, update: "skipped", reason: `${now.branch} has no upstream; only fetched` };
  if (now.behind === 0) return { ...result, update: "up-to-date" };
  if (now.ahead > 0) return { ...result, update: "refused", reason: `local and remote have diverged (${now.ahead} ahead, ${now.behind} behind)`, hint: DIVERGED_HINT };

  // Fast-forward or nothing. Hooks off: a plain merge would run the repository's post-merge hook.
  const merged = await fastForward(path, now.upstream);
  if (!merged.ok) return { ...result, ...refusalFrom(await blockingReport(path, now.upstream), reasonFrom(merged.err)) };
  return { ...result, update: "fast-forwarded", commits: now.behind, hooksSkipped: (await hasPostMergeHook(path)) || undefined };
}

// ---------------------------------------------------------------------------------------------------------------------
// Resolve and pull: the one thing the dashboard removes from a tracked repository.
//
// Nothing here runs without the user's confirmation, nothing here fetches, and nothing is removed before the whole
// classification has been proved again against the claim the user was shown
// (openspec/specs/repository-pull: "Change leftovers blocking a pull are resolved on confirmation").
// ---------------------------------------------------------------------------------------------------------------------

/** Where copies of leftovers that differ are kept. Under the dashboard's own home, never in a repository. */
export function pullBackupsDir(): string {
  return join(dashboardHome(), "pull-backups");
}

/** A repository id becomes a directory name only as `[A-Za-z0-9._-]`, and never as a path segment with a meaning. */
export function backupDirName(repoId: string): string {
  const safe = repoId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return safe === "" || safe === "." || safe === ".." ? "repo" : safe;
}

export interface ResolveOptions {
  /**
   * Test seam, unused in the product: runs after the leftovers are removed and before the retried fast-forward, so a
   * test can make that fast-forward fail and check the put-back.
   */
  beforeRetry?: () => void | Promise<void>;
}

/** The working-tree bytes of one leftover, held before it is removed so it can be put back exactly as it was. */
interface Held {
  file: PullBlockingFile;
  bytes: Buffer;
  mode: number;
}

/** git's `cat-file blob` as bytes: a staged version may be anything, and a copy of it must be byte-exact. */
async function blobBytes(repoPath: string, id: string): Promise<Uint8Array | undefined> {
  try {
    const proc = Bun.spawn(["git", "cat-file", "blob", id], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    const [buffer, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited]);
    return code === 0 ? new Uint8Array(buffer) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Puts every held leftover back — content, mode and staged state — and names the ones that could not be restored.
 * `top` is the repository's top level; the paths are relative to it.
 */
async function putBack(top: string, held: Held[], stagedPaths: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const { file, bytes, mode } of held) {
    const absolute = join(top, ...file.path.split("/"));
    try {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);
      await chmod(absolute, mode);
    } catch {
      failed.push(file.path);
    }
  }
  const restage = stagedPaths.filter((path) => !failed.includes(path));
  if (restage.length > 0) {
    const added = await writeGit(top, ["add", "--", ...restage.map(topLiteral)]);
    if (!added.ok) failed.push(...restage);
  }
  return failed;
}

/** `repo` must come from the dashboard config; `claim` is only ever a claim, re-checked here before anything moves. */
export function resolvePullRepository(repo: RepoConfig, claim: PullResolve, options: ResolveOptions = {}): Promise<PullResult> {
  return exclusively(repo, () => resolvePull(repo, claim, options));
}

async function resolvePull(repo: RepoConfig, claim: PullResolve, options: ResolveOptions): Promise<PullResult> {
  const path = repo.path;
  const now = await inspect(path);
  // No fetch: the user confirmed what a previous pull's fetch found, and a second fetch could move the upstream again.
  const base = { repoId: repo.id, fetched: false, branch: now.branch, upstream: now.upstream, defaultBranch: await defaultBranch(path) };
  const refuse = (reason: string, extra: Partial<PullResult> = {}): PullResult => ({ ...base, update: "refused", reason, ...extra });

  if (base.defaultBranch === undefined || now.branch !== base.defaultBranch) {
    return refuse(`the checkout is ${now.branch ? `on ${now.branch}` : "on a detached HEAD"}, not on its default branch; nothing was changed`);
  }
  if (!now.upstream) return refuse(`${now.branch} has no upstream; nothing was changed`);
  if (now.ahead > 0) return refuse(`local and remote have diverged (${now.ahead} ahead, ${now.behind} behind); nothing was changed`, { hint: DIVERGED_HINT });
  if (now.behind === 0) return { ...base, update: "up-to-date" };

  const report = await blockingReport(path, now.upstream);
  if (!report) return refuse("the repository's state could not be read; nothing was changed");
  const fresh = refusalFrom(report, "");
  const again = (reason: string): PullResult => refuse(reason, { blocking: fresh.blocking, resolvable: fresh.resolvable, hint: fresh.hint });

  if (report.upstream !== claim.upstream) return again("the upstream moved on since those files were listed; pull again to see where it stands");
  if (report.capped || report.files.length === 0 || report.files.some((f) => f.kind !== "leftover")) {
    return again("a blocking file is not a change leftover; nothing was removed");
  }
  if (report.files.length !== claim.files.length || !report.files.every((file, i) => sameClaim(file, claim.files[i]))) {
    return again("the blocking files are no longer the ones that were shown; pull again to see where they stand");
  }

  const leftovers = report.files;
  // Every leftover path is relative to the top level, which in a project in a subfolder is not `path`.
  const top = report.top;
  // A copy first: anything whose local content is not what the fast-forward will write is kept before it is removed.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups = join(pullBackupsDir(), backupDirName(repo.id), stamp);
  const copies = new Map<string, string>();
  for (const file of leftovers) {
    if (!file.differs) continue;
    const target = join(backups, ...file.path.split("/"));
    try {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(top, ...file.path.split("/")), target);
      // A staged version that is neither the working tree's nor the incoming one is a third state worth keeping too.
      if (file.staged !== undefined && file.staged !== file.worktree && file.staged !== file.incoming) {
        const bytes = await blobBytes(path, file.staged);
        if (!bytes) throw new Error("the staged version could not be read");
        await writeFile(`${target}.staged`, bytes);
      }
      copies.set(file.path, target);
    } catch (err) {
      return again(`nothing was changed: a copy of ${file.path} could not be saved (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Held before anything is removed: these exact bytes are what a failed fast-forward puts back.
  const held: Held[] = [];
  for (const file of leftovers) {
    const absolute = join(top, ...file.path.split("/"));
    try {
      held.push({ file, bytes: await readFile(absolute), mode: (await lstat(absolute)).mode & 0o777 });
    } catch (err) {
      return again(`nothing was changed: ${file.path} could not be read (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // The working tree first, then the index: `git rm --cached` refuses an edited staged file while it is still on disk,
  // and forcing it is not on the table. Directories stay: the fast-forward refills them, and git ignores empty ones.
  for (const { file } of held) await rm(join(top, ...file.path.split("/")), { force: true });
  const stagedPaths = leftovers.filter((file) => file.staged !== undefined).map((file) => file.path);
  if (stagedPaths.length > 0) {
    const unstaged = await writeGit(top, ["rm", "--cached", "--quiet", "--", ...stagedPaths.map(topLiteral)]);
    if (!unstaged.ok) {
      const lost = await putBack(top, held, stagedPaths);
      return again(`nothing was pulled: ${reasonFrom(unstaged.err)}${restoreNote(lost, backups, copies.size)}`);
    }
  }

  if (options.beforeRetry) await options.beforeRetry();
  const merged = await fastForward(path, now.upstream);
  if (!merged.ok) {
    const lost = await putBack(top, held, stagedPaths);
    return refuse(reasonFrom(merged.err), { blocking: leftovers, hint: `Nothing was pulled.${restoreNote(lost, backups, copies.size)}` });
  }
  return {
    ...base,
    update: "fast-forwarded",
    commits: now.behind,
    resolved: leftovers.map((file) => ({ path: file.path, copy: copies.get(file.path) })),
    hooksSkipped: (await hasPostMergeHook(path)) || undefined,
  };
}

/** What became of the leftovers after a fast-forward that was still refused, and where their copies are. */
function restoreNote(lost: string[], backups: string, copied: number): string {
  const back = lost.length === 0 ? " The listed files are back as they were." : ` These files could not be put back: ${lost.join(", ")}.`;
  return `${back}${copied > 0 ? ` Copies of what differed are in ${backups}.` : ""}`;
}

/** Every repository on its own: one that fails or is busy does not stop the others. */
export async function pullAll(repos: RepoConfig[], options: { fetchTimeoutMs?: number } = {}): Promise<PullResult[]> {
  const results: PullResult[] = new Array(repos.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < repos.length) {
      const index = next++;
      try {
        results[index] = await pullRepository(repos[index], options);
      } catch (err) {
        results[index] = { repoId: repos[index].id, fetched: false, update: "failed", reason: err instanceof Error ? err.message : String(err) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PULL_ALL_CONCURRENCY, repos.length) }, worker));
  return results;
}
