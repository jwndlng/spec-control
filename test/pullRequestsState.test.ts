import { expect, test } from "bun:test";
import type { ChangeSession, PullRequest, PullRequestsResponse } from "../src/shared/types.ts";
import {
  armWatch,
  createPrRefresher,
  DEFAULT_PR_FILTERS,
  ghSetup,
  isStale,
  newestFetchedAt,
  openCount,
  parsePrFilters,
  pendingMergesOf,
  pullRequestEntries,
  pullRequestNotices,
  pullRequestsQuery,
  serializePrFilters,
  WATCH_IN_PROGRESS_MS,
  WATCH_WAITING_MS,
  watchPlan,
} from "../src/ui/pullRequestsState.ts";

const DAY = 24 * 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const pr = (patch: Partial<PullRequest> & { number: number }): PullRequest => ({
  title: `change ${patch.number}`,
  url: `https://github.com/acme/alpha-infra/pull/${patch.number}`,
  author: "octo",
  head: `feat/change-${patch.number}`,
  base: "main",
  draft: false,
  state: "open",
  createdAt: ago(DAY),
  review: "none",
  reviewRequestedFromViewer: false,
  checks: "none",
  ...patch,
});

const REPOS = [
  { id: "alpha", name: "alpha-infra" },
  { id: "alpha-clone", name: "alpha-infra-2" },
  { id: "beta", name: "beta-soc" },
  { id: "notes", name: "plain-notes" },
];

const response = (): PullRequestsResponse => ({
  viewer: "demo-user",
  repos: [
    {
      repoId: "alpha",
      github: "acme/alpha-infra",
      status: "ok",
      fetchedAt: ago(3 * 60_000),
      pullRequests: [pr({ number: 1, createdAt: ago(2 * DAY), draft: true }), pr({ number: 2, createdAt: ago(2 * 3600_000), review: "approved", checks: "passing" })],
    },
    // A second clone of the same GitHub repository: the API repeats the list, the view must not.
    { repoId: "alpha-clone", github: "acme/alpha-infra", status: "ok", fetchedAt: ago(3 * 60_000), pullRequests: [pr({ number: 1, createdAt: ago(2 * DAY), draft: true }), pr({ number: 2, createdAt: ago(2 * 3600_000) })] },
    {
      repoId: "beta",
      github: "acme/beta-soc",
      status: "ok",
      fetchedAt: ago(60_000),
      pullRequests: [pr({ number: 42, url: "https://github.com/acme/beta-soc/pull/42", reviewRequestedFromViewer: true }), pr({ number: 40, state: "merged", mergedAt: ago(4 * 3600_000) })],
    },
    { repoId: "notes", status: "unavailable", reason: "not a git repository", pullRequests: [] },
  ],
});

test("filters round-trip through the query string, with the defaults omitted", () => {
  expect(parsePrFilters("")).toEqual(DEFAULT_PR_FILTERS);
  expect(serializePrFilters(DEFAULT_PR_FILTERS)).toBe("");
  const filters = { repo: "beta", state: "open" as const, mine: true };
  expect(serializePrFilters(filters)).toBe("?repo=beta&state=open&mine=1");
  expect(parsePrFilters(serializePrFilters(filters))).toEqual(filters);
  // An unknown state falls back to showing both groups.
  expect(parsePrFilters("?state=nonsense").state).toBe("all");
  expect(pullRequestsQuery("beta")).toBe("?repo=beta");
});

test("open pull requests come first, newest first, and recently closed ones follow", () => {
  const groups = pullRequestEntries(response(), REPOS);
  expect(groups.open.map((e) => e.pr.number)).toEqual([2, 42, 1]);
  expect(groups.closed.map((e) => e.pr.number)).toEqual([40]);
  expect(groups.open.map((e) => e.repoName)).toEqual(["alpha-infra", "beta-soc", "alpha-infra"]);
});

