import { afterEach, expect, test } from "bun:test";
import { needsAttention, pageEvents } from "../src/shared/activity.ts";
import type { ActivityEvent } from "../src/shared/types.ts";
import { ACTIVITY_METRICS_KEY, ACTIVITY_METRICS_VIEW_KEY, axisTicks, barShare, busiestHour, chartGroups, heatStep, hourLabel, loadMetricsView, saveMetricsView, collapseDay, DAY_SHOWN, dayKey, dayLabel, loadMetricsHidden, REPOS_SHOWN, saveMetricsHidden, visibleRepos, describe, groupByDay, isBusyDay, kindsFor, latestOnly, parseActivityFilters, serializeActivityFilters, timeOfDay, tone, unseenLabel, visibleFigures } from "../src/ui/activityState.ts";

let n = 0;
const base = (at: Date) => ({ v: 1 as const, id: `id${String(n++).padStart(4, "0")}`, at: at.toISOString(), detectedAt: at.toISOString(), repoId: "r1", repoName: "demo-ops" });
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

test("filters round-trip through the URL; unknown groups are dropped; order is stable", () => {
  expect(parseActivityFilters("")).toEqual({ repos: [], groups: [] });
  expect(parseActivityFilters("?repos=a,b&show=sessions,nonsense,changes")).toEqual({ repos: ["a", "b"], groups: ["sessions", "changes"] });
  expect(serializeActivityFilters({ repos: ["a", "b"], groups: ["sessions", "changes"] })).toBe("?repos=a,b&show=changes,sessions");
  expect(serializeActivityFilters({ repos: [], groups: [] })).toBe("");
  expect(parseActivityFilters(serializeActivityFilters({ repos: ["x"], groups: ["tasks"] }))).toEqual({ repos: ["x"], groups: ["tasks"] });
});

test("groups map to the kinds the API filters by", () => {
  expect(kindsFor([])).toEqual([]);
  expect(kindsFor(["tasks"])).toEqual(["tasks-progress"]);
  expect(kindsFor(["sessions", "repositories"])).toEqual([
    "session-started",
    "session-ended",
    "session-shipped",
    "session-conflicts-resolve",
    "session-auto-ended",
    "session-merge",
    "repo-tracked",
    "repo-untracked",
    "repo-failing",
    "repo-recovered",
  ]);
});

test("events are grouped under local days: Today, Yesterday, then dates", () => {
  const now = local(2026, 9, 21, 15);
  const events: ActivityEvent[] = [
    { ...base(local(2026, 9, 21, 9, 5)), kind: "change-moved", change: "a", from: "Specs", to: "Ready" },
    { ...base(local(2026, 9, 21, 0, 1)), kind: "repo-recovered" },
    { ...base(local(2026, 9, 20, 23, 59)), kind: "change-archived", change: "b", from: "Done" },
    { ...base(local(2026, 9, 12, 8)), kind: "repo-untracked" },
  ];
  const days = groupByDay(events, now);
  expect(days.map((d) => [d.label === "Today" || d.label === "Yesterday" ? d.label : "date", d.events.length])).toEqual([["Today", 2], ["Yesterday", 1], ["date", 1]]);
  expect(days[2].label).toContain("2026");
  expect(timeOfDay(events[0].at)).toBe("09:05");
  expect(groupByDay([], now)).toEqual([]);
});

