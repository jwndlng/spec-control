import { afterAll, beforeAll, expect, test } from "bun:test";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newEventId } from "../src/server/activity/events.ts";
import { ActivityLog, AGE_COMPACT_EVERY_MS, COMPACT_ABOVE_LINES, KEEP_ENTRIES } from "../src/server/activity/log.ts";
import { collapseTaskProgress, measure, pageEvents, RETENTION_MS, retained, summarize } from "../src/shared/activity.ts";
import type { ActivityEvent } from "../src/shared/types.ts";
import { tempDir } from "./helpers.ts";

let dir: string;
beforeAll(async () => {
  dir = await tempDir("osd-activity-");
});
afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(dir, { recursive: true, force: true });
});

const T0 = Date.parse("2026-09-21T09:00:00.000Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** The fixed timestamps below are only "recent" against a clock pinned next to them. */
const clock = () => T0 + DAY;
let tick = 0;
const base = (atMs: number, repoId = "r1") => ({ v: 1 as const, id: newEventId(T0 + tick++), at: new Date(atMs).toISOString(), detectedAt: new Date(atMs).toISOString(), repoId, repoName: repoId === "r1" ? "demo-ops" : "beta-soc" });
const moved = (atMs: number, change: string, from: string, to: string, repoId?: string): ActivityEvent => ({ ...base(atMs, repoId), kind: "change-moved", change, from, to });
const progress = (atMs: number, change: string, from: number, to: number, total = 12): ActivityEvent => ({ ...base(atMs), kind: "tasks-progress", change, column: "Implementing", from: { done: from, total }, to: { done: to, total } });
const started = (atMs: number, change: string): ActivityEvent => ({ ...base(atMs), kind: "session-started", change, action: "implement", agentName: "Fake Agent" });
const NO_FIGURES = { created: 0, moved: 0, archived: 0, tasksCompleted: 0, sessions: 0, attention: 0 };
const NO_GROUPS = { changes: 0, tasks: 0, sessions: 0, repositories: 0 };
/** Metrics of nothing: the days of the window are still listed, each at zero. */
const QUIET = expect.objectContaining({ events: 0, changes: 0, repos: [] });
const file = (name: string) => join(dir, name, "activity.jsonl");

test("events survive a restart, newest first", async () => {
  const path = file("restart");
  const log = new ActivityLog(path, clock);
  await log.load();
  expect(log.page()).toEqual({ events: [], summary: NO_FIGURES, metrics: QUIET });
  await log.append([moved(T0, "a", "Specs", "Ready"), moved(T0 + MIN, "b", "Ready", "Implementing")]);
  const again = new ActivityLog(path, clock);
  await again.load();
  const page = again.page();
  expect(page.events.map((e) => "change" in e && e.change)).toEqual(["b", "a"]);
  expect(page.newestId).toBe(page.events[0].id);
  expect(page.nextBefore).toBeUndefined();
});

test("a torn last line, foreign lines and unknown versions are skipped; writing goes on", async () => {
  const path = file("torn");
  await mkdir(join(dir, "torn"), { recursive: true });
  const good = moved(T0, "a", "Specs", "Ready");
  await writeFile(path, `${JSON.stringify(good)}\nnot json\n${JSON.stringify({ ...good, v: 2, id: "zzz" })}\n${JSON.stringify({ ...good, kind: "made-up" })}\n{"v":1,"id":"trunc`);
  const log = new ActivityLog(path, clock);
  await log.load();
  expect(log.page().events.map((e) => e.id)).toEqual([good.id]);
  await log.append([moved(T0 + MIN, "b", "Ready", "Done")]);
  const again = new ActivityLog(path, clock);
  await again.load();
  expect(again.page().events).toHaveLength(2);
});

test("the log is bounded: compacted to the newest entries beyond the limit, and on start", async () => {
  const path = file("bounded");
  const log = new ActivityLog(path, clock);
  await log.load();
  const batch = (n: number, offset: number) => Array.from({ length: n }, (_, i) => moved(T0 + (offset + i) * 1000, `c${offset + i}`, "Specs", "Ready"));
  await log.append(batch(COMPACT_ABOVE_LINES, 0));
  expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(COMPACT_ABOVE_LINES);
  await log.append(batch(1, COMPACT_ABOVE_LINES));
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(KEEP_ENTRIES);
  expect(JSON.parse(lines[lines.length - 1]).change).toBe(`c${COMPACT_ABOVE_LINES}`);
  expect(JSON.parse(lines[0]).change).toBe(`c${COMPACT_ABOVE_LINES + 1 - KEEP_ENTRIES}`);

  // a file that outgrew the limit while another version ran is compacted when loaded
  await appendFile(path, batch(KEEP_ENTRIES, 9000).map((e) => `${JSON.stringify(e)}\n`).join(""));
  const again = new ActivityLog(path, clock);
  await again.load();
  await again.append([]);
  expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(KEEP_ENTRIES);
});

test("a compaction between two recordings writes each event once, also after a restart", async () => {
  const path = file("compact-race");
  const log = new ActivityLog(path, clock);
  await log.load();
  const batch = (n: number, offset: number) => Array.from({ length: n }, (_, i) => moved(T0 + (offset + i) * 1000, `c${offset + i}`, "Specs", "Ready"));
  await log.append(batch(COMPACT_ABOVE_LINES, 0));
  const [first, second] = batch(2, COMPACT_ABOVE_LINES);
  // Not waiting in between: the first one's write compacts while the second is already recorded in memory.
  const writes = [log.append([first]), log.append([second])];
  // Shown at once, before either write has finished.
  expect(log.page({ limit: 2 }).events.map((e) => e.id)).toEqual([second.id, first.id]);
  await Promise.all(writes);
  const ids = (await readFile(path, "utf8")).trim().split("\n").map((l) => JSON.parse(l).id as string);
  // The compaction kept the newest entries up to the first event; the second was appended after it, once.
  expect(ids).toHaveLength(KEEP_ENTRIES + 1);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.slice(-2)).toEqual([first.id, second.id]);

  const restarted = new ActivityLog(path, clock);
  await restarted.load();
  const shown = restarted.page({ limit: 10 }).events.map((e) => e.id);
  expect(shown.filter((id) => id === first.id || id === second.id)).toEqual([second.id, first.id]);
});

