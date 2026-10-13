import { expect, test } from "bun:test";
import { h } from "preact";
import type { ChangeSession, ChangeSnapshot, ProjectConsoleSession, PullRequest, PullRequestsResponse, RepoSnapshot, SessionState, SessionWorktree, WorkStatus } from "../src/shared/types.ts";
import { FilterBar } from "../src/ui/boardFilters.tsx";
import { activeTags, activityOptions, EMPTY_FILTERS, hasActiveFilters, parseFilters, resolveLayout, serializeFilters } from "../src/ui/filters.ts";
import { boardCards, boardStats, visibleCards } from "../src/ui/kanban.tsx";
import { archivePending } from "../src/ui/sessionState.ts";
import { byTag, textOf } from "./vnode.ts";

test("the Activity selector offers the presets and keeps a threshold from the URL", () => {
  expect(activityOptions(0).map((o) => o.label)).toEqual(["Any time", "Last 7 days", "Last 14 days", "Last 30 days", "Last 90 days"]);
  expect(activityOptions(10).map((o) => o.value)).toEqual([0, 7, 10, 14, 30, 90]);
  expect(activityOptions(10).find((o) => o.value === 10)?.label).toBe("Last 10 days");
  expect(activityOptions(14).map((o) => o.value)).toEqual([0, 7, 14, 30, 90]);
});

test("the threshold lives in the URL as active=, and the former stale parameter is ignored", () => {
  expect(parseFilters("?active=10").activeDays).toBe(10);
  expect(serializeFilters({ ...EMPTY_FILTERS, activeDays: 10 })).toBe("?active=10");
  expect(parseFilters(serializeFilters({ ...EMPTY_FILTERS, activeDays: 30 }))).toEqual({ ...EMPTY_FILTERS, activeDays: 30 });
  expect(hasActiveFilters(parseFilters("?active=7"))).toBe(true);
  const old = parseFilters(`?${new URLSearchParams({ stale: "10" })}`);
  expect(old.activeDays).toBe(0);
  expect(activeTags(old, [])).toEqual([]);
  expect(hasActiveFilters(old)).toBe(false);
});

test("the filter bar captions the selector Activity and selects the threshold from the URL", () => {
  const tree = h(FilterBar, { filters: parseFilters("?active=7"), setFilters: () => {}, repos: [], hues: new Map(), single: true, showing: 0, layout: "lanes" });
  const control = byTag(tree, "label").find((el) => String(el.props.class ?? "").includes("select-control"));
  expect(control).toBeDefined();
  expect(textOf(byTag(control?.props.children, "span"))).toBe("Activity");
  const select = byTag(control?.props.children, "select")[0];
  expect(select.props.value).toBe(7);
  const selected = byTag(select.props.children, "option").find((o) => o.props.value === select.props.value);
  expect(textOf(selected?.props.children)).toBe("Last 7 days");
  expect(textOf(tree)).toContain("Last 7 days");
});

test("tags follow the board's repository order, and removing one clears only that filter", () => {
  const repos = [
    { id: "a1", name: "alpha-infra" },
    { id: "b2", name: "beta-soc" },
    { id: "c3", name: "gamma-web" },
  ];
  const filters = parseFilters("?repos=b2,a1&active=10&q=sync");
  const tags = activeTags(filters, repos);
  expect(tags.map((t) => t.label)).toEqual(["alpha-infra", "beta-soc", "Last 10 days"]);
  expect(tags[1]).toMatchObject({ repoId: "b2", clear: { repos: ["a1"] } });
  expect(tags[2].clear).toEqual({ activeDays: 0 });
  expect(serializeFilters({ ...filters, ...tags[1].clear })).toBe("?repos=a1&q=sync&active=10");
  expect(serializeFilters({ ...filters, ...tags[2].clear })).toBe("?repos=b2%2Ca1&q=sync");
});

test("a repository no longer tracked produces no tag", () => {
  expect(activeTags(parseFilters("?repos=zz"), [{ id: "a1", name: "alpha-infra" }])).toEqual([]);
});

test("clear filters shows only while something is filtered", () => {
  expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  expect(hasActiveFilters(parseFilters("?archived=0"))).toBe(true);
  expect(hasActiveFilters(parseFilters("?q=x"))).toBe(true);
});

test("Hide merged is on by default and only merged=1 in the URL turns it off", () => {
  expect(EMPTY_FILTERS.hideMerged).toBe(true);
  expect(parseFilters("").hideMerged).toBe(true);
  expect(parseFilters("?merged=0").hideMerged).toBe(true);
  expect(parseFilters("?merged=1").hideMerged).toBe(false);
  expect(serializeFilters(EMPTY_FILTERS)).toBe("");
  expect(serializeFilters({ ...EMPTY_FILTERS, hideMerged: false })).toBe("?merged=1");
  expect(parseFilters(serializeFilters({ ...EMPTY_FILTERS, hideMerged: false, hideArchived: true }))).toEqual({ ...EMPTY_FILTERS, hideMerged: false, hideArchived: true });
  // Only a departure from the default is a filter to clear.
  expect(hasActiveFilters(parseFilters(""))).toBe(false);
  expect(hasActiveFilters(parseFilters("?merged=1"))).toBe(true);
});