test("a pull request of two clones is listed once, under the first repository, with the other named", () => {
  const groups = pullRequestEntries(response(), REPOS);
  expect(groups.open.filter((e) => e.pr.number === 1)).toHaveLength(1);
  expect(groups.open.find((e) => e.pr.number === 1)?.alsoIn).toEqual(["alpha-infra-2"]);
  expect(groups.open.find((e) => e.pr.number === 42)?.alsoIn).toEqual([]);
});

test("the repository filter shows only that repository, even for a shared GitHub repository", () => {
  const onlyBeta = pullRequestEntries(response(), REPOS, { ...DEFAULT_PR_FILTERS, repo: "beta" });
  expect(onlyBeta.open.map((e) => e.pr.number)).toEqual([42]);
  expect(onlyBeta.closed.map((e) => e.pr.number)).toEqual([40]);
  // The second clone on its own still shows the shared project's pull requests.
  const onlyClone = pullRequestEntries(response(), REPOS, { ...DEFAULT_PR_FILTERS, repo: "alpha-clone" });
  expect(onlyClone.open.map((e) => e.pr.number)).toEqual([2, 1]);
  expect(onlyClone.open[0].repoName).toBe("alpha-infra-2");
});

test("the state and review filters combine with the repository filter", () => {
  expect(pullRequestEntries(response(), REPOS, { ...DEFAULT_PR_FILTERS, state: "open" }).closed).toEqual([]);
  expect(pullRequestEntries(response(), REPOS, { ...DEFAULT_PR_FILTERS, state: "closed" }).open).toEqual([]);
  const mine = pullRequestEntries(response(), REPOS, { ...DEFAULT_PR_FILTERS, mine: true });
  expect(mine.open.map((e) => e.pr.number)).toEqual([42]);
  expect(mine.closed).toEqual([]);
  expect(pullRequestEntries(response(), REPOS, { repo: "alpha", state: "all", mine: true }).open).toEqual([]);
});

test("unavailable and failed repositories become notices, not entries", () => {
  const answer = response();
  answer.repos[0] = { ...answer.repos[0], status: "failed", reason: "gh timed out" };
  const notices = pullRequestNotices(answer, REPOS);
  expect(notices).toEqual([
    { repoId: "alpha", repoName: "alpha-infra", status: "failed", kind: "failed", reason: "gh timed out", fetchedAt: answer.repos[0].fetchedAt, hasList: true },
    { repoId: "notes", repoName: "plain-notes", status: "unavailable", kind: "not-on-github", reason: "not a git repository", hasList: false },
  ]);
  // A failed repository keeps showing its last good list.
  expect(pullRequestEntries(answer, REPOS).open.map((e) => e.pr.number)).toEqual([2, 42, 1]);
});

test("a machine-wide gh problem is explained once, and lists no repository as failing", () => {
  const answer = response();
  answer.repos = answer.repos.map((r) => (r.github ? { ...r, status: "unavailable" as const, reason: "GitHub CLI not installed", setup: "gh-missing" as const, pullRequests: [] } : r));
  expect(ghSetup(answer)?.kind).toBe("gh-missing");
  expect(ghSetup(answer)?.how).toContain("cli.github.com");
  expect(pullRequestNotices(answer, REPOS).map((n) => n.repoId)).toEqual(["notes"]);

  const out = response();
  out.repos = out.repos.map((r) => (r.github ? { ...r, status: "unavailable" as const, reason: "not signed in", setup: "gh-signed-out" as const } : r));
  expect(ghSetup(out)?.how).toContain("gh auth login");
  expect(ghSetup(response())).toBeUndefined();
});

test("the fetch age is the newest of the shown lists, and staleness ignores repositories that cannot be queried", () => {
  // One response: each call stamps its ages from the clock, so two calls can differ by a millisecond.
  const answer = response();
  expect(newestFetchedAt(answer)).toBe(answer.repos[2].fetchedAt);
  expect(isStale(answer, 5 * 60_000)).toBe(false);
  expect(isStale(answer, 60_000)).toBe(true);
  expect(isStale(undefined, 5 * 60_000)).toBe(true);
  // Only repositories that are not on GitHub: nothing could be fetched, so nothing is stale.
  expect(isStale({ repos: [{ repoId: "notes", status: "unavailable", pullRequests: [] }] }, 5 * 60_000)).toBe(false);
  expect(isStale({ repos: [{ repoId: "alpha", github: "acme/alpha-infra", status: "never", pullRequests: [] }] }, 5 * 60_000)).toBe(true);
});