test("paging has no duplicates and no gaps; filters apply; newestId ignores them", async () => {
  const log = new ActivityLog(file("paging"), clock);
  await log.load();
  const events = Array.from({ length: 250 }, (_, i) => (i % 5 === 0 ? started(T0 + i * MIN, `s${i}`) : moved(T0 + i * MIN, `c${i}`, "Specs", "Ready", i % 2 ? "r1" : "r2")));
  await log.append(events);
  const first = log.page({ limit: 100 });
  const second = log.page({ limit: 100, before: first.nextBefore });
  const third = log.page({ limit: 100, before: second.nextBefore });
  expect([first.events.length, second.events.length, third.events.length]).toEqual([100, 100, 50]);
  expect(third.nextBefore).toBeUndefined();
  const ids = [...first.events, ...second.events, ...third.events].map((e) => e.id);
  expect(new Set(ids).size).toBe(250);
  expect(ids[0]).toBe(events[249].id);

  const sessions = log.page({ kinds: ["session-started"], repos: ["r1"] });
  expect(sessions.events).toHaveLength(50);
  expect(sessions.events.every((e) => e.kind === "session-started" && e.repoId === "r1")).toBe(true);
  expect(sessions.newestId).toBe(events[249].id);
  expect(log.page({ repos: ["nope"] })).toEqual({ events: [], newestId: events[249].id, summary: NO_FIGURES, metrics: QUIET });
  expect(log.page({ limit: 1, since: events[244].id }).newerThanSince).toBe(5);
  expect(log.page({ limit: 1, since: "" }).newerThanSince).toBe(250);
});

test("events are shown by when they happened, not by when they were noticed", async () => {
  const log = new ActivityLog(file("order"), clock);
  await log.load();
  const noticedLater = { ...moved(T0 - 60 * MIN, "weekend-work", "Done", "Archived"), catchUp: true };
  await log.append([moved(T0, "today", "Specs", "Ready")]);
  await log.append([noticedLater]);
  expect(log.page().events.map((e) => "change" in e && e.change)).toEqual(["today", "weekend-work"]);
  expect(log.page().newestId).toBe(noticedLater.id);
});