test("the board layout follows the window unless chosen, and lives in the URL", () => {
  expect(resolveLayout("auto", true)).toBe("stack");
  expect(resolveLayout("auto", false)).toBe("lanes");
  expect(resolveLayout("lanes", true)).toBe("lanes");
  expect(resolveLayout("stack", false)).toBe("stack");
  expect(parseFilters("?layout=stack").layout).toBe("stack");
  expect(parseFilters("?layout=galaxy").layout).toBe("auto");
  expect(serializeFilters({ ...EMPTY_FILTERS, layout: "lanes" })).toBe("?layout=lanes");
  expect(serializeFilters(EMPTY_FILTERS)).toBe("");
  // A layout is not a filter: it does not light up "Clear filters".
  expect(hasActiveFilters(parseFilters("?layout=stack"))).toBe(false);
});

// ---- a card's pull-request link is display only ----

const prCard = (name: string, column: string, stage: ChangeSnapshot["stage"], branchMatch?: string): ChangeSnapshot => ({
  repoId: "a1",
  name,
  schema: "spec-driven",
  artifacts: [],
  tasks: { done: 2, total: 4 },
  lastActivityAt: "2026-03-01T12:00:00Z",
  branchMatch,
  stage,
  column,
});
const prRepo: RepoSnapshot = {
  id: "a1",
  name: "alpha-infra",
  path: "/w/acme/alpha-infra",
  ok: true,
  scannedAt: "2026-03-10T12:00:00Z",
  isGit: true,
  worktrees: [],
  changes: [prCard("add-sync", "Implementing", "implementing", "feat/add-sync"), prCard("ship-it", "Done", "done", "feat/ship-it"), prCard("idle-one", "Backlog", "backlog")],
};
const prList = (head: string, number: number, state: PullRequest["state"] = "open"): PullRequest => ({
  number,
  title: head,
  url: `https://github.com/acme/alpha-infra/pull/${number}`,
  author: "octo",
  head,
  base: "main",
  draft: false,
  state,
  createdAt: "2026-03-09T12:00:00Z",
  mergedAt: state === "merged" ? "2026-03-09T13:00:00Z" : undefined,
  review: "none",
  reviewRequestedFromViewer: false,
  checks: "none",
});
const withPrs: PullRequestsResponse = {
  repos: [{ repoId: "a1", github: "acme/alpha-infra", status: "ok", fetchedAt: "2026-03-10T12:00:00Z", pullRequests: [prList("feat/add-sync", 7), prList("feat/ship-it", 8, "merged")] }],
};

test("a pull-request link is not a filter: clearing filters shows the same cards with or without pull requests", () => {
  const NOW_PR = Date.parse("2026-03-10T12:00:00Z");
  const hues = new Map([["a1", 0]]);
  const without = boardCards([prRepo], hues);
  const linked = boardCards([prRepo], hues, withPrs);
  expect(linked.map((c) => c.pullRequest?.number)).toEqual([7, 8, undefined]);
  const filtered = parseFilters("?q=sync&active=3");
  for (const filters of [filtered, EMPTY_FILTERS]) {
    expect(visibleCards(linked, filters, false, NOW_PR).map((c) => c.name)).toEqual(visibleCards(without, filters, false, NOW_PR).map((c) => c.name));
  }
  expect(visibleCards(linked, EMPTY_FILTERS, false, NOW_PR).map((c) => c.name)).toEqual(["add-sync", "ship-it", "idle-one"]);
  // No filter knows about pull requests at all.
  expect(Object.keys(EMPTY_FILTERS).some((k) => /pr|pull/i.test(k))).toBe(false);
});

test("a pull-request link changes no column, no column count and no to-archive count", () => {
  const NOW_PR = Date.parse("2026-03-10T12:00:00Z");
  const hues = new Map([["a1", 0]]);
  const without = boardCards([prRepo], hues);
  const linked = boardCards([prRepo], hues, withPrs);
  expect(linked.map((c) => c.column)).toEqual(without.map((c) => c.column));
  const perColumn = (cards: { column: string }[]) => cards.reduce<Record<string, number>>((n, c) => ({ ...n, [c.column]: (n[c.column] ?? 0) + 1 }), {});
  expect(perColumn(linked)).toEqual(perColumn(without));
  expect(boardStats(linked, visibleCards(linked, EMPTY_FILTERS, false, NOW_PR))).toEqual(boardStats(without, visibleCards(without, EMPTY_FILTERS, false, NOW_PR)));
  expect(boardStats(linked, linked)).toEqual({ open: 3, toArchive: 1 });
});