test("the overview's count is the open pull requests, with those awaiting the user's review", () => {
  const answer = response();
  expect(openCount(answer, "beta")).toEqual({ open: 1, awaitingMe: 1, fetchedAt: answer.repos[2].fetchedAt, reason: undefined });
  expect(openCount(answer, "alpha").open).toBe(2);
  expect(openCount(answer, "notes")).toEqual({ awaitingMe: 0, reason: "not a git repository" });
  expect(openCount(answer, "unknown").reason).toContain("not been fetched");
  expect(openCount(undefined, "alpha").open).toBeUndefined();
  // A failed repository with an earlier list still shows that list's count.
  answer.repos[0] = { ...answer.repos[0], status: "failed", reason: "gh timed out" };
  expect(openCount(answer, "alpha")).toMatchObject({ open: 2, reason: "gh timed out" });
});

// ---- the board's watch ----

const T = Date.parse("2026-10-05T12:00:00Z");
const MIN = 60_000;
const at = (ms: number) => new Date(T - ms).toISOString();

const card = (repoId: string, name: string) => ({ repoId, name, branchMatch: `feat/${name}` });
const watched = (repoId: string, prs: PullRequest[], patch: Partial<PullRequestsResponse["repos"][number]> = {}) => ({
  repoId,
  github: `acme/${repoId}`,
  status: "ok" as const,
  fetchedAt: at(2 * MIN),
  pullRequests: prs,
  ...patch,
});
const open = (head: string, patch: Partial<PullRequest> = {}) => pr({ number: head.length, head, checks: "passing", mergeable: "mergeable", ...patch });

test("nothing to watch: no card links an open pull request that is not ready", () => {
  const cards = [card("alpha", "a"), card("beta", "b")];
  expect(watchPlan(cards, undefined, T, undefined)).toBeUndefined();
  expect(watchPlan(cards, [watched("alpha", [open("feat/a")])], T, undefined)).toBeUndefined();
  expect(watchPlan(cards, [watched("alpha", [open("feat/a", { state: "merged", mergedAt: at(MIN) })])], T, undefined)).toBeUndefined();
  // A pull request no card links is not the board's business.
  expect(watchPlan(cards, [watched("alpha", [open("feat/other", { checks: "pending" })])], T, undefined)).toBeUndefined();
});

test("a pull request in progress is watched a minute after the last settled refresh, and only its repository", () => {
  const cards = [card("alpha", "a"), card("beta", "b")];
  const lists = [watched("alpha", [open("feat/a", { checks: "pending" })]), watched("beta", [open("feat/b")])];
  expect(watchPlan(cards, lists, T, T - 10_000)).toEqual({ repoIds: ["alpha"], dueAt: T - 10_000 + WATCH_IN_PROGRESS_MS });
  expect(WATCH_IN_PROGRESS_MS).toBe(MIN);
  // Unknown mergeability is in progress too.
  expect(watchPlan(cards, [watched("alpha", [open("feat/a", { mergeable: "unknown" })])], T, T)?.dueAt).toBe(T + MIN);
});

test("only waiting pull requests are watched every five minutes", () => {
  const cards = [card("alpha", "a"), card("beta", "b")];
  const lists = [watched("alpha", [open("feat/a", { mergeable: "conflicting" })]), watched("beta", [open("feat/b", { draft: true })])];
  expect(watchPlan(cards, lists, T, T)).toEqual({ repoIds: ["alpha", "beta"], dueAt: T + WATCH_WAITING_MS });
  expect(WATCH_WAITING_MS).toBe(5 * MIN);
  // One in progress among them makes it every minute again.
  lists.push(watched("gamma", [open("feat/c", { checks: "pending" })]));
  expect(watchPlan([...cards, card("gamma", "c")], lists, T, T)?.dueAt).toBe(T + MIN);
});

