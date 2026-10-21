import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { diffSnapshots, sessionEvent, type SessionActivity } from "../src/server/activity/events.ts";
import { ActivityLog } from "../src/server/activity/log.ts";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { activityLogPath } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { ACTIVITY_GROUPS, ACTIVITY_KINDS, type ActivityEvent, type ActivityPage, type ChangeSession, type Snapshot } from "../src/shared/types.ts";
import { activityQueryString, httpApi } from "../src/ui/api.ts";
import { useTempHome } from "./helpers.ts";
import { git, harness, tempGitRepo, waitFor } from "./sessionHelpers.ts";

let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
let activity: ActivityLog;

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  activity = new ActivityLog();
  await activity.load();
  state = { config: defaultConfig(), scanner: undefined as unknown as Scanner, activity };
  state.scanner = new Scanner(() => state.config, {
    persist: false,
    onSnapshots: (previous, next) => void activity.append(diffSnapshots(previous, next, { now: new Date(), pollIntervalSeconds: state.config.pollIntervalSeconds })),
  });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "<title>stub</title>" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  state.scanner.stop();
  server.stop(true);
  await cleanup();
});

const page = async (query = "") => (await (await fetch(`${base}/api/activity${query}`)).json()) as ActivityPage;
const kinds = (p: ActivityPage) => p.events.map((e) => e.kind);
const QUIET = expect.objectContaining({ events: 0, changes: 0, repos: [] });
const NO_FIGURES = { created: 0, moved: 0, archived: 0, tasksCompleted: 0, sessions: 0, attention: 0 };

test("nothing recorded: an empty feed; without a log at all the endpoint still answers", async () => {
  expect(await page()).toEqual({ events: [], summary: NO_FIGURES, metrics: QUIET });
  const days = (await page()).metrics?.days ?? [];
  expect(days.length).toBeGreaterThanOrEqual(8);
  expect(days.every((d) => d.events === 0 && d.changes === 0)).toBe(true);
  const bare = createFetchHandler({ state: { config: state.config, scanner: state.scanner }, indexHtml: "" });
  expect(await (await bare(new Request(`${base}/api/activity`))).json()).toEqual({ events: [], summary: NO_FIGURES, metrics: QUIET });
});

test("scans feed the log: baseline on first sight, then real changes; the log lives in the dashboard home and holds no paths", async () => {
  const repoPath = await tempGitRepo();
  state.config = { ...state.config, repos: [newRepoConfig(repoPath, true)] };
  await state.scanner.trigger().done;
  await activity.append([]);
  expect(kinds(await page())).toEqual(["repo-tracked"]);

  // tick one task and start a new change in the repository, then scan again
  const tasksFile = join(repoPath, "openspec", "changes", "cloud-deployment", "tasks.md");
  await writeFile(tasksFile, (await readFile(tasksFile, "utf8")).replace("- [ ]", "- [x]"));
  await mkdir(join(repoPath, "openspec", "changes", "add-login"), { recursive: true });
  await writeFile(join(repoPath, "openspec", "changes", "add-login", "proposal.md"), "## Why\n\nDemo.\n");
  await state.scanner.trigger().done;
  await activity.append([]);
  const feed = await page();
  expect(new Set(kinds(feed))).toEqual(new Set(["repo-tracked", "tasks-progress", "change-created"]));
  const progress = feed.events.find((e) => e.kind === "tasks-progress") as Extract<ActivityEvent, { kind: "tasks-progress" }>;
  expect(progress).toMatchObject({ change: "cloud-deployment", repoName: "demo-ops" });
  expect(progress.to.done).toBe(progress.from.done + 1);

  // nothing changed: nothing recorded
  await state.scanner.trigger().done;
  await activity.append([]);
  expect((await page()).events).toHaveLength(3);

  const raw = await readFile(activityLogPath(), "utf8");
  expect(raw.trim().split("\n")).toHaveLength(3);
  expect(raw).not.toContain(repoPath);
  // the repository holds only what this test itself edited: recording activity wrote nothing there
  const dirty = git(repoPath, "status", "--porcelain").split("\n").filter(Boolean);
  expect(dirty.filter((l) => !l.includes("add-login") && !l.includes("tasks.md"))).toEqual([]);
  expect(dirty.length).toBe(2);
});

