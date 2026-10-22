// The Pull requests view's pure parts: filters ↔ URL, de-duplicating repositories that share a GitHub repository,
// grouping into open and recently closed, sorting, and the counts the overview and the board header show.
// Free of DOM access at import time, so it can be unit-tested.
import { linkedPullRequest } from "../shared/pullRequestLink.ts";
import { mergePending, pullRequestReadiness } from "../shared/pullRequestReadiness.ts";
import type { ChangeSnapshot, MergeAsked, PullRequest, PullRequestsResponse, RepoPullRequests, Session } from "../shared/types.ts";

export type PrStateFilter = "open" | "closed" | "all";

export interface PrFilters {
  /** A repository id; unset means every enabled repository. */
  repo?: string;
  /** `all` shows both groups, which is the default. */
  state: PrStateFilter;
  /** Only pull requests whose review is requested from the signed-in user. */
  mine: boolean;
}

export const DEFAULT_PR_FILTERS: PrFilters = { state: "all", mine: false };

export function parsePrFilters(search: string): PrFilters {
  const p = new URLSearchParams(search);
  const state = p.get("state");
  return {
    repo: p.get("repo") || undefined,
    state: state === "open" || state === "closed" ? state : "all",
    mine: p.get("mine") === "1",
  };
}

/** Defaults are omitted, so a plain `/pull-requests` stays a plain `/pull-requests`. */
export function serializePrFilters(filters: PrFilters): string {
  const p = new URLSearchParams();
  if (filters.repo) p.set("repo", filters.repo);
  if (filters.state !== "all") p.set("state", filters.state);
  if (filters.mine) p.set("mine", "1");
  const text = p.toString();
  return text ? `?${text}` : "";
}

/** The query that opens the view filtered to one repository, as the overview and the board header link to it. */
export function pullRequestsQuery(repoId: string): string {
  return serializePrFilters({ ...DEFAULT_PR_FILTERS, repo: repoId });
}

/** A repository as the view knows it: the name and order come from the snapshot, the list from the API. */
export interface PrRepo {
  id: string;
  name: string;
}

export interface PrEntry {
  pr: PullRequest;
  /** The repository this entry is listed under: the first, in the view's order, of those sharing the GitHub repository. */
  repoId: string;
  repoName: string;
  github?: string;
  /** Names of the other tracked repositories that are clones of the same GitHub repository. */
  alsoIn: string[];
}

export interface PrGroups {
  open: PrEntry[];
  closed: PrEntry[];
}