test("without a refresh in this page the schedule counts from the watched lists' fetch, else from now", () => {
  const cards = [card("alpha", "a")];
  expect(watchPlan(cards, [watched("alpha", [open("feat/a", { checks: "pending" })], { fetchedAt: at(30 * MIN) })], T, undefined)?.dueAt).toBe(T - 29 * MIN);
  expect(watchPlan(cards, [watched("alpha", [open("feat/a", { checks: "pending" })], { fetchedAt: undefined })], T, undefined)?.dueAt).toBe(T + MIN);
});

test("an unavailable repository is never watched", () => {
  const lists = [watched("alpha", [open("feat/a", { checks: "pending" })], { status: "unavailable", setup: "gh-signed-out" })];
  expect(watchPlan([card("alpha", "a")], lists, T, T)).toBeUndefined();
});

test("a repository board watches only its own cards", () => {
  const lists = [watched("alpha", [open("feat/a", { checks: "pending" })]), watched("beta", [])];
  expect(watchPlan([card("beta", "b")], lists, T, T)).toBeUndefined();
});

/** A fake clock: timers run only when the test advances it. */
function fakeTimers() {
  let now = T;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimer: (run: () => void, ms: number) => {
      timers.set(++next, { at: now + ms, run });
      return next;
    },
    clearTimer: (handle: unknown) => void timers.delete(handle as number),
    pending: () => timers.size,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.run();
        }
      }
    },
  };
}

