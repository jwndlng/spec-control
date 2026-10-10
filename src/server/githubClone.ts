// Add from GitHub (openspec/specs/github-repositories): on the user's confirmation, one new folder directly inside a
// workspace root, made with an exclusive create under New project's placement rules (`newFolder.ts`), and `git clone`
// into it from a URL built here from a validated `owner/name` — never one taken from a request. This is the only place
// that runs `git clone`; it writes nothing into the clone, adds or changes no remote and configures nothing in it.
//
// The clone runs under the pull action's rules: git's own credentials, no terminal prompt, SSH in batch mode, no stdin,
// no hooks, no automatic maintenance, a timeout, and credentials masked in every reason. When it fails, the folder is
// removed only if git left it empty — a non-recursive `rmdir`, so nothing else can ever be deleted. Clones run in the
// background, at most two at a time — a third is queued — and the user may cancel one, which ends it like a failure.
// Their outcomes and progress live in memory until the dashboard restarts (never history, invariant 5) and are never an
// input to scanning, columns or actions.
import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { defaultCloneFolder, githubCloneUrl, parseGithubRepo } from "../shared/github.ts";
import type { GithubClone, GithubClonePhase } from "../shared/types.ts";
import { REDIRECTING_GIT_ENV } from "./createProject.ts";
import { isSpecProject } from "./discover.ts";
import { checkNewFolder, makeNewFolder, NewFolderError } from "./newFolder.ts";
import { canonicalPath, dashboardHome, whichOnPath } from "./paths.ts";
import { reasonFrom } from "./pull.ts";

export const CLONE_TIMEOUT_MS = 10 * 60_000;
export const MAX_RUNNING_CLONES = 2;

const CREDENTIALS_HINT = "a private repository needs git credentials for github.com, for example through `gh auth setup-git`";

/** git's own words for "it would have needed credentials" — GitHub answers a private repository without them as "not found". */
function needsCredentials(stderr: string): boolean {
  return /authentication failed|could not read (username|password)|terminal prompts disabled|repository not found|permission denied|403/i.test(stderr);
}

/** What a failed clone reports: git's own reason, masked, and for a likely credentials problem what to do about it. */
export function cloneFailureReason(stderr: string): string {
  const reason = reasonFrom(stderr);
  return needsCredentials(stderr) ? `${reason} — ${CREDENTIALS_HINT}` : reason;
}

/** An empty directory under the home that `core.hooksPath` points at: no hook — not even a template's — can run. */
async function emptyHooksDir(): Promise<string> {
  const dir = join(dashboardHome(), "clone-hooks");
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---- progress (git clone --progress) ----

/** One progress report, parsed: the only thing of git's output a clone keeps apart from a failure's reason. */
export interface ParsedProgress {
  phase: GithubClonePhase;
  percent?: number;
  receivedBytes?: number;
}

const UNITS: Record<string, number> = { bytes: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };
const PHASES: [RegExp, GithubClonePhase][] = [
  [/^Receiving objects:\s+(\d{1,3})%/, "receiving"],
  [/^Resolving deltas:\s+(\d{1,3})%/, "resolving"],
  [/^(?:Updating files|Checking out files):\s+(\d{1,3})%/, "checkout"],
];

/** One line of git's `--progress` output (`LC_ALL=C`), or `undefined` for anything it does not recognise. */
export function parseProgressLine(line: string): ParsedProgress | undefined {
  const text = line.trim();
  for (const [pattern, phase] of PHASES) {
    const match = pattern.exec(text);
    if (!match) continue;
    const progress: ParsedProgress = { phase, percent: Math.min(100, Number(match[1])) };
    const size = phase === "receiving" ? /\),\s*([\d.]+)\s*(bytes|KiB|MiB|GiB|TiB)\b/.exec(text) : null;
    if (size) progress.receivedBytes = Math.round(Number(size[1]) * UNITS[size[2]]);
    return progress;
  }
  // The server's own reports (enumerating, counting, compressing): the transfer has not begun.
  if (text.startsWith("remote:")) return { phase: "connecting" };
  return undefined;
}

export const STDERR_TAIL = 8 * 1024;