test("task progress collapses into runs; a move or a long gap ends a run; the log keeps every event", async () => {
  const chronological = [
    progress(T0, "a", 3, 4),
    progress(T0 + 10 * MIN, "a", 4, 6),
    progress(T0 + 15 * MIN, "b", 0, 1), // another change in between does not end a's run
    progress(T0 + 40 * MIN, "a", 6, 7),
    moved(T0 + 50 * MIN, "a", "Implementing", "Done"),
    progress(T0 + 55 * MIN, "a", 7, 8),
    progress(T0 + 200 * MIN, "a", 8, 9), // more than an hour later
  ];
  const newestFirst = [...chronological].reverse();
  const collapsed = collapseTaskProgress(newestFirst);
  expect(collapsed.map((e) => (e.kind === "tasks-progress" ? `${e.change} ${e.from.done}→${e.to.done}` : `${e.kind}`))).toEqual(["a 8→9", "a 7→8", "change-moved", "a 3→7", "b 0→1"]);
  expect(collapsed[3]).toMatchObject({ id: chronological[3].id, at: chronological[3].at });
  expect(newestFirst).toHaveLength(7); // input untouched

  const log = new ActivityLog(file("collapse"), clock);
  await log.load();
  await log.append(chronological);
  expect(log.page().events).toHaveLength(5);
  expect((await readFile(file("collapse"), "utf8")).trim().split("\n")).toHaveLength(7);
});

test("a log that cannot be written never throws and keeps serving from memory", async () => {
  await writeFile(join(dir, "not-a-dir"), "x");
  const log = new ActivityLog(join(dir, "not-a-dir", "activity.jsonl"), clock);
  await log.load();
  await log.append([moved(T0, "a", "Specs", "Ready")]);
  expect(log.page().events).toHaveLength(1);
});

const lineCount = async (path: string) => (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).length;
const changesIn = async (path: string) => (await readFile(path, "utf8")).trim().split("\n").map((l) => JSON.parse(l).change);

test("retention keeps what happened within the last 7 days, in order", () => {
  const now = T0 + 30 * DAY;
  const edge = moved(now - RETENTION_MS, "edge", "Specs", "Ready");
  const justOut = moved(now - RETENTION_MS - 1, "just-out", "Specs", "Ready");
  const recent = moved(now - MIN, "recent", "Specs", "Ready");
  const future = moved(now + DAY, "future", "Specs", "Ready"); // a skewed clock: kept rather than lost
  const garbled = { ...moved(now, "garbled", "Specs", "Ready"), at: "not a time" };
  const kept = retained([justOut, edge, garbled, recent, future], now);
  expect(kept.map((e) => "change" in e && e.change)).toEqual(["edge", "recent", "future"]);
});

test("the feed only shows, points at and counts the last 7 days, and reading never writes", async () => {
  const path = file("window");
  let now = T0;
  const log = new ActivityLog(path, () => now);
  await log.load();
  const old = [moved(T0, "o1", "Specs", "Ready"), moved(T0 + MIN, "o2", "Specs", "Ready")];
  await log.append(old);
  now = T0 + 2 * DAY;
  const recent = [0, 1, 2].map((i) => moved(now - i * MIN, `r${i}`, "Ready", "Implementing"));
  await log.append(recent);

  now = T0 + 8 * DAY; // the first two are 8 days old now, without anything being recorded since
  const page = log.page({ limit: 3, since: "" });
  expect(page.events.map((e) => "change" in e && e.change)).toEqual(["r0", "r1", "r2"]);
  expect(page.nextBefore).toBeUndefined();
  expect(page.newerThanSince).toBe(3);
  expect(page.summary?.moved).toBe(3);
  expect(page.metrics?.events).toBe(3);
  expect(page.newestId).toBe(recent[2].id);
  expect(await lineCount(path)).toBe(5);

  now = T0 + 10 * DAY;
  expect(log.page()).toEqual({ events: [], summary: NO_FIGURES, metrics: QUIET });
});

test("on start, aged-out events are dropped and the file is rewritten without them", async () => {
  const path = file("start");
  await mkdir(join(dir, "start"), { recursive: true });
  const now = T0 + 30 * DAY;
  const lines = [moved(now - 10 * DAY, "ten", "Specs", "Ready"), moved(now - 6 * DAY, "six", "Specs", "Ready"), moved(now - 60 * MIN, "hour", "Specs", "Ready")];
  await writeFile(path, lines.map((e) => `${JSON.stringify(e)}\n`).join(""));
  const log = new ActivityLog(path, () => now);
  await log.load();
  expect(log.page().events.map((e) => "change" in e && e.change)).toEqual(["hour", "six"]);
  expect(await changesIn(path)).toEqual(["six", "hour"]);
});