test("every kind has wording, and what needs a look stands out", () => {
  const at = local(2026, 9, 21);
  const cases: [ActivityEvent, string, string][] = [
    [{ ...base(at), kind: "change-created", change: "a", to: "Proposal" }, "created in Proposal", "normal"],
    [{ ...base(at), kind: "change-moved", change: "a", from: "Ready", to: "Implementing", tasks: { done: 2, total: 7 } }, "moved Ready → Implementing · 2/7", "normal"],
    [{ ...base(at), kind: "tasks-progress", change: "a", column: "Implementing", from: { done: 3, total: 12 }, to: { done: 7, total: 12 } }, "tasks 3/12 → 7/12", "quiet"],
    [{ ...base(at), kind: "change-archived", change: "a", from: "Synced" }, "archived from Synced", "ok"],
    [{ ...base(at), kind: "change-archived", change: "a" }, "archived", "ok"],
    [{ ...base(at), kind: "change-removed", change: "a", from: "Proposal" }, "removed (was in Proposal)", "normal"],
    [{ ...base(at), kind: "repo-tracked", openChanges: 1 }, "now tracked · 1 open change", "quiet"],
    [{ ...base(at), kind: "repo-tracked", openChanges: 12 }, "now tracked · 12 open changes", "quiet"],
    [{ ...base(at), kind: "repo-untracked" }, "no longer tracked", "quiet"],
    [{ ...base(at), kind: "repo-failing", error: "timed out" }, "scan failing: timed out", "danger"],
    [{ ...base(at), kind: "repo-recovered" }, "scan recovered", "ok"],
    [{ ...base(at), kind: "session-started", change: "a", action: "implement", agentName: "Fake Agent" }, "session started: implement with Fake Agent", "normal"],
    [{ ...base(at), kind: "session-started", change: "a", action: "implement", agentName: "Fake Agent", resumed: true }, "session resumed: implement with Fake Agent", "normal"],
    [{ ...base(at), kind: "session-ended", change: "a", exitCode: 0 }, "session ended", "normal"],
    [{ ...base(at), kind: "session-ended", change: "a", exitCode: 1 }, "session ended (exit 1)", "danger"],
    [{ ...base(at), kind: "session-ended", change: "a", error: "could not start the agent" }, "session failed: could not start the agent", "danger"],
    [{ ...base(at), kind: "session-shipped", change: "a" }, "ship requested", "normal"],
    [{ ...base(at), kind: "session-shipped", change: "a", submitted: false }, "ship requested — typed, not sent", "normal"],
    // What was handed over, never what came of it: the outcome is re-read from git.
    [{ ...base(at), kind: "session-conflicts-resolve", change: "a" }, "conflict resolution requested", "normal"],
    [{ ...base(at), kind: "session-conflicts-resolve", change: "a", submitted: false }, "conflict resolution requested — typed, not sent", "normal"],
    // Likewise a Merge: who sent it and whether it was submitted, never whether it merged.
    [{ ...base(at), kind: "session-merge", change: "a", pr: 88, by: "dashboard", submitted: true }, "merge of #88 requested by Spec Control, as it is ready and docs-only", "normal"],
    [{ ...base(at), kind: "session-merge", change: "a", pr: 41, by: "user", submitted: true }, "merge of #41 requested", "normal"],
    [{ ...base(at), kind: "session-merge", change: "a", pr: 41, by: "user", submitted: false }, "merge of #41 requested — typed, not sent", "normal"],
  ];
  for (const [event, words, weight] of cases) {
    expect(describe(event)).toBe(words);
    expect(tone(event)).toBe(weight as ReturnType<typeof tone>);
    // The summary's "need attention" counts exactly what the feed shows in red.
    expect(needsAttention(event)).toBe(weight === "danger");
  }
});

test("the unseen number: nothing for none, capped at 99+", () => {
  expect(unseenLabel(undefined)).toBe("");
  expect(unseenLabel(0)).toBe("");
  expect(unseenLabel(5)).toBe("5");
  expect(unseenLabel(99)).toBe("99");
  expect(unseenLabel(100)).toBe("99+");
});

test("what is newer than the last seen event is what the server counts", () => {
  const at = local(2026, 9, 21);
  const events: ActivityEvent[] = Array.from({ length: 8 }, () => ({ ...base(at), kind: "repo-recovered" as const }));
  expect(pageEvents(events, { limit: 1, since: events[2].id }).newerThanSince).toBe(5);
  expect(pageEvents(events, { limit: 1, since: events[7].id }).newerThanSince).toBe(0);
});

test("summary figures follow the kind filter", () => {
  const keys = (groups: Parameters<typeof visibleFigures>[0]) => visibleFigures(groups).map((f) => f.key);
  expect(keys([])).toEqual(["created", "moved", "archived", "tasksCompleted", "sessions", "attention"]);
  expect(keys(["sessions"])).toEqual(["sessions", "attention"]);
  expect(keys(["tasks"])).toEqual(["tasksCompleted"]);
  expect(keys(["repositories"])).toEqual(["attention"]);
  expect(keys(["changes", "tasks"])).toEqual(["created", "moved", "archived", "tasksCompleted"]);
});

test("a busy day shows its newest entries until expanded; a quiet day is never collapsed", () => {
  const day = (n: number) => ({
    key: "2026-09-21",
    label: "Today",
    events: Array.from({ length: n }, (_, i) => ({ v: 1, id: `e${String(n - i).padStart(4, "0")}`, at: "2026-09-21T09:00:00.000Z", detectedAt: "2026-09-21T09:00:00.000Z", repoId: "r1", repoName: "demo-ops", kind: "repo-recovered" }) as ActivityEvent),
  });
  const busy = day(140);
  const collapsed = collapseDay(busy, false);
  expect(collapsed.shown).toEqual(busy.events.slice(0, DAY_SHOWN));
  expect(collapsed.hidden).toBe(120);
  expect(collapseDay(busy, true)).toEqual({ shown: busy.events, hidden: 0 });
  expect(collapseDay(day(31), false).hidden).toBe(11);
  expect(collapseDay(day(30), false)).toEqual({ shown: day(30).events, hidden: 0 });
  expect(isBusyDay(day(30))).toBe(false);
  expect(isBusyDay(day(31))).toBe(true);
});