test("paging, filters and validation", async () => {
  const first = await page("?limit=2");
  expect(first.events).toHaveLength(2);
  const second = await page(`?limit=2&before=${first.nextBefore}`);
  expect(second.events).toHaveLength(1);
  expect(second.nextBefore).toBeUndefined();
  // The figures count everything matching on the first page, whatever the limit, and older pages do not repeat them.
  expect(first.summary).toEqual({ ...NO_FIGURES, created: 1, tasksCompleted: 1 });
  expect(second.summary).toBeUndefined();
  expect(first.metrics?.events).toBe(3);
  expect(second.metrics).toBeUndefined();
  expect(new Set([...first.events, ...second.events].map((e) => e.id)).size).toBe(3);

  const repoId = state.config.repos[0].id;
  const onlyTasks = await page(`?kinds=tasks-progress&repos=${repoId}`);
  expect(kinds(onlyTasks)).toEqual(["tasks-progress"]);
  expect(onlyTasks.summary).toEqual({ ...NO_FIGURES, tasksCompleted: 1 });
  expect((await page("?repos=unknown")).summary).toEqual(NO_FIGURES);
  expect(onlyTasks.metrics?.repos.map((r) => r.repoId)).toEqual([repoId]);
  // The charts' breakdowns follow the filters too: only the tasks group, on the day and in the hour it happened.
  expect(onlyTasks.metrics?.repos[0].groups).toEqual({ changes: 0, tasks: 1, sessions: 0, repositories: 0 });
  const totals = (p: ActivityPage) => p.metrics?.days.reduce((n, d) => n + d.groups.tasks + d.groups.changes + d.groups.sessions + d.groups.repositories, 0);
  expect(totals(onlyTasks)).toBe(1);
  expect(onlyTasks.metrics?.days.reduce((n, d) => n + d.hours.reduce((a, b) => a + b, 0), 0)).toBe(1);
  expect(onlyTasks.metrics?.days.reduce((n, d) => n + d.figures.tasksCompleted, 0)).toBe(1);
  expect(totals(first)).toBe(3);
  expect((await page("?repos=unknown")).metrics).toEqual(QUIET);
  // Days are the client's: the last one is today where the client is, also when that differs from UTC.
  const zurich = await page("?tz=Europe/Zurich");
  expect(zurich.metrics?.days.at(-1)?.day).toBe(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" }));
  expect(zurich.metrics?.events).toBe(3);
  expect(onlyTasks.newestId).toBe((await page()).newestId);
  expect((await page("?repos=unknown")).events).toEqual([]);
  expect((await page(`?limit=1&since=${second.events[0].id}`)).newerThanSince).toBe(2);

  for (const bad of ["?limit=0", "?limit=501", "?limit=abc", "?limit=1.5", "?kinds=made-up", "?tz=Mars/Olympus", "?tz="]) {
    const res = await fetch(`${base}/api/activity${bad}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  }
  expect((await fetch(`${base}/api/activity`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(404);
});

test("the session manager reports started, shipped and ended — and nothing decides anything from it", async () => {
  const reported: { session: ChangeSession; what: SessionActivity }[] = [];
  const h = await harness();
  const manager = h.newManager({ onActivity: (session, what) => reported.push({ session, what }), submitTimings: { echoTimeoutMs: 600, settleMs: 20 } });
  try {
    const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
    await writeFile(join(s.worktreePath, "work.txt"), "x");
    await manager.ship(s.id);
    manager.write(s.id, "crash\r");
    await waitFor(() => manager.get(s.id).state === "exited", "exit");
    await waitFor(() => reported.length === 3, "three reports");
    expect(reported.map((r) => r.what)).toEqual([{ kind: "session-started", action: "implement", agentName: "Fake Agent" }, { kind: "session-shipped", submitted: true }, { kind: "session-ended", exitCode: 3 }]);
    const event = sessionEvent(reported[2].session, "demo-ops", reported[2].what, new Date("2026-09-21T09:00:00.000Z"));
    expect(event).toMatchObject({ v: 1, kind: "session-ended", change: "upgrade-runtime", repoId: h.repoId, repoName: "demo-ops", exitCode: 3, at: "2026-09-21T09:00:00.000Z" });

    // a reporter that throws must not get in a session's way
    const fragile = h.newManager({
      onActivity: () => {
        throw new Error("feed is broken");
      },
    });
    const other = await fragile.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" });
    expect(other.state).toBe("running");
    await fragile.shutdown();
  } finally {
    await manager.shutdown();
  }
});

test("a broken activity callback never fails a scan", async () => {
  const scanner = new Scanner(() => state.config, {
    persist: false,
    onSnapshots: () => {
      throw new Error("feed is broken");
    },
  });
  const snapshot: Snapshot = await scanner.trigger().done;
  expect(snapshot.repos).toHaveLength(1);
});

test("resolving conflicts is reported as its own kind, with whether the prompt was submitted", async () => {
  const reported: { session: ChangeSession; what: SessionActivity }[] = [];
  const h = await harness();
  const manager = h.newManager({ onActivity: (session, what) => reported.push({ session, what }), submitTimings: { echoTimeoutMs: 600, settleMs: 20 } });
  try {
    const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
    await waitFor(() => manager.get(s.id).state === "running", "the agent");

    // Same line on both sides, so the branch no longer merges into the base.
    await writeFile(join(s.worktreePath, "shared.txt"), "branch side\n");
    git(s.worktreePath, "add", "-A");
    git(s.worktreePath, "commit", "-q", "-m", "branch edit");
    await writeFile(join(h.repoPath, "shared.txt"), "main side\n");
    git(h.repoPath, "add", "-A");
    git(h.repoPath, "commit", "-q", "-m", "main edit");

    await manager.resolveConflicts(s.id);
    await waitFor(() => reported.some((r) => r.what.kind === "session-conflicts-resolve"), "the report");
    expect(reported.map((r) => r.what.kind)).toEqual(["session-started", "session-conflicts-resolve"]);
    expect(reported[1].what).toEqual({ kind: "session-conflicts-resolve", submitted: true });

    const event = sessionEvent(reported[1].session, "demo-ops", reported[1].what, new Date("2026-09-21T09:00:00.000Z"));
    expect(event).toMatchObject({ v: 1, kind: "session-conflicts-resolve", change: "upgrade-runtime", repoId: h.repoId, repoName: "demo-ops", submitted: true });
  } finally {
    await manager.shutdown();
  }
});

test("Merge sent on its own is one event in the sessions group, naming the pull request, the dashboard and that it was submitted", () => {
  const what: SessionActivity = { kind: "session-merge", pr: 88, by: "dashboard", submitted: true };
  const event = sessionEvent({ repoId: "r", change: "cache-api-calls" }, "demo-ops", what, new Date("2026-10-21T09:00:00.000Z"));
  expect(event).toMatchObject({ v: 1, kind: "session-merge", change: "cache-api-calls", repoId: "r", repoName: "demo-ops", pr: 88, by: "dashboard", submitted: true });
  expect(ACTIVITY_GROUPS.sessions).toContain("session-merge");
  expect(ACTIVITY_KINDS).toContain("session-merge");
});

test("the client names its time zone, and falls back to UTC when the server does not know it", async () => {
  expect(activityQueryString({ limit: 100, tz: "Europe/Zurich" })).toBe("?limit=100&tz=Europe%2FZurich");
  expect(activityQueryString({ limit: 100 })).toBe("?limit=100");
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    return url.includes("tz=") ? Response.json({ error: "unknown time zone: Mars/Olympus" }, { status: 400 }) : Response.json({ events: [] });
  }) as typeof fetch;
  try {
    expect(await httpApi.activity({ limit: 1, tz: "Mars/Olympus" })).toEqual({ events: [] });
  } finally {
    globalThis.fetch = real;
  }
  expect(asked).toEqual(["/api/activity?limit=1&tz=Mars%2FOlympus", "/api/activity?limit=1"]);
});
