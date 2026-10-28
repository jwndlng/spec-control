// Pull requests of the tracked repositories, read through the user's own GitHub CLI.
//
// This is the second — and only other — place in the dashboard that reaches a network, next to the pull action
// (openspec/specs/dashboard-api: "never writes"; openspec/specs/pull-requests). It runs `gh pr list` and
// `gh api user` and nothing else, never in a tracked repository's directory (the repository is named with `--repo`,
// the process runs in the dashboard home), and only because the user opened or refreshed a pull-request list.
// It writes nothing to a repository, runs no git command but the read-only `config --get remote.origin.url`
// that discovery already uses, and changes nothing on GitHub.
//
// Everything it keeps is display-only: the cache is never an input to scanning, columns, counts or actions.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PullRequest, PullRequestsResponse, RepoPullRequests } from "../shared/types.ts";
import { type GhFailure as Failure, GH_TIMEOUT_MS, failureOf, githubRepoFromRemote, runGh } from "./gh.ts";
import { originUrl } from "./git.ts";
import { pullRequestsCachePath } from "./paths.ts";

export { GH_TIMEOUT_MS, ghReason, githubRepoFromRemote } from "./gh.ts";

/** A list younger than this is not fetched again unless the user asks for it explicitly. */
export const FRESHNESS_MS = 5 * 60_000;
/** Open pull requests per GitHub repository; one more is asked for, to notice the limit was reached. */
export const OPEN_LIMIT = 100;
export const CLOSED_LIMIT = 50;
/** How far back "recently merged or closed" reaches. */
export const CLOSED_WITHIN_DAYS = 7;
/** GitHub repositories queried at the same time. */
const CONCURRENCY = 3;
/**
 * The least time between two of the board's watch queries of one GitHub repository, across every tab and window: a
 * refresh naming `repoIds` leaves out a repository whose last query settled less than this ago, `force` or not.
 */
export const WATCH_MIN_GAP_MS = 60_000;
const CACHE_VERSION = 1;

/** Only the documented `--json` fields; anything else is parsed defensively or ignored. */
const FIELDS = "number,title,url,author,headRefName,baseRefName,isDraft,state,createdAt,mergedAt,closedAt,reviewDecision,reviewRequests,statusCheckRollup,mergeable,headRefOid,isCrossRepository";
/**
 * Asked for in addition only on the open call, and only for a GitHub repository an enabled project with docs auto-merge
 * maps to (agent-merges-docs-prs D2): enough to answer "docs-only", and dropped right after parsing.
 */
const FILE_FIELDS = "files,changedFiles";

/** A tracked repository as the store sees it: never a path from a request — ids and paths come from the config. */
export interface RepoTarget {
  id: string;
  path: string;
  isGit: boolean;
  /** The project has docs auto-merge on: its open pull requests are asked for their changed files. */
  autoMergeDocs?: boolean;
}


interface CacheEntry {
  fetchedAt?: string;
  pullRequests: PullRequest[];
  truncated?: { open: boolean; closed: boolean };
  /** This session's last failure; never persisted — a restart shows the cached list, not an old error. */
  error?: Failure;
}

interface StoredCache {
  version: number;
  viewer?: string;
  repos: Record<string, { fetchedAt?: string; pullRequests: PullRequest[]; truncated?: { open: boolean; closed: boolean } }>;
}

// ---- parsing ----

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const REVIEW: Record<string, PullRequest["review"]> = { APPROVED: "approved", CHANGES_REQUESTED: "changes_requested", REVIEW_REQUIRED: "review_required" };
const STATE: Record<string, PullRequest["state"]> = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };
const MERGEABLE: Record<string, NonNullable<PullRequest["mergeable"]>> = { MERGEABLE: "mergeable", CONFLICTING: "conflicting" };

const HEAD_OID = /^[0-9a-f]{40}$/;

/** GitHub's `headRefOid`: a full object name, or nothing — never a value that could be taken for one. */
export function parseHeadOid(value: unknown): string | undefined {
  return typeof value === "string" && HEAD_OID.test(value) ? value : undefined;
}

/**
 * Whether GitHub's changed files are all under `openspec/` at the repository root. Only a complete list counts: `gh`
 * returns at most 100 paths, so a count larger than the paths returned — or any field missing or malformed — is not
 * docs-only. Undefined when the files were not asked for at all.
 */