test("on start, lines it cannot read are no reason to rewrite a recent log", async () => {
  const path = file("foreign");
  await mkdir(join(dir, "foreign"), { recursive: true });
  const good = moved(T0, "a", "Specs", "Ready");
  const text = `${JSON.stringify(good)}\n${JSON.stringify({ ...good, v: 2, id: "zzz" })}\n`;
  await writeFile(path, text);
  const log = new ActivityLog(path, clock);
  await log.load();
  await log.append([]);
  expect(await readFile(path, "utf8")).toBe(text);
});

test("an event that happened before the window is not recorded", async () => {
  const path = file("catch-up");
  const now = T0 + 30 * DAY;
  const log = new ActivityLog(path, () => now);
  await log.load();
  const longAgo = { ...moved(now - 9 * DAY, "add-login", "Done", "Archived"), catchUp: true };
  const lately = { ...moved(now - 2 * DAY, "cache-api-calls", "Specs", "Ready"), catchUp: true };
  await log.append([longAgo, lately]);
  expect(log.page().events.map((e) => "change" in e && e.change)).toEqual(["cache-api-calls"]);
  expect(await changesIn(path)).toEqual(["cache-api-calls"]);
});

test("while running, aged-out entries leave the file at most once an hour, when events are recorded", async () => {
  const path = file("aging");
  await mkdir(join(dir, "aging"), { recursive: true });
  let now = T0 + 30 * DAY;
  // An expired line makes the start compact, so the hourly clock starts now.
  await writeFile(path, `${JSON.stringify(moved(now - 10 * DAY, "ancient", "Specs", "Ready"))}\n`);
  const log = new ActivityLog(path, () => now);
  await log.load();
  await log.append([moved(now - RETENTION_MS + 10 * MIN, "aging", "Specs", "Ready")]);
  expect(await changesIn(path)).toEqual(["aging"]);

  now += 20 * MIN; // "aging" has passed the 7-day mark
  await log.append([moved(now, "b", "Specs", "Ready")]);
  expect(log.page().events.map((e) => "change" in e && e.change)).toEqual(["b"]);
  expect(await changesIn(path)).toEqual(["aging", "b"]); // not rewritten within the hour

  now += AGE_COMPACT_EVERY_MS;
  await log.append([moved(now, "c", "Specs", "Ready")]);
  expect(await changesIn(path)).toEqual(["b", "c"]);
});

// ---- summary (activity-summary) ----

const created = (atMs: number, change: string): ActivityEvent => ({ ...base(atMs), kind: "change-created", change, to: "Drafts" });
const archived = (atMs: number, change: string): ActivityEvent => ({ ...base(atMs), kind: "change-archived", change, from: "Done" });
const ended = (atMs: number, change: string, exitCode: number): ActivityEvent => ({ ...base(atMs), kind: "session-ended", change, exitCode });
const failing = (atMs: number): ActivityEvent => ({ ...base(atMs), kind: "repo-failing", error: "boom" });

test("a week in figures: events, not entries; a fall in finished tasks subtracts nothing", () => {
  const h = (n: number) => T0 + n * 60 * MIN;
  const events = [
    ...["a", "b", "c"].map((c, i) => created(h(i), c)),
    ...[1, 2, 3, 4, 5].map((i) => moved(h(10 + i), `m${i}`, "Drafts", "Ready")),
    archived(h(20), "x"),
    archived(h(21), "y"),
    progress(h(30), "t", 0, 3, 8),
    progress(h(32), "t", 3, 5, 8),
    progress(h(34), "t", 5, 4, 8),
    ...[1, 2, 3, 4].map((i) => started(h(40 + i), `s${i}`)),
    ended(h(50), "s1", 1),
    ended(h(51), "s2", 0),
    failing(h(52)),
  ];
  expect(summarize(events)).toEqual({ created: 3, moved: 5, archived: 2, tasksCompleted: 5, sessions: 4, attention: 2 });
});