test("Hide merged ignores the pull-request link: an archive is pending or not by its worktree alone", () => {
  const hues = new Map([["a1", 0]]);
  const archived = (name: string): ChangeSnapshot => ({ ...prCard(name, "Archived", "archived"), archived: "2026-03-09", checkout: { path: "/w/acme/alpha-infra", branch: "main", isMain: true } });
  const repo: RepoSnapshot = { ...prRepo, changes: [archived("landed"), archived("waiting")] };
  const worktree = (change: string, state: WorkStatus["state"]): SessionWorktree => ({
    repoId: "a1",
    name: `archive-${change}`,
    path: `/w/home/worktrees/a1/archive-${change}`,
    change,
    action: "archive",
    branch: `chore/archive-${change}`,
    work: { state },
  });
  const worktrees = [worktree("landed", "merged"), worktree("waiting", "pushed")];
  // The opposite of what each worktree says: an open pull request on the landed archive, a merged one on the waiting one.
  const prs: PullRequestsResponse = {
    repos: [{ repoId: "a1", github: "acme/alpha-infra", status: "ok", fetchedAt: "2026-03-10T12:00:00Z", pullRequests: [prList("chore/archive-landed", 21), prList("chore/archive-waiting", 22, "merged")] }],
  };
  const without = boardCards([repo], hues);
  const linked = boardCards([repo], hues, prs);
  expect(linked.map((c) => c.pullRequest?.number)).toEqual([21, 22]);
  const pending = (cards: ChangeSnapshot[]) => cards.map((c) => archivePending(c, worktrees));
  expect(pending(linked)).toEqual([false, true]);
  expect(pending(linked)).toEqual(pending(without));
});

// ---- the recent-activity threshold hides what is known to be old ----

const NOW_ACT = Date.parse("2026-03-30T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW_ACT - days * 24 * 60 * 60_000).toISOString();
const actCard = (name: string, lastActivityAt: string | undefined, archived = false): ChangeSnapshot => ({
  ...prCard(name, archived ? "Archived" : "Implementing", archived ? "archived" : "implementing"),
  lastActivityAt,
  ...(archived ? { archived: "2026-03-01" } : {}),
});
const actCards = (changes: ChangeSnapshot[]) => boardCards([{ ...prRepo, changes }], new Map([["a1", 0]]));
const actSession = (change: string, state: SessionState): ChangeSession => ({
  id: `a1-${change}-${state}`,
  agentId: "fake",
  agentName: "Fake",
  state,
  worktreePath: `/h/worktrees/a1/${change}`,
  branch: `feat/${change}`,
  createdAt: "2026-03-30T10:00:00.000Z",
  updatedAt: "2026-03-30T10:00:00.000Z",
  resumable: false,
  repoId: "a1",
  change,
  action: "implement",
});
const lastSeven = parseFilters("?active=7");
const names = (cards: { name: string }[]) => cards.map((c) => c.name);

test("Last 7 days keeps recent changes and hides old ones, archived ones included", () => {
  const cards = actCards([
    actCard("add-sync", daysAgo(2)),
    actCard("old-idea", daysAgo(20)),
    actCard("just-archived", daysAgo(3), true),
    actCard("long-archived", daysAgo(40), true),
    actCard("almost-eight", daysAgo(7.8)),
  ]);
  expect(names(visibleCards(cards, lastSeven, false, NOW_ACT))).toEqual(["add-sync", "just-archived"]);
  expect(names(visibleCards(cards, EMPTY_FILTERS, false, NOW_ACT))).toHaveLength(5);
});

test("a change with no readable activity time is kept", () => {
  const cards = actCards([actCard("no-time", undefined), actCard("bad-time", "not a date")]);
  expect(names(visibleCards(cards, lastSeven, false, NOW_ACT))).toEqual(["no-time", "bad-time"]);
});

test("a running session keeps an old change, an ended one does not, and a change-less session keeps nothing", () => {
  const cards = actCards([actCard("old-idea", daysAgo(20))]);
  expect(names(visibleCards(cards, lastSeven, false, NOW_ACT, [actSession("old-idea", "running")]))).toEqual(["old-idea"]);
  expect(names(visibleCards(cards, lastSeven, false, NOW_ACT, [actSession("old-idea", "exited"), actSession("old-idea", "failed")]))).toEqual([]);
  const projectConsole: ProjectConsoleSession = {
    id: "a1-console",
    agentId: "fake",
    agentName: "Fake",
    state: "running",
    worktreePath: "/w/acme/alpha-infra",
    createdAt: "2026-03-30T10:00:00.000Z",
    updatedAt: "2026-03-30T10:00:00.000Z",
    resumable: false,
    projectConsole: true,
    repoId: "a1",
    folder: "/w/acme/alpha-infra",
    inPlace: true,
  };
  // The board's list holds change sessions only; even were a change-less one passed, it names no change to keep.
  expect(names(visibleCards(cards, lastSeven, false, NOW_ACT, [projectConsole as unknown as ChangeSession]))).toEqual([]);
});