test("an armed watch fires once when due, and disarming it — leaving the board, hiding the tab — stops it", () => {
  const clock = fakeTimers();
  const fired: string[][] = [];
  const plan = { repoIds: ["alpha"], dueAt: T + MIN };
  const disarm = armWatch({ plan, hidden: false, now: clock.now(), watch: (ids) => fired.push(ids), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  clock.advance(59_000);
  expect(fired).toEqual([]);
  clock.advance(1_000);
  expect(fired).toEqual([["alpha"]]);

  const again = armWatch({ plan: { ...plan, dueAt: clock.now() + MIN }, hidden: false, now: clock.now(), watch: (ids) => fired.push(ids), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  again();
  clock.advance(10 * MIN);
  expect(fired).toHaveLength(1);
  expect(clock.pending()).toBe(0);
  disarm();

  // A hidden tab arms nothing; once visible, an overdue plan fires at once.
  armWatch({ plan, hidden: true, now: clock.now(), watch: (ids) => fired.push(ids), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  expect(clock.pending()).toBe(0);
  armWatch({ plan, hidden: false, now: clock.now(), watch: (ids) => fired.push(ids), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  clock.advance(0);
  expect(fired).toHaveLength(2);
  // No plan, nothing armed.
  armWatch({ plan: undefined, hidden: false, now: clock.now(), watch: (ids) => fired.push(ids), setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  expect(clock.pending()).toBe(0);
});

function refresherHarness(synthetic = false) {
  let clock = T;
  const asked: unknown[] = [];
  const pending: (() => void)[] = [];
  const refresher = createPrRefresher({
    current: () => undefined,
    fetch: (options) => {
      asked.push(options);
      return new Promise((resolve) => pending.push(() => resolve({ repos: [] })));
    },
    onStart: () => {},
    onAnswer: () => {},
    onError: () => {},
    onSettled: () => {},
    synthetic,
    now: () => clock,
  });
  const answer = async (atTime: number) => {
    clock = atTime;
    for (const done of pending.splice(0)) done();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { refresher, asked, answer };
}

test("watch forces a refresh of exactly the watched repositories and records when it settled", async () => {
  const { refresher, asked, answer } = refresherHarness();
  expect(refresher.lastSettledAt()).toBeUndefined();
  expect(refresher.watch(["alpha", "gamma"])).toBeDefined();
  expect(asked).toEqual([{ repoIds: ["alpha", "gamma"], force: true }]);
  await answer(T + 5_000);
  expect(refresher.lastSettledAt()).toBe(T + 5_000);
  expect(refresher.watch([])).toBeUndefined();
  expect(asked).toHaveLength(1);
});

test("one refresh at a time: a due watch neither joins nor starts a refresh while one runs", async () => {
  const { refresher, asked, answer } = refresherHarness();
  const users = refresher.refresh({ force: true });
  expect(refresher.watch(["alpha"])).toBeUndefined();
  expect(asked).toEqual([{ force: true }]);
  await answer(T);
  await users;
  expect(refresher.watch(["alpha"])).toBeDefined();
  expect(asked).toHaveLength(2);
  await answer(T);
});

test("demo: synthetic lists are never watched", () => {
  const { refresher, asked } = refresherHarness(true);
  expect(refresher.watch(["alpha"])).toBeUndefined();
  expect(asked).toEqual([]);
});

// ---- a pending merge (agent-merges-docs-prs 5.1) ----

const HEAD = "c0ffee0000000000000000000000000000000088";
const asked = (repoId: string, change: string, patch: Partial<ChangeSession> = {}): ChangeSession => ({
  id: `${repoId}-${change}`, repoId, change, action: "archive", agentId: "fake", agentName: "Fake Agent", state: "running", worktreePath: "/w/acme/x", branch: `feat/${change}`, createdAt: at(MIN), updatedAt: at(MIN), resumable: false,
  mergeAsked: { pr: 88, head: HEAD, at: at(MIN), submitted: true, by: "dashboard" },
  ...patch,
});

test("a pending merge keeps the one-minute cadence while the pull request is ready", () => {
  const cards = [card("demo", "rotate-keys"), card("beta", "b")];
  const ready = open("feat/rotate-keys", { number: 88, headOid: HEAD, docsOnly: true });
  const lists = [watched("demo", [ready]), watched("beta", [open("feat/b")])];
  // Ready and nothing asked: not watched.
  expect(watchPlan(cards, lists, T, T)).toBeUndefined();
  const pending = pendingMergesOf([asked("demo", "rotate-keys"), asked("beta", "b", { mergeAsked: undefined })]);
  expect(watchPlan(cards, lists, T, T, pending)).toEqual({ repoIds: ["demo"], dueAt: T + WATCH_IN_PROGRESS_MS });
  // A merge pending next to a waiting pull request still sets the faster cadence.
  const waiting = [watched("demo", [ready]), watched("beta", [open("feat/b", { mergeable: "conflicting" })])];
  expect(watchPlan(cards, waiting, T, T, pending)).toEqual({ repoIds: ["demo", "beta"], dueAt: T + WATCH_IN_PROGRESS_MS });
});

test("a new head, a merge or a close ends the pending merge", () => {
  const cards = [card("demo", "rotate-keys")];
  const pending = pendingMergesOf([asked("demo", "rotate-keys")]);
  const listed = (patch: Partial<PullRequest>) => [watched("demo", [open("feat/rotate-keys", { number: 88, headOid: HEAD, ...patch })])];
  expect(watchPlan(cards, listed({ headOid: "c0ffee0000000000000000000000000000000089" }), T, T, pending)).toBeUndefined();
  expect(watchPlan(cards, listed({ state: "merged", mergedAt: at(MIN) }), T, T, pending)).toBeUndefined();
  expect(watchPlan(cards, listed({ state: "closed", closedAt: at(MIN) }), T, T, pending)).toBeUndefined();
  // A new head whose checks run again is watched for that, as any not-ready pull request.
  expect(watchPlan(cards, listed({ headOid: "c0ffee0000000000000000000000000000000089", checks: "pending" }), T, T, pending)?.repoIds).toEqual(["demo"]);
  // Another change's record says nothing about this card.
  expect(watchPlan(cards, listed({}), T, T, pendingMergesOf([asked("demo", "other")]))).toBeUndefined();
  expect(pendingMergesOf([{ ...asked("demo", "rotate-keys"), mergeAsked: undefined }]).size).toBe(0);
});