test("collapsing does not change the figures; only the first page carries them, over everything matching", () => {
  const ticks = [progress(T0, "c", 3, 4), progress(T0 + 10 * MIN, "c", 4, 6), progress(T0 + 40 * MIN, "c", 6, 7)];
  const page = pageEvents(ticks);
  expect(page.events).toHaveLength(1);
  expect(page.summary?.tasksCompleted).toBe(4);

  const many = Array.from({ length: 350 }, (_, i) => moved(T0 + i * MIN, `m${i}`, "Drafts", "Ready", i % 2 ? "r2" : "r1"));
  const first = pageEvents(many, { limit: 100 });
  expect(first.events).toHaveLength(100);
  expect(first.summary?.moved).toBe(350);
  expect(pageEvents(many, { limit: 100, before: first.nextBefore }).summary).toBeUndefined();
  expect(pageEvents(many, { repos: ["r2"] }).summary?.moved).toBe(175);
  expect(pageEvents(many, { kinds: ["session-started"] }).summary?.moved).toBe(0);
  expect(pageEvents([]).summary).toEqual({ created: 0, moved: 0, archived: 0, tasksCompleted: 0, sessions: 0, attention: 0 });
});

// ---- metrics (add-metrics-to-activity) ----

const H = 60 * MIN;
const named = (event: ActivityEvent, repoId: string, repoName: string): ActivityEvent => ({ ...event, repoId, repoName });
const tracked = (atMs: number, repoId: string, repoName: string): ActivityEvent => ({ ...base(atMs, repoId), repoName, kind: "repo-tracked", openChanges: 3 });

test("a week per day: every day of the window, quiet ones at zero, events and distinct changes per day", () => {
  const now = Date.parse("2026-10-07T15:00:00.000Z");
  const today = Array.from({ length: 12 }, (_, i) => moved(now - i * MIN, `t${i % 3}`, "Ready", "Implementing"));
  const thursday = Array.from({ length: 40 }, (_, i) => progress(Date.parse("2026-10-01T08:00:00.000Z") + i * MIN, `c${i % 9}`, 0, 1));
  const m = measure([...thursday, ...today], now, "UTC");
  expect(m.days.map((d) => d.day)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
  expect(m.days[1]).toMatchObject({ day: "2026-10-01", events: 40, changes: 9, groups: { changes: 0, tasks: 40, sessions: 0, repositories: 0 } });
  expect(m.days[1].figures.tasksCompleted).toBe(40);
  expect(m.days[6]).toEqual({ day: "2026-10-06", events: 0, changes: 0, groups: NO_GROUPS, figures: NO_FIGURES, hours: new Array(24).fill(0) });
  expect(m.days[7]).toMatchObject({ day: "2026-10-07", events: 12, changes: 3, groups: { changes: 12, tasks: 0, sessions: 0, repositories: 0 } });
  expect(m.days[7].figures.moved).toBe(12);
  expect(m.events).toBe(52);
  expect(m.changes).toBe(12);
});

test("local days: an event counts on the day of its time in the requested zone", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z");
  const late = moved(Date.parse("2026-10-06T23:30:00.000Z"), "a", "Ready", "Implementing");
  const count = (tz: string) => Object.fromEntries(measure([late], now, tz).days.map((d) => [d.day, d.events]));
  expect(count("Europe/Zurich")["2026-10-07"]).toBe(1);
  expect(count("Europe/Zurich")["2026-10-06"]).toBe(0);
  expect(count("UTC")["2026-10-06"]).toBe(1);
  const hour = (tz: string) => measure([late], now, tz).days.flatMap((d) => d.hours.map((n, h) => (n ? `${d.day} ${h}` : ""))).filter(Boolean);
  expect(hour("Europe/Zurich")).toEqual(["2026-10-07 1"]);
  expect(hour("UTC")).toEqual(["2026-10-06 23"]);
});

test("breakdown of a day: per kind group, its own figures and its events per hour", () => {
  const now = Date.parse("2026-10-07T18:00:00.000Z");
  const created: ActivityEvent = { ...base(Date.parse("2026-10-07T09:10:00.000Z")), kind: "change-created", change: "a", to: "Drafts" };
  const ticks = progress(Date.parse("2026-10-07T14:05:00.000Z"), "a", 1, 3, 4);
  const session = started(Date.parse("2026-10-07T14:40:00.000Z"), "a");
  const today = measure([created, ticks, session], now, "UTC").days.at(-1);
  expect(today?.groups).toEqual({ changes: 1, tasks: 1, sessions: 1, repositories: 0 });
  expect(today?.figures).toEqual({ ...NO_FIGURES, created: 1, tasksCompleted: 2, sessions: 1 });
  expect(today?.hours.flatMap((n, h) => (n ? [[h, n]] : []))).toEqual([[9, 1], [14, 2]]);
  expect(today?.hours).toHaveLength(24);
});