// ---- metrics (add-metrics-to-activity) ----

const repoCount = (i: number) => ({ repoId: `r${i}`, repoName: `repo-${i}`, events: 20 - i, changes: 1, groups: { changes: 20 - i, tasks: 0, sessions: 0, repositories: 0 } });

test("many projects: the 6 busiest, then Show N more; expanded lists all", () => {
  const nine = Array.from({ length: 9 }, (_, i) => repoCount(i));
  expect(visibleRepos(nine, false).shown.map((r) => r.repoId)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
  expect(visibleRepos(nine, false).hidden).toBe(3);
  expect(visibleRepos(nine, true)).toEqual({ shown: nine, hidden: 0 });
  const six = nine.slice(0, REPOS_SHOWN);
  expect(visibleRepos(six, false)).toEqual({ shown: six, hidden: 0 });
});

test("bars are shares of the largest, and nothing draws nothing", () => {
  expect(barShare(10, 40)).toBe(0.25);
  expect(barShare(40, 40)).toBe(1);
  expect(barShare(0, 0)).toBe(0);
  expect(barShare(3, 0)).toBe(0);
});

test("day labels name the local day: Today, else the weekday", () => {
  const today = dayKey(new Date(2026, 9, 7));
  expect(dayLabel(today, today)).toBe("Today");
  expect(dayLabel("2026-10-06", today)).toBe(new Date(2026, 9, 6).toLocaleDateString(undefined, { weekday: "short" }));
});

function stubStorage(options: { throws?: boolean } = {}): Map<string, string> {
  const store = new Map<string, string>();
  const fail = () => {
    throw new Error("storage unavailable");
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: options.throws
      ? { getItem: fail, setItem: fail, removeItem: fail }
      : { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) },
  });
  return store;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("hiding the metrics is remembered; storage that refuses shows them", () => {
  const store = stubStorage();
  expect(loadMetricsHidden()).toBe(false);
  saveMetricsHidden(true);
  expect(store.get(ACTIVITY_METRICS_KEY)).toBe("hidden");
  expect(loadMetricsHidden()).toBe(true);
  saveMetricsHidden(false);
  expect(loadMetricsHidden()).toBe(false);
  stubStorage({ throws: true });
  expect(loadMetricsHidden()).toBe(false);
  expect(() => saveMetricsHidden(true)).not.toThrow();
});

// ---- charts (refactor-metrics-activity) ----

test("the value axis rounds up to a clean step, at most three intervals", () => {
  expect(axisTicks(0)).toEqual({ top: 1, ticks: [0, 1] });
  expect(axisTicks(1)).toEqual({ top: 1, ticks: [0, 1] });
  expect(axisTicks(3)).toEqual({ top: 3, ticks: [0, 1, 2, 3] });
  expect(axisTicks(7)).toEqual({ top: 10, ticks: [0, 5, 10] });
  expect(axisTicks(40)).toEqual({ top: 40, ticks: [0, 20, 40] });
  expect(axisTicks(12)).toEqual({ top: 15, ticks: [0, 5, 10, 15] });
  expect(axisTicks(350)).toEqual({ top: 400, ticks: [0, 200, 400] });
  for (const max of [1, 2, 5, 9, 11, 99, 101, 1234]) {
    const { top, ticks } = axisTicks(max);
    expect(top).toBeGreaterThanOrEqual(max);
    expect(ticks.length - 1).toBeLessThanOrEqual(3);
    expect(ticks.at(-1)).toBe(top);
  }
});

test("heat steps: none unshaded, then quarters of the busiest hour", () => {
  expect(heatStep(0, 6)).toBe(0);
  expect(heatStep(1, 6)).toBe(1);
  expect(heatStep(3, 6)).toBe(2);
  expect(heatStep(4, 6)).toBe(3);
  expect(heatStep(6, 6)).toBe(4);
  expect(heatStep(1, 0)).toBe(0);
});

test("busiest hour across the days, earliest on a tie, none for an empty week", () => {
  const hours = (pairs: [number, number][]) => {
    const h = new Array(24).fill(0);
    for (const [i, n] of pairs) h[i] = n;
    return { hours: h };
  };
  expect(busiestHour([hours([[9, 1], [14, 6]]), hours([[9, 2]])])).toBe(14);
  expect(busiestHour([hours([[9, 3]]), hours([[14, 3]])])).toBe(9);
  expect(busiestHour([hours([])])).toBeUndefined();
  expect(hourLabel(9)).toBe("09:00");
});