/**
 * Reads git's standard error as it arrives: updates are separated by `\r`, lines by `\n`, and a chunk may end in the
 * middle of either. Recognised progress lines become reports; every other line is kept in a bounded tail, which is all
 * a failure's reason is made from.
 */
export class ProgressParser {
  private partial = "";
  private kept = "";

  /** The latest report among the complete lines of `chunk` (with what was left over before), if any. */
  feed(chunk: string): ParsedProgress | undefined {
    const parts = (this.partial + chunk).split(/\r\n|\r|\n/);
    this.partial = parts.pop() ?? "";
    // Unbounded only for a line without any separator; git never writes one that long.
    if (this.partial.length > STDERR_TAIL) this.partial = this.partial.slice(-STDERR_TAIL);
    let latest: ParsedProgress | undefined;
    for (const line of parts) latest = this.line(line) ?? latest;
    return latest;
  }

  /** What is left once git has exited. */
  end(): ParsedProgress | undefined {
    const rest = this.partial;
    this.partial = "";
    return rest ? this.line(rest) : undefined;
  }

  /** Everything that was not a percentage, newest last, at most `STDERR_TAIL` characters. */
  tail(): string {
    return this.kept;
  }

  private line(line: string): ParsedProgress | undefined {
    const progress = parseProgressLine(line);
    if (progress?.percent === undefined && line.trim()) this.kept = `${this.kept}${line}\n`.slice(-STDERR_TAIL);
    return progress;
  }
}

// ---- the clone ----

export const CANCEL_GRACE_MS = 5000;

export type CloneResult = { outcome: "cloned" } | { outcome: "failed"; reason: string } | { outcome: "cancelled" };

export interface CloneOptions {
  timeoutMs?: number;
  /** Cancel: git gets SIGTERM, then SIGKILL after `CANCEL_GRACE_MS`. A clone that exited 0 first is still `cloned`. */
  signal?: AbortSignal;
  onProgress?: (progress: ParsedProgress) => void;
}

/**
 * `git clone --progress` of `repo` into the existing, empty `target`, its standard error read as it arrives. Its working
 * directory is the dashboard home, so git never starts inside a repository; `LC_ALL=C` keeps its reports untranslated.
 */