test("a daylight-saving week skips and repeats no day", () => {
  for (const [tz, now] of [["Europe/Zurich", "2026-10-28T12:00:00.000Z"], ["America/New_York", "2026-11-04T12:00:00.000Z"], ["Europe/Zurich", "2026-03-31T12:00:00.000Z"]] as const) {
    const days = measure([], Date.parse(now), tz).days.map((d) => d.day);
    expect(days).toHaveLength(8);
    for (let i = 1; i < days.length; i++) expect(Date.parse(days[i]) - Date.parse(days[i - 1])).toBe(DAY);
    expect(days.at(-1)).toBe(now.slice(0, 10));
  }
});

test("per project: busiest first, distinct changes, repository events count as events only, the newest name kept", () => {
  const now = T0 + DAY;
  const events = [
    ...Array.from({ length: 30 }, (_, i) => named(moved(T0 + i * MIN, `d${i % 4}`, "Ready", "Implementing"), "r1", "demo-ops")),
    ...Array.from({ length: 12 }, (_, i) => named(moved(T0 + i * MIN, `a${i % 5}`, "Ready", "Implementing"), "r2", "alpha-infra-old")),
    named(moved(T0 + H, "a0", "Implementing", "Done"), "r2", "alpha-infra"),
    tracked(T0, "r3", "beta-soc"),
    tracked(T0 + MIN, "r3", "beta-soc"),
  ];
  expect(measure(events, now).repos).toEqual([
    { repoId: "r1", repoName: "demo-ops", events: 30, changes: 4, groups: { ...NO_GROUPS, changes: 30 } },
    { repoId: "r2", repoName: "alpha-infra", events: 13, changes: 5, groups: { ...NO_GROUPS, changes: 13 } },
    { repoId: "r3", repoName: "beta-soc", events: 2, changes: 0, groups: { ...NO_GROUPS, repositories: 2 } },
  ]);
  const ties = [tracked(T0, "r9", "zeta"), tracked(T0, "r8", "eta")];
  expect(measure(ties, now).repos.map((r) => r.repoName)).toEqual(["eta", "zeta"]);
});

test("the same change name in two projects counts twice", () => {
  const events = [named(moved(T0, "add-login", "Ready", "Implementing"), "r1", "demo-ops"), named(moved(T0, "add-login", "Ready", "Implementing"), "r2", "alpha-infra")];
  expect(measure(events, T0 + DAY).changes).toBe(2);
});

test("metrics count recorded events, follow the filters and come with the first page only", () => {
  const ticks = [progress(T0, "c", 3, 4), progress(T0 + 10 * MIN, "c", 4, 6), progress(T0 + 40 * MIN, "c", 6, 7)];
  const page = pageEvents(ticks, {}, T0 + DAY);
  expect(page.events).toHaveLength(1);
  expect(page.metrics?.events).toBe(3);
  expect(page.metrics?.repos).toEqual([{ repoId: "r1", repoName: "demo-ops", events: 3, changes: 1, groups: { ...NO_GROUPS, tasks: 3 } }]);

  const many = Array.from({ length: 350 }, (_, i) => moved(T0 + i * MIN, `m${i}`, "Drafts", "Ready", i % 2 ? "r2" : "r1"));
  const first = pageEvents(many, { limit: 100 }, T0 + DAY);
  expect(first.metrics?.events).toBe(350);
  expect(pageEvents(many, { limit: 100, before: first.nextBefore }, T0 + DAY).metrics).toBeUndefined();
  expect(pageEvents(many, { repos: ["r2"] }, T0 + DAY).metrics?.repos.map((r) => r.repoId)).toEqual(["r2"]);
  expect(pageEvents(many, { kinds: ["session-started"] }, T0 + DAY).metrics?.repos).toEqual([]);
});

test("idle() resolves only once an append queued before it is on disk, and also when that append failed", async () => {
  const path = file("idle");
  const log = new ActivityLog(path, clock);
  await log.load();
  void log.append([moved(T0, "lint-rules", "Specs", "Ready")]);
  await log.idle();
  expect(await changesIn(path)).toEqual(["lint-rules"]);

  await writeFile(join(dir, "idle-not-a-dir"), "x");
  const broken = new ActivityLog(join(dir, "idle-not-a-dir", "activity.jsonl"), clock);
  let appended = false;
  void broken.append([moved(T0, "lint-rules", "Specs", "Ready")]).then(() => (appended = true));
  await broken.idle();
  await Promise.resolve();
  expect(appended).toBe(true);
});