test("charts draw the groups the filter lets through, always in the same order", () => {
  expect(chartGroups([])).toEqual(["changes", "tasks", "sessions", "repositories"]);
  expect(chartGroups(["sessions", "changes"])).toEqual(["changes", "sessions"]);
});

test("the chart or table choice is remembered; storage that refuses shows the charts", () => {
  const store = stubStorage();
  expect(loadMetricsView()).toBe("chart");
  saveMetricsView("table");
  expect(store.get(ACTIVITY_METRICS_VIEW_KEY)).toBe("table");
  expect(loadMetricsView()).toBe("table");
  saveMetricsView("chart");
  expect(loadMetricsView()).toBe("chart");
  stubStorage({ throws: true });
  expect(loadMetricsView()).toBe("chart");
  expect(() => saveMetricsView("table")).not.toThrow();
});

/** The feed's request handling as `activity.tsx` wires it, with answers the test resolves in any order. */
function feedModel() {
  const requests = latestOnly();
  const shown: { events: string[]; newestId?: string; wanted: number; seen: (string | undefined)[]; error?: string } = { events: [], wanted: 50, seen: [] };
  const deferred = () => {
    let settle!: (page: { events: string[]; newestId?: string } | Error) => void;
    const answer = new Promise<{ events: string[]; newestId?: string } | Error>((r) => {
      settle = r;
    });
    return { answer, settle };
  };
  return {
    shown,
    setFilters: () => {
      shown.wanted = 50;
      requests.supersede();
    },
    load: () => {
      const mine = requests.begin();
      const { answer, settle } = deferred();
      const done = answer.then((page) => {
        if (!requests.current(mine)) return;
        if (page instanceof Error) shown.error = page.message;
        else {
          shown.events = page.events;
          shown.newestId = page.newestId;
          shown.seen.push(page.newestId);
        }
      });
      return { settle, done };
    },
    loadOlder: () => {
      const mine = requests.latest();
      const { answer, settle } = deferred();
      const done = answer.then((page) => {
        if (!requests.current(mine) || page instanceof Error) return;
        shown.wanted += page.events.length;
        shown.events = [...shown.events, ...page.events];
      });
      return { settle, done };
    },
  };
}

test("feed: a slow answer for the old filter changes nothing, its error included", async () => {
  const feed = feedModel();
  const all = feed.load();
  feed.setFilters(); // the user selects demo-ops
  const demoOps = feed.load();
  demoOps.settle({ events: ["demo-ops:2", "demo-ops:1"], newestId: "demo-ops:2" });
  await demoOps.done;
  all.settle({ events: ["alpha-infra:9", "demo-ops:2"], newestId: "alpha-infra:9" });
  await all.done;
  expect(feed.shown.events).toEqual(["demo-ops:2", "demo-ops:1"]);

  const failing = feedModel();
  const late = failing.load();
  const fresh = failing.load();
  fresh.settle({ events: ["a"], newestId: "a" });
  late.settle(new Error("timeout"));
  await Promise.all([late.done, fresh.done]);
  expect([failing.shown.events, failing.shown.error]).toEqual([["a"], undefined]);
});

test("feed: Load older across a filter change is not appended and asks for nothing more later", async () => {
  const feed = feedModel();
  const first = feed.load();
  first.settle({ events: ["e3", "e2"], newestId: "e3" });
  await first.done;
  const older = feed.loadOlder();
  feed.setFilters(); // the user switches the group to Sessions
  const sessions = feed.load();
  sessions.settle({ events: ["s1"], newestId: "s1" });
  await sessions.done;
  older.settle({ events: ["e1", "e0"] });
  await older.done;
  expect([feed.shown.events, feed.shown.wanted]).toEqual([["s1"], 50]);

  // without a change in between it is appended, and a reload keeps asking for it
  const more = feed.loadOlder();
  more.settle({ events: ["s0"] });
  await more.done;
  expect([feed.shown.events, feed.shown.wanted]).toEqual([["s1", "s0"], 51]);
});

test("feed: only the shown answer's newest entry is reported as seen", async () => {
  const feed = feedModel();
  const slow = feed.load();
  const fresh = feed.load();
  fresh.settle({ events: ["e5"], newestId: "e5" });
  await fresh.done;
  slow.settle({ events: ["e7", "e5"], newestId: "e7" }); // names a newer entry, but was superseded
  await slow.done;
  expect(feed.shown.seen).toEqual(["e5"]);
});