export function parseDocsOnly(entry: Record<string, unknown>): boolean | undefined {
  if (!("files" in entry) && !("changedFiles" in entry)) return undefined;
  const { files, changedFiles } = entry;
  if (!Array.isArray(files) || typeof changedFiles !== "number" || !Number.isInteger(changedFiles)) return false;
  if (changedFiles < 1 || files.length !== changedFiles) return false;
  return files.every((file) => {
    const path = (file as Record<string, unknown> | null)?.path;
    return typeof path === "string" && path.startsWith("openspec/") && path.length > "openspec/".length && !path.split("/").includes("..");
  });
}

/** GitHub's `isCrossRepository`: only a boolean is an answer; anything else leaves it unknown, which refuses like a fork. */
export function parseCrossRepository(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** GitHub's `mergeable`; anything missing or unrecognised is `unknown`, so drift never looks mergeable. */
export function parseMergeable(value: unknown): NonNullable<PullRequest["mergeable"]> {
  return MERGEABLE[str(value).toUpperCase()] ?? "unknown";
}
const FAILING_CONCLUSIONS = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const FAILING_STATES = new Set(["FAILURE", "ERROR"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

/**
 * One summary for a pull request's checks. A single failing check outweighs everything; otherwise anything still
 * running keeps it pending. Unknown values are treated as pending rather than passing, so drift never looks green.
 */
export function summarizeChecks(rollup: unknown): PullRequest["checks"] {
  if (!Array.isArray(rollup) || rollup.length === 0) return "none";
  let pending = false;
  for (const raw of rollup) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    if ("conclusion" in entry || "status" in entry) {
      const conclusion = str(entry.conclusion).toUpperCase();
      const status = str(entry.status).toUpperCase();
      if (FAILING_CONCLUSIONS.has(conclusion)) return "failing";
      if (status !== "COMPLETED" || conclusion === "") pending = true;
      else if (!["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) pending = true;
    } else {
      const state = str(entry.state).toUpperCase();
      if (FAILING_STATES.has(state)) return "failing";
      if (PENDING_STATES.has(state) || state === "") pending = true;
      else if (state !== "SUCCESS") pending = true;
    }
  }
  return pending ? "pending" : "passing";
}

/** One entry of `gh pr list --json …`, or undefined when it carries no usable number. */
export function parsePullRequest(raw: unknown, viewer?: string): PullRequest | undefined {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const number = typeof entry.number === "number" ? entry.number : Number.NaN;
  if (!Number.isInteger(number)) return undefined;
  const author = (entry.author ?? {}) as Record<string, unknown>;
  const requests = Array.isArray(entry.reviewRequests) ? entry.reviewRequests : [];
  // Team review requests carry a name rather than a login; resolving team membership would need more calls, so only
  // a direct request counts as "from you" (openspec/specs/pull-requests, and the design's risks).
  const requestedFromViewer =
    viewer !== undefined && requests.some((r) => str((r as Record<string, unknown>)?.login).toLowerCase() === viewer.toLowerCase());
  const mergedAt = str(entry.mergedAt) || undefined;
  const closedAt = str(entry.closedAt) || undefined;
  const headOid = parseHeadOid(entry.headRefOid);
  const docsOnly = parseDocsOnly(entry);
  const isCrossRepository = parseCrossRepository(entry.isCrossRepository);
  // The paths are read here and nowhere else: only the answer is kept, cached and sent to the browser.
  return {
    number,
    title: str(entry.title),
    url: str(entry.url),
    author: str(author.login),
    head: str(entry.headRefName),
    base: str(entry.baseRefName),
    draft: entry.isDraft === true,
    state: STATE[str(entry.state).toUpperCase()] ?? (mergedAt ? "merged" : closedAt ? "closed" : "open"),
    createdAt: str(entry.createdAt),
    mergedAt,
    closedAt,
    review: REVIEW[str(entry.reviewDecision).toUpperCase()] ?? "none",
    reviewRequestedFromViewer: requestedFromViewer,
    checks: summarizeChecks(entry.statusCheckRollup),
    mergeable: parseMergeable(entry.mergeable),
    ...(headOid ? { headOid } : {}),
    ...(docsOnly !== undefined ? { docsOnly } : {}),
    ...(isCrossRepository !== undefined ? { isCrossRepository } : {}),
  };
}

/**
 * A cached pull request as this version reads it: mergeability `unknown` when it predates it, a head commit only when
 * it is one, docs-only only when it says exactly that — so an old or edited cache can never trigger a merge.
 */
function fromCache(pr: PullRequest): PullRequest {
  const { headOid, docsOnly, isCrossRepository, ...rest } = pr;
  const head = parseHeadOid(headOid);
  const cross = parseCrossRepository(isCrossRepository);
  return { ...rest, mergeable: parseMergeable(pr.mergeable), ...(head ? { headOid: head } : {}), ...(typeof docsOnly === "boolean" ? { docsOnly } : {}), ...(cross !== undefined ? { isCrossRepository: cross } : {}) };
}

/** When a pull request left the open list; undefined while it is open. */
function endedAt(pr: PullRequest): number | undefined {
  const iso = pr.mergedAt ?? pr.closedAt;
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

/** Newest first: open ones by when they were opened, closed ones by when they ended. */
function newestFirst(a: PullRequest, b: PullRequest): number {
  const at = (pr: PullRequest) => {
    const t = endedAt(pr) ?? Date.parse(pr.createdAt);
    return Number.isNaN(t) ? 0 : t;
  };
  return at(b) - at(a) || b.number - a.number;
}

// ---- the store ----

export interface PullRequestsOptions {
  /** Only this repository (and the enabled repositories sharing its GitHub repository). */
  repoId?: string;
  /** Only these repositories (and the enabled repositories sharing their GitHub repositories): the board's watch. */
  repoIds?: string[];
  /** Query regardless of how fresh the cached list is. */
  force?: boolean;
}

/**
 * The cache of pull-request lists, keyed by GitHub repository so two clones of one project share one entry, and the
 * coordination around refreshing it. One instance per running dashboard.
 */
export class PullRequests {
  private readonly cache = new Map<string, CacheEntry>();
  private viewer?: string;
  /** `origin` → GitHub repository, per repository path; a repository's remote does not change while it is tracked. */
  private readonly origins = new Map<string, string | undefined>();
  /** One query per GitHub repository at a time; a request arriving during one awaits it instead of starting another. */
  private readonly inFlight = new Map<string, Promise<void>>();
  /** When each GitHub repository's last query settled, successful or not; memory only, for the watch's minimum gap. */
  private readonly lastQueriedAt = new Map<string, number>();
  /** The tail of the cache writes: one at a time, so two refreshes finishing together cannot share the temp file. */
  private persisting: Promise<void> = Promise.resolve();
  private viewerFetch?: Promise<void>;
  /** "Not installed" / "not signed in" applies to every repository: once seen, the rest of the round reuses it. */
  private blocked?: Failure;
  /** Refreshes in flight; while one runs the next joins its round rather than starting its own. */
  private rounds = 0;
  private loaded = false;

  private readonly now: () => number;
  private readonly timeoutMs: number;

  /** `timeoutMs` is only lowered by tests, which must not wait half a minute for the real one. */
  constructor(options: { now?: () => number; timeoutMs?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? GH_TIMEOUT_MS;
  }

  /** Reads the cache written by an earlier run. A missing or unreadable file simply means "never fetched". */
  async load(): Promise<void> {
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(pullRequestsCachePath(), "utf8")) as Partial<StoredCache>;
      if (parsed.version !== CACHE_VERSION || !parsed.repos || typeof parsed.repos !== "object") return;
      this.viewer = typeof parsed.viewer === "string" ? parsed.viewer : undefined;
      for (const [repo, entry] of Object.entries(parsed.repos)) {
        if (!Array.isArray(entry?.pullRequests)) continue;
        // A cache written before mergeability was read lacks it: still version 1, read as `unknown` until refreshed.
        const pullRequests = entry.pullRequests.map((pr) => (pr && typeof pr === "object" ? fromCache(pr) : pr));
        this.cache.set(repo, { fetchedAt: entry.fetchedAt, pullRequests, truncated: entry.truncated });
      }
    } catch {
      // No cache, or one this version cannot read: nothing has been fetched as far as we are concerned.
    }
  }

  /** The memoised `origin` lookups; call after the configuration changed, so a re-pointed remote is seen. */
  forgetOrigins(): void {
    this.origins.clear();
  }

  private async githubRepoOf(target: RepoTarget): Promise<string | undefined> {
    if (!target.isGit) return undefined;
    if (this.origins.has(target.path)) return this.origins.get(target.path);
    const repo = githubRepoFromRemote(await originUrl(target.path));
    this.origins.set(target.path, repo);
    return repo;
  }

  /**
   * The last good list of one repository, from what is already known in this process — no remote lookup, so not even
   * a read-only git runs for it. Undefined when its GitHub repository was not looked up yet or it was never fetched.
   * This is what the Merge action reads its pull request and head commit from.
   */
  lastGood(target: RepoTarget): readonly PullRequest[] | undefined {
    if (!target.isGit || !this.origins.has(target.path)) return undefined;
    const github = this.origins.get(target.path);
    const entry = github ? this.cache.get(github) : undefined;
    return entry?.fetchedAt ? entry.pullRequests : undefined;
  }

  /** The cached lists, projected per enabled repository. Contacts nothing and starts no `gh`. */
  async list(targets: RepoTarget[]): Promise<PullRequestsResponse> {
    if (!this.loaded) await this.load();
    const repos: RepoPullRequests[] = [];
    for (const target of targets) {
      const github = await this.githubRepoOf(target);
      if (!github) {
        repos.push({ repoId: target.id, status: "unavailable", reason: target.isGit ? "not on GitHub" : "not a git repository", pullRequests: [] });
        continue;
      }
      const entry = this.cache.get(github);
      if (!entry) {
        repos.push({ repoId: target.id, github, status: "never", pullRequests: [] });
        continue;
      }
      repos.push({
        repoId: target.id,
        github,
        status: entry.error ? entry.error.kind : "ok",
        reason: entry.error?.reason,
        setup: entry.error?.setup,
        fetchedAt: entry.fetchedAt,
        truncated: entry.truncated,
        pullRequests: entry.pullRequests,
      });
    }
    return { viewer: this.viewer, repos };
  }

  /**
   * Queries GitHub for the repositories that need it and answers with the same projection as `list`. Repositories
   * whose list is still fresh are left alone unless `force` is set, and a query already running for a GitHub
   * repository is joined rather than started a second time.
   */
  async refresh(targets: RepoTarget[], options: PullRequestsOptions = {}): Promise<PullRequestsResponse> {
    if (!this.loaded) await this.load();
    // The first refresh of a round decides whether `gh` is there and signed in; refreshes joining it reuse that answer.
    const startsRound = this.rounds === 0;
    if (startsRound) this.blocked = undefined;
    this.rounds++;
    try {
      const byGithub = new Map<string, RepoTarget[]>();
      for (const target of targets) {
        const github = await this.githubRepoOf(target);
        if (!github) continue;
        byGithub.set(github, [...(byGithub.get(github) ?? []), target]);
      }

      const wanted = [...byGithub.entries()]
        .filter(([, group]) => options.repoId === undefined || group.some((t) => t.id === options.repoId))
        .filter(([, group]) => options.repoIds === undefined || group.some((t) => options.repoIds?.includes(t.id)))
        .filter(([github]) => options.force === true || !this.isFresh(github))
        // The watch (`repoIds`) waits a minute per repository however many tabs ask; the user's own refresh does not.
        .filter(([github]) => options.repoIds === undefined || !this.queriedWithin(github, WATCH_MIN_GAP_MS))
        .map(([github]) => github);

      if (wanted.length > 0) {
        // One `gh api user` per round, for the "review requested from you" marker; a failure only loses the marker.
        if (startsRound || this.viewerFetch) await this.ensureViewer();
        // Changed files only where a project acts on them: one with docs auto-merge on (agent-merges-docs-prs D2).
        const withFiles = (github: string) => (byGithub.get(github) ?? []).some((t) => t.autoMergeDocs === true);
        await this.runBounded(wanted.map((github) => () => this.queryOnce(github, withFiles(github))));
        await this.persist();
      }
    } finally {
      this.rounds--;
      // The last refresh out ends the round, so the next one queries afresh.
      if (this.rounds === 0) this.inFlight.clear();
    }
    return this.list(targets);
  }

  private isFresh(github: string): boolean {
    const entry = this.cache.get(github);
    if (!entry?.fetchedAt || entry.error) return false;
    const at = Date.parse(entry.fetchedAt);
    return !Number.isNaN(at) && this.now() - at < FRESHNESS_MS;
  }

  private queriedWithin(github: string, ms: number): boolean {
    const at = this.lastQueriedAt.get(github);
    return at !== undefined && this.now() - at < ms;
  }

  private async runBounded(jobs: (() => Promise<void>)[]): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length) await jobs[next++]();
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  }

  private async ensureViewer(): Promise<void> {
    if (this.viewerFetch) return this.viewerFetch;
    if (this.blocked) return;
    this.viewerFetch = (async () => {
      const run = await runGh(["api", "user", "--jq", ".login"], this.timeoutMs);
      const failure = failureOf(run);
      if (failure?.kind === "unavailable") this.blocked = failure;
      if (run.ok) {
        const login = run.out.trim();
        if (login) this.viewer = login;
      }
    })();
    try {
      await this.viewerFetch;
    } finally {
      this.viewerFetch = undefined;
    }
  }

  /**
   * One GitHub repository, at most once per round. The entry is kept until the round ends rather than dropped when the
   * query settles: a refresh that joins a round whose query has already finished must see that result instead of
   * querying the same repository again, which is what "a second refresh joins the running one" means.
   */
  private queryOnce(github: string, withFiles: boolean): Promise<void> {
    const running = this.inFlight.get(github);
    if (running) return running;
    const done = this.query(github, withFiles).finally(() => this.lastQueriedAt.set(github, this.now()));
    this.inFlight.set(github, done);
    return done;
  }

  private async query(github: string, withFiles: boolean): Promise<void> {
    const previous = this.cache.get(github) ?? { pullRequests: [] };
    if (this.blocked) {
      this.cache.set(github, { ...previous, error: this.blocked });
      return;
    }
    const since = new Date(this.now() - CLOSED_WITHIN_DAYS * 24 * 3600_000);
    const [open, closed] = await Promise.all([
      this.listPrs(github, ["--state", "open", "--limit", String(OPEN_LIMIT + 1)], withFiles ? `${FIELDS},${FILE_FIELDS}` : FIELDS),
      // A search, not `--state closed`: merged and closed pull requests then come from one call, filtered by date.
      this.listPrs(github, ["--state", "all", "--search", `is:closed closed:>=${since.toISOString().slice(0, 10)}`, "--limit", String(CLOSED_LIMIT + 1)], FIELDS),
    ]);
    const failure = open.failure ?? closed.failure;
    if (failure) {
      if (failure.kind === "unavailable") this.blocked = failure;
      // The previously fetched list stays, marked with its age; only the reason is new.
      this.cache.set(github, { ...previous, error: failure });
      return;
    }
    const cutoff = since.getTime();
    const openList = (open.items ?? []).filter((pr) => pr.state === "open").sort(newestFirst);
    const closedList = (closed.items ?? [])
      .filter((pr) => pr.state !== "open")
      .filter((pr) => (endedAt(pr) ?? 0) >= cutoff)
      .sort(newestFirst);
    this.cache.set(github, {
      fetchedAt: new Date(this.now()).toISOString(),
      pullRequests: [...openList, ...closedList],
      truncated: { open: open.truncated === true, closed: closed.truncated === true },
    });
  }

  private async listPrs(github: string, args: string[], fields: string): Promise<{ items?: PullRequest[]; truncated?: boolean; failure?: Failure }> {
    const limit = Number(args[args.indexOf("--limit") + 1]);
    const run = await runGh(["pr", "list", "--repo", github, ...args, "--json", fields], this.timeoutMs);
    const failure = failureOf(run);
    if (failure) return { failure };
    let raw: unknown;
    try {
      raw = JSON.parse(run.out || "[]");
    } catch {
      return { failure: { kind: "failed", reason: "gh returned output that is not JSON" } };
    }
    if (!Array.isArray(raw)) return { failure: { kind: "failed", reason: "gh returned output that is not a list" } };
    const truncated = raw.length >= limit;
    const items = raw
      .slice(0, limit - 1)
      .map((entry) => parsePullRequest(entry, this.viewer))
      .filter((pr): pr is PullRequest => pr !== undefined);
    return { items, truncated };
  }

  /** One write at a time, each from the cache as it is when the write starts, so the last one holds every list. */
  private persist(): Promise<void> {
    this.persisting = this.persisting.then(() => this.writeCache());
    return this.persisting;
  }

  /** Temp file plus rename, as the snapshot cache does: a half-written file is never read back. Never throws. */
  private async writeCache(): Promise<void> {
    const stored: StoredCache = { version: CACHE_VERSION, viewer: this.viewer, repos: {} };
    for (const [github, entry] of this.cache) {
      if (!entry.fetchedAt) continue;
      stored.repos[github] = { fetchedAt: entry.fetchedAt, pullRequests: entry.pullRequests, truncated: entry.truncated };
    }
    const path = pullRequestsCachePath();
    try {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(stored), "utf8");
      await rename(tmp, path);
    } catch {
      // The cache is a convenience: failing to write it loses nothing but the lists after a restart.
    }
  }
}