/** When a pull request last moved: merged or closed if it has, else opened. */
export function prTime(pr: PullRequest): number {
  const t = Date.parse(pr.mergedAt ?? pr.closedAt ?? pr.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

/** The moment an entry is shown with: its age in the list it appears in. */
export function prAgeAt(pr: PullRequest): string | undefined {
  return pr.state === "open" ? pr.createdAt : (pr.mergedAt ?? pr.closedAt ?? pr.createdAt);
}

const newestFirst = (a: PrEntry, b: PrEntry) => prTime(b.pr) - prTime(a.pr) || b.pr.number - a.pr.number;

/** The response's entries for the repositories the filter allows, in the order the repositories are given. */
function shown(response: PullRequestsResponse, repos: PrRepo[], filters: PrFilters): { repo: PrRepo; list: RepoPullRequests }[] {
  const byId = new Map(response.repos.map((r) => [r.repoId, r]));
  return repos
    .filter((repo) => filters.repo === undefined || repo.id === filters.repo)
    .flatMap((repo) => {
      const list = byId.get(repo.id);
      return list ? [{ repo, list }] : [];
    });
}

/**
 * One entry per pull request: two clones of one project would otherwise list everything twice, so a pull request is
 * kept under the first repository that has it and the other names go into `alsoIn`.
 */
export function pullRequestEntries(response: PullRequestsResponse, repos: PrRepo[], filters: PrFilters = DEFAULT_PR_FILTERS): PrGroups {
  const entries = new Map<string, PrEntry>();
  for (const { repo, list } of shown(response, repos, filters)) {
    for (const pr of list.pullRequests) {
      const key = `${list.github ?? repo.id}#${pr.number}`;
      const seen = entries.get(key);
      if (seen) {
        if (!seen.alsoIn.includes(repo.name)) seen.alsoIn.push(repo.name);
        continue;
      }
      entries.set(key, { pr, repoId: repo.id, repoName: repo.name, github: list.github, alsoIn: [] });
    }
  }
  const wanted = [...entries.values()].filter((e) => !filters.mine || (e.pr.reviewRequestedFromViewer && e.pr.state === "open"));
  return {
    open: filters.state === "closed" ? [] : wanted.filter((e) => e.pr.state === "open").sort(newestFirst),
    closed: filters.state === "open" ? [] : wanted.filter((e) => e.pr.state !== "open").sort(newestFirst),
  };
}

export interface PrNotice {
  repoId: string;
  repoName: string;
  status: RepoPullRequests["status"];
  /** `not-on-github`: cannot be queried at all, which is information, not a failure. `failed`: this query did not work. */
  kind: "not-on-github" | "failed";
  reason?: string;
  fetchedAt?: string;
  /** A list is still shown for this repository, from an earlier fetch. */
  hasList: boolean;
}

/**
 * Repositories with nothing to list and something to say. Those blocked by the machine's `gh` are left out: the view
 * explains that once, with `ghSetup`, rather than repeating it per repository.
 */
export function pullRequestNotices(response: PullRequestsResponse, repos: PrRepo[], filters: PrFilters = DEFAULT_PR_FILTERS): PrNotice[] {
  return shown(response, repos, filters)
    .filter(({ list }) => (list.status === "unavailable" || list.status === "failed") && !list.setup)
    .map(({ repo, list }) => ({
      repoId: repo.id,
      repoName: repo.name,
      status: list.status,
      // Decided from the status, never the reason text: per repository, only "not on GitHub" and "not a git repository"
      // are unavailable without a machine-wide `setup` problem.
      kind: list.status === "failed" ? ("failed" as const) : ("not-on-github" as const),
      reason: list.reason, fetchedAt: list.fetchedAt, hasList: list.pullRequests.length > 0,
    }));
}

export interface GhSetup {
  kind: "gh-missing" | "gh-signed-out";
  what: string;
  how: string;
}

/** The one explanation the view shows when the machine's `gh` is the problem, rather than any single repository. */
export function ghSetup(response: PullRequestsResponse): GhSetup | undefined {
  const kind = response.repos.find((r) => r.setup)?.setup;
  if (kind === "gh-missing") return { kind, what: "The GitHub CLI is not installed.", how: "Install gh (cli.github.com), then refresh." };
  if (kind === "gh-signed-out") return { kind, what: "The GitHub CLI is not signed in.", how: "Run gh auth login in a terminal, then refresh." };
  return undefined;
}

/** When the shown lists were last fetched: the newest of them, so the age in the header is not an old repository's. */
export function newestFetchedAt(response: PullRequestsResponse): string | undefined {
  let best: string | undefined;
  for (const repo of response.repos) {
    if (repo.fetchedAt && (!best || Date.parse(repo.fetchedAt) > Date.parse(best))) best = repo.fetchedAt;
  }
  return best;
}

/** Whether any shown list is old enough to be worth fetching again when a view opens. */
export function isStale(response: PullRequestsResponse | undefined, freshnessMs: number, now = Date.now()): boolean {
  if (!response) return true;
  const queryable = response.repos.filter((r) => r.github !== undefined);
  if (queryable.length === 0) return false;
  return queryable.some((r) => !r.fetchedAt || now - Date.parse(r.fetchedAt) >= freshnessMs);
}

export interface PrCount {
  /** Open pull requests of this repository; undefined when there is no list to count. */
  open?: number;
  /** Of those, the ones whose review is requested from the signed-in user. */
  awaitingMe: number;
  fetchedAt?: string;
  /** Why there is no count, for the placeholder's tooltip. */
  reason?: string;
}

/** What the overview's column and the board header's control read; never a reason to contact GitHub. */
export function openCount(response: PullRequestsResponse | undefined, repoId: string): PrCount {
  const list = response?.repos.find((r) => r.repoId === repoId);
  if (!list) return { awaitingMe: 0, reason: "pull requests have not been fetched yet" };
  if (list.status === "never") return { awaitingMe: 0, reason: "pull requests have not been fetched yet" };
  if (list.pullRequests.length === 0 && list.status !== "ok") return { awaitingMe: 0, reason: list.reason };
  const open = list.pullRequests.filter((pr) => pr.state === "open");
  return { open: open.length, awaitingMe: open.filter((pr) => pr.reviewRequestedFromViewer).length, fetchedAt: list.fetchedAt, reason: list.reason };
}

/** The server's own freshness window; the UI only uses it to decide whether opening a view is worth a refresh. */
export const FRESHNESS_MS = 5 * 60_000;

/** The lists a view shows: one repository's for a repository board or dialog, every list otherwise. */
export function shownLists(response: PullRequestsResponse | undefined, repoId?: string): PullRequestsResponse | undefined {
  return repoId && response ? { ...response, repos: response.repos.filter((r) => r.repoId === repoId) } : response;
}

/** How soon the board's watch asks again while a watched pull request is still being computed on GitHub. */
export const WATCH_IN_PROGRESS_MS = 60_000;
/** How soon it asks again while every watched pull request only waits (a draft, failing checks, a conflict). */
export const WATCH_WAITING_MS = 5 * 60_000;

export interface WatchPlan {
  /** The repositories of the cards whose linked pull request is open and not ready, in the cards' order. */
  repoIds: string[];
  /** When the next watch refresh is due; may lie in the past. */
  dueAt: number;
}

/** The Merge prompts sessions recorded, per `repoId/change`: what the board's watch keeps going for (agent-merges-docs-prs D5). */
export type PendingMerges = ReadonlyMap<string, readonly Pick<MergeAsked, "pr" | "head">[]>;

const mergeKey = (repoId: string, change: string) => `${repoId}/${change}`;

/** Built from the sessions the board already polls; whether one is still pending is decided against the pull request. */
export function pendingMergesOf(sessions: readonly Session[]): PendingMerges {
  const merges = new Map<string, Pick<MergeAsked, "pr" | "head">[]>();
  for (const session of sessions) {
    if (session.repoId === undefined || session.change === undefined || !("mergeAsked" in session) || !session.mergeAsked) continue;
    const key = mergeKey(session.repoId, session.change);
    merges.set(key, [...(merges.get(key) ?? []), session.mergeAsked]);
  }
  return merges;
}

/**
 * The board's pull-request watch (openspec/specs/pull-requests: "The board watches pull requests that are not ready"):
 * which repositories to refresh and when, or undefined when no card on the board links an open pull request that is
 * not ready. Pure: the board re-derives it from every answer, so "ready ends the watch" needs nothing more. A list that
 * is unavailable links nothing, so it is never watched. The schedule counts from the last refresh that settled in this
 * page, else from when the watched lists were last fetched, else from now.
 */
export function watchPlan(
  cards: readonly Pick<ChangeSnapshot, "repoId" | "name" | "branchMatch" | "created">[],
  lists: readonly RepoPullRequests[] | undefined,
  now: number,
  lastSettledAt: number | undefined,
  pendingMerges: PendingMerges = new Map(),
): WatchPlan | undefined {
  const repoIds: string[] = [];
  let inProgress = false;
  for (const card of cards) {
    const pr = linkedPullRequest(card, lists);
    // A Merge prompt sent for its current head counts as in progress, ready or not, until it merges, closes or moves.
    if ((pendingMerges.get(mergeKey(card.repoId, card.name)) ?? []).some((asked) => mergePending(pr, asked))) {
      if (!repoIds.includes(card.repoId)) repoIds.push(card.repoId);
      inProgress = true;
      continue;
    }
    const readiness = pullRequestReadiness(pr);
    if (readiness?.ready !== false) continue;
    if (!repoIds.includes(card.repoId)) repoIds.push(card.repoId);
    if (readiness.inProgress) inProgress = true;
  }
  if (repoIds.length === 0) return undefined;
  let fetched: number | undefined;
  for (const list of lists ?? []) {
    if (!repoIds.includes(list.repoId) || !list.fetchedAt) continue;
    const at = Date.parse(list.fetchedAt);
    if (!Number.isNaN(at) && (fetched === undefined || at > fetched)) fetched = at;
  }
  const from = lastSettledAt ?? fetched ?? now;
  return { repoIds, dueAt: from + (inProgress ? WATCH_IN_PROGRESS_MS : WATCH_WAITING_MS) };
}

/**
 * Arms one timer for a watch plan and returns what disarms it. Nothing is armed without a plan or while the tab is
 * hidden; the board calls this from an effect, so leaving the board, hiding the tab or a new answer disarms the old
 * timer before anything else can happen. Timers are passed in so the schedule is tested without waiting.
 */
export function armWatch(io: {
  plan: WatchPlan | undefined;
  hidden: boolean;
  now: number;
  watch(repoIds: string[]): void;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}): () => void {
  const { plan } = io;
  if (!plan || io.hidden) return () => {};
  const handle = io.setTimer(() => io.watch(plan.repoIds), Math.max(0, plan.dueAt - io.now));
  return () => io.clearTimer(handle);
}

type RefreshOptions = { repoId?: string; repoIds?: string[]; force?: boolean };

export interface PrRefresher {
  /** Asks the server now; joins the refresh in flight instead of starting a second one. */
  refresh(options?: { repoId?: string; force?: boolean }): Promise<void>;
  /**
   * The board's watch: a forced refresh of exactly these repositories. It joins nothing — while any refresh is in flight
   * it starts nothing and returns undefined — and synthetic lists (the demo) are never watched.
   */
  watch(repoIds: string[]): Promise<void> | undefined;
  /** When the last refresh of this page settled, answered or failed; undefined before the first. */
  lastSettledAt(): number | undefined;
  /**
   * What opening a view that shows pull requests does: refresh when a shown list is older than the freshness window or
   * was never fetched, else nothing. Returns the refresh it started or joined.
   */
  refreshIfStale(repoId?: string, now?: number): Promise<void> | undefined;
  /**
   * What opening a Kanban board does — the third view that shows pull requests (on its cards): the same as
   * `refreshIfStale`, except that synthetic lists (the demo) are never refreshed from a board.
   */
  openBoard(repoId?: string, now?: number): Promise<void> | undefined;
}

/**
 * The one place the UI starts a pull-request refresh: at most one runs at a time, and a view opening while one runs
 * joins it. Free of Preact, so the rule is tested directly; the provider only wires it to state.
 */
export function createPrRefresher(io: {
  /** The lists the UI holds right now. */
  current(): PullRequestsResponse | undefined;
  fetch(options: RefreshOptions): Promise<PullRequestsResponse>;
  onStart(running: string | "all"): void;
  onAnswer(answer: PullRequestsResponse): void;
  onError(message: string): void;
  onSettled(): void;
  freshnessMs?: number;
  /** The lists are made up (the demo): a board's opening then asks for nothing, and a board never watches them. */
  synthetic?: boolean;
  now?: () => number;
}): PrRefresher {
  let inFlight: Promise<void> | undefined;
  let settledAt: number | undefined;
  const clock = io.now ?? Date.now;
  const refresh = (options: RefreshOptions = {}): Promise<void> => {
    if (inFlight) return inFlight;
    io.onStart(options.repoId ?? (options.repoIds?.length === 1 ? options.repoIds[0] : "all"));
    const done = io
      .fetch(options)
      .then(io.onAnswer)
      .catch((err) => io.onError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        inFlight = undefined;
        settledAt = clock();
        io.onSettled();
      });
    inFlight = done;
    return done;
  };
  const refreshIfStale = (repoId?: string, now = Date.now()): Promise<void> | undefined => {
    if (inFlight) return inFlight;
    if (!isStale(shownLists(io.current(), repoId), io.freshnessMs ?? FRESHNESS_MS, now)) return undefined;
    return refresh(repoId ? { repoId } : {});
  };
  return {
    refresh,
    refreshIfStale,
    openBoard: (repoId, now) => (io.synthetic ? undefined : refreshIfStale(repoId, now)),
    watch: (repoIds) => (io.synthetic || inFlight || repoIds.length === 0 ? undefined : refresh({ repoIds, force: true })),
    lastSettledAt: () => settledAt,
  };
}