export async function cloneInto(repo: string, target: string, options: CloneOptions = {}): Promise<CloneResult> {
  const { timeoutMs = CLONE_TIMEOUT_MS, signal, onProgress } = options;
  if (signal?.aborted) return { outcome: "cancelled" };
  const home = dashboardHome();
  const hooks = await emptyHooksDir();
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };
  delete env.LANGUAGE;
  for (const key of REDIRECTING_GIT_ENV) delete env[key];
  if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  const argv = ["git", "-c", `core.hooksPath=${hooks}`, "-c", "maintenance.auto=false", "-c", "gc.auto=0", "clone", "--progress", "--no-recurse-submodules", "--origin", "origin", "--", githubCloneUrl(repo), target];
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const proc = Bun.spawn(argv, { cwd: home, stdout: "ignore", stderr: "pipe", stdin: "ignore", env });
    const stop = () => {
      if (killTimer) return;
      proc.kill("SIGTERM");
      killTimer = setTimeout(() => proc.kill("SIGKILL"), CANCEL_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    const parser = new ProgressParser();
    const reader = proc.stderr.getReader();
    // Read as it arrives, so a chatty clone can never fill the pipe.
    const reading = (async () => {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const progress = parser.feed(decoder.decode(value, { stream: true }));
        if (progress) onProgress?.(progress);
      }
      parser.end();
    })().catch(() => {});
    try {
      // The exit decides, not the pipe: a transport helper git started could outlive a killed git and hold it open.
      const code = await proc.exited;
      await Promise.race([reading, Bun.sleep(1000)]);
      void reader.cancel().catch(() => {});
      if (code === 0) return { outcome: "cloned" };
      if (signal?.aborted) return { outcome: "cancelled" };
      if (timedOut) return { outcome: "failed", reason: `the clone did not finish within ${Math.round(timeoutMs / 60_000) || 1} minutes` };
      return { outcome: "failed", reason: cloneFailureReason(parser.tail()) };
    } finally {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", stop);
    }
  } catch (err) {
    return { outcome: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** The part of the app clones need. `AppState` satisfies it through `api.ts`'s wiring. */
export interface CloneContext {
  config: () => Parameters<typeof checkNewFolder>[0];
  /** Adds a clone holding the project marker through the serialised track path; resolves to whether it was added. */
  track: (path: string) => Promise<boolean>;
}

export const PROGRESS_INTERVAL_MS = 500;

/** A clone's entry with what only the server needs: its outcome, how to stop it, and its progress not shown yet. */
interface Job extends GithubClone {
  done?: Promise<void>;
  abort?: AbortController;
  /** Hands a waiting job its slot (`true`) or takes it out of the queue (`false`). */
  admit?: (run: boolean) => void;
  pending?: ParsedProgress;
  pendingTimer?: ReturnType<typeof setTimeout>;
  shownAt?: number;
}

const isActive = (state: GithubClone["state"]) => state === "queued" || state === "cloning";

/**
 * The clones started since the dashboard started. `start` checks everything first, so a refusal creates nothing and
 * starts no process; the folder exists by the time it returns, and git runs once one of the two slots is free — until
 * then the clone is `queued`. Cancel takes a queued clone out of the queue or stops git, and then removes the folder
 * exactly as a failure does: only if it is empty.
 */
export class GithubClones {
  private readonly jobs: Job[] = [];
  private running = 0;
  private readonly waiting: Job[] = [];
  private nextId = 1;
  private readonly timeoutMs: number;
  private readonly maxRunning: number;
  private readonly progressIntervalMs: number;
  private readonly now: () => number;
  private readonly onChange?: (clone: GithubClone) => void;

  constructor(
    private readonly context: CloneContext,
    options: { timeoutMs?: number; maxRunning?: number; progressIntervalMs?: number; now?: () => number; onChange?: (clone: GithubClone) => void } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? CLONE_TIMEOUT_MS;
    this.maxRunning = options.maxRunning ?? MAX_RUNNING_CLONES;
    this.progressIntervalMs = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange;
  }

  list(): GithubClone[] {
    return this.jobs.map(entry);
  }

  /** Target folders of clones queued or running: discovery leaves them out. */
  runningPaths(): string[] {
    return this.jobs.filter((j) => isActive(j.state)).map((j) => j.path);
  }

  /** Resolves once the clone has an outcome; tests wait on it. */
  settled(id: string): Promise<void> {
    return this.jobs.find((j) => j.id === id)?.done ?? Promise.resolve();
  }

  async start(input: { repo?: unknown; root?: unknown; name?: unknown }): Promise<GithubClone> {
    const parsed = parseGithubRepo(input.repo);
    if (!parsed.ok) throw new NewFolderError(400, parsed.reason);
    const name = input.name === undefined ? defaultCloneFolder(parsed.repo) : input.name;
    if (!whichOnPath("git")) throw new NewFolderError(503, "git was not found on this machine");
    const { root, path } = await checkNewFolder(this.context.config(), input.root, name);
    await makeNewFolder(path);

    // A retry is a new request for the same target: it replaces the finished entry rather than listing it twice.
    const previous = this.jobs.findIndex((j) => j.path === path && !isActive(j.state));
    if (previous >= 0) this.jobs.splice(previous, 1);
    const job: Job = { id: `clone-${this.nextId++}`, repo: parsed.repo, root, name: name as string, path, state: "queued", startedAt: new Date(this.now()).toISOString() };
    this.jobs.push(job);
    job.done = this.run(job);
    return entry(job);
  }

  /**
   * Cancels a queued or running clone and resolves to its entry once it is `cancelled`. `409` for a clone that has an
   * outcome — including one that finished while the cancel was on its way — and `404` for an unknown id.
   */
  async cancel(id: unknown): Promise<GithubClone> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new NewFolderError(404, "no such clone");
    if (!isActive(job.state)) throw new NewFolderError(409, `the clone has already ${job.state === "cancelled" ? "been cancelled" : "finished"}`);
    if (job.admit) job.admit(false);
    else job.abort?.abort();
    await job.done;
    if (entry(job).state !== "cancelled") throw new NewFolderError(409, "the clone finished before it could be cancelled");
    return entry(job);
  }

  /** Drops a finished entry. `409` for a clone queued or running, `404` for an unknown id. */
  dismiss(id: unknown): void {
    const at = this.jobs.findIndex((j) => j.id === id);
    if (at < 0) throw new NewFolderError(404, "no such clone");
    if (isActive(this.jobs[at].state)) throw new NewFolderError(409, "the clone is still running");
    this.jobs.splice(at, 1);
  }

  /** `true` when a slot is free now; otherwise resolves to whether the job got one — `false` once it was cancelled while waiting. */
  private slot(job: Job): true | Promise<boolean> {
    if (this.running < this.maxRunning) {
      this.running++;
      return true;
    }
    // Handed over by `release` without decrementing, so no third clone can slip in between.
    return new Promise<boolean>((resolve) => {
      job.admit = (run) => {
        job.admit = undefined;
        this.waiting.splice(this.waiting.indexOf(job), 1);
        resolve(run);
      };
      this.waiting.push(job);
    });
  }

  private release(): void {
    const next = this.waiting[0];
    if (next) next.admit?.(true);
    else this.running--;
  }

  private changed(job: Job): void {
    this.onChange?.(entry(job));
  }

  /** A phase change is shown at once; reports within a phase at most every `progressIntervalMs`. */
  private report(job: Job, progress: ParsedProgress): void {
    if (job.state !== "cloning") return;
    const since = this.now() - (job.shownAt ?? 0);
    if (progress.phase !== job.progress?.phase || since >= this.progressIntervalMs) {
      this.show(job, progress);
      return;
    }
    job.pending = progress;
    job.pendingTimer ??= setTimeout(() => {
      job.pendingTimer = undefined;
      if (job.pending && job.state === "cloning") this.show(job, job.pending);
    }, this.progressIntervalMs - since);
  }

  private show(job: Job, progress: ParsedProgress): void {
    job.pending = undefined;
    job.shownAt = this.now();
    job.progress = { ...progress, updatedAt: new Date(job.shownAt).toISOString() };
    this.changed(job);
  }

  private async run(job: Job): Promise<void> {
    // No await when a slot is free, so `start` already answers `cloning`.
    const slot = this.slot(job);
    if (slot !== true && !(await slot)) {
      await this.removeEmpty(job, "cancelled");
      return;
    }
    job.abort = new AbortController();
    job.state = "cloning";
    this.show(job, { phase: "connecting" });
    let result: CloneResult;
    try {
      result = await cloneInto(job.repo, job.path, { timeoutMs: this.timeoutMs, signal: job.abort.signal, onProgress: (p) => this.report(job, p) });
    } finally {
      this.release();
      if (job.pendingTimer) clearTimeout(job.pendingTimer);
      job.pendingTimer = undefined;
    }
    if (result.outcome !== "cloned") {
      await this.removeEmpty(job, result.outcome, result.outcome === "failed" ? result.reason : undefined);
      return;
    }
    const folder = canonicalPath(job.path);
    const tracked =
      (await isSpecProject(folder)) &&
      (await this.context.track(folder).then(
        () => true,
        (err) => {
          console.warn(`could not track ${folder}:`, err instanceof Error ? err.message : err);
          return false;
        },
      ));
    this.finish(job, tracked ? "tracked" : "integratable");
  }

  /** Non-recursive: succeeds only when the folder is empty, and can never delete anything else. */
  private async removeEmpty(job: Job, state: "failed" | "cancelled", reason?: string): Promise<void> {
    const removed = await rmdir(job.path).then(
      () => true,
      () => false,
    );
    const left = removed ? undefined : `the folder ${job.path} was left in place`;
    this.finish(job, state, reason && left ? `${reason} (${left})` : (reason ?? left));
  }

  private finish(job: Job, state: GithubClone["state"], reason?: string): void {
    job.state = state;
    job.progress = undefined;
    job.abort = undefined;
    if (reason) job.reason = reason;
    job.finishedAt = new Date(this.now()).toISOString();
    this.changed(job);
  }
}

/** The public entry of a job: what `GET /api/github/clones` lists. */
function entry(job: Job): GithubClone {
  const { id, repo, root, name, path, state, progress, reason, startedAt, finishedAt } = job;
  return { id, repo, root, name, path, state, ...(progress ? { progress: { ...progress } } : {}), ...(reason ? { reason } : {}), startedAt, ...(finishedAt ? { finishedAt } : {}) };
}
