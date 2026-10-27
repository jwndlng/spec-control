import { expect, test } from "bun:test";
import { diffSnapshots, newEventId } from "../src/server/activity/events.ts";
import { rederive } from "../src/server/cache.ts";
import type { ChangeSnapshot, RepoSnapshot, Snapshot } from "../src/shared/types.ts";

const T0 = Date.parse("2026-09-21T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

function change(name: string, column: string, patch: Partial<ChangeSnapshot> = {}): ChangeSnapshot {
  return { repoId: "r1", name, schema: "spec-driven", artifacts: [], tasks: null, stage: "drafts", column, ...patch };
}
function repo(id: string, name: string, changes: ChangeSnapshot[], patch: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return { id, name, path: `/w/acme/${name}`, ok: true, scannedAt: iso(T0), isGit: true, worktrees: [], changes, ...patch };
}
const snap = (at: number, repos: RepoSnapshot[]): Snapshot => ({ generatedAt: iso(at), repos });
const diff = (previous: Snapshot, next: Snapshot, nowMs = Date.parse(next.generatedAt)) => diffSnapshots(previous, next, { now: new Date(nowMs), pollIntervalSeconds: 60 });
const brief = (events: ReturnType<typeof diff>) => events.map(({ v, id, at, detectedAt, repoId, catchUp, ...rest }) => rest);

test("a change that moves to another column", () => {
  const events = diff(snap(T0, [repo("r1", "demo-ops", [change("cache-api-calls", "Drafts")])]), snap(T0 + MIN, [repo("r1", "demo-ops", [change("cache-api-calls", "Ready", { tasks: { done: 0, total: 7 } })])]));
  expect(brief(events)).toEqual([{ kind: "change-moved", repoName: "demo-ops", change: "cache-api-calls", from: "Drafts", to: "Ready", tasks: { done: 0, total: 7 } }]);
  expect(events[0]).toMatchObject({ v: 1, repoId: "r1" });
});

test("task progress within a column; moved and progressed at once is one move", () => {
  const before = snap(T0, [repo("r1", "demo-ops", [change("a", "Implementing", { tasks: { done: 3, total: 12 } }), change("b", "Ready", { tasks: { done: 0, total: 7 } })])]);
  const after = snap(T0 + MIN, [repo("r1", "demo-ops", [change("a", "Implementing", { tasks: { done: 7, total: 12 } }), change("b", "Implementing", { tasks: { done: 2, total: 7 } })])]);
  expect(brief(diff(before, after))).toEqual([
    { kind: "tasks-progress", repoName: "demo-ops", change: "a", column: "Implementing", from: { done: 3, total: 12 }, to: { done: 7, total: 12 } },
    { kind: "change-moved", repoName: "demo-ops", change: "b", from: "Ready", to: "Implementing", tasks: { done: 2, total: 7 } },
  ]);
});

test("task progress keeps the counts, never the text of the tasks that need the user", () => {
  const before = snap(T0, [repo("r1", "demo-ops", [change("a", "Implementing", { tasks: { done: 3, awaiting: 1, awaitingTasks: ["Check it"], total: 12 } })])]);
  const after = snap(T0 + MIN, [repo("r1", "demo-ops", [change("a", "Implementing", { tasks: { done: 7, awaiting: 2, awaitingTasks: ["Check it", "Sign in"], total: 12 } })])]);
  expect(brief(diff(before, after))).toEqual([
    { kind: "tasks-progress", repoName: "demo-ops", change: "a", column: "Implementing", from: { done: 3, awaiting: 1, total: 12 }, to: { done: 7, awaiting: 2, total: 12 } },
  ]);
});

test("created, archived and removed", () => {
  const before = snap(T0, [repo("r1", "demo-ops", [change("bump-toolchain", "Done"), change("old-idea", "Backlog")])]);
  const after = snap(T0 + MIN, [repo("r1", "demo-ops", [change("add-login", "Backlog"), change("bump-toolchain", "Archived", { archived: "2026-09-21", stage: "archived" })])]);
  expect(brief(diff(before, after))).toEqual([
    { kind: "change-created", repoName: "demo-ops", change: "add-login", to: "Backlog" },
    { kind: "change-archived", repoName: "demo-ops", change: "bump-toolchain", from: "Done" },
    { kind: "change-removed", repoName: "demo-ops", change: "old-idea", from: "Backlog" },
  ]);
});

test("nothing changed, nothing recorded", () => {
  const repos = [repo("r1", "demo-ops", [change("a", "Ready", { tasks: { done: 0, total: 3 } }), change("z", "Archived", { archived: "2026-01-01" })])];
  expect(diff(snap(T0, repos), snap(T0 + MIN, structuredClone(repos)))).toEqual([]);
});

test("first sight of a repository is a baseline: one tracked event, none per change", () => {
  const many = Array.from({ length: 40 }, (_, i) => change(`c${i}`, i % 2 ? "Ready" : "Archived", i % 2 ? {} : { archived: "2026-09-20" }));
  const first = diff(snap(T0, []), snap(T0 + MIN, [repo("r1", "demo-ops", many), repo("r2", "beta-soc", [change("x", "Backlog")])]));
  expect(brief(first)).toEqual([
    { kind: "repo-tracked", repoName: "demo-ops", openChanges: 20 },
    { kind: "repo-tracked", repoName: "beta-soc", openChanges: 1 },
  ]);
  // enabling one more repository later behaves the same, and the known one is compared normally
  const later = diff(snap(T0, [repo("r1", "demo-ops", [change("a", "Drafts")])]), snap(T0 + MIN, [repo("r1", "demo-ops", [change("a", "Ready")]), repo("r2", "beta-soc", many)]));
  expect(brief(later).map((e) => e.kind)).toEqual(["change-moved", "repo-tracked"]);
});

test("a repository that is no longer tracked", () => {
  expect(brief(diff(snap(T0, [repo("r1", "demo-ops", [change("a", "Ready")])]), snap(T0 + MIN, [])))).toEqual([{ kind: "repo-untracked", repoName: "demo-ops" }]);
});

test("a failing scan is not activity: failing, silence, recovered, then comparison resumes", () => {
  const healthy = repo("r1", "demo-ops", [change("a", "Drafts")]);
  const failing = repo("r1", "demo-ops", [change("a", "Drafts")], { ok: false, error: "timed out" });
  expect(brief(diff(snap(T0, [healthy]), snap(T0 + MIN, [failing])))).toEqual([{ kind: "repo-failing", repoName: "demo-ops", error: "timed out" }]);
  expect(diff(snap(T0, [failing]), snap(T0 + MIN, [failing]))).toEqual([]);
  // recovering with different changes reports only the recovery; the next scan compares again
  const recovered = repo("r1", "demo-ops", [change("a", "Ready"), change("b", "Backlog")]);
  expect(brief(diff(snap(T0, [failing]), snap(T0 + MIN, [recovered])))).toEqual([{ kind: "repo-recovered", repoName: "demo-ops" }]);
  expect(brief(diff(snap(T0, [recovered]), snap(T0 + MIN, [repo("r1", "demo-ops", [change("a", "Implementing"), change("b", "Backlog")])]))).map((e) => e.kind)).toEqual(["change-moved"]);
});

test("archives never seen before count only when recent", () => {
  const before = snap(T0, [repo("r1", "demo-ops", [])]);
  const after = snap(T0 + MIN, [repo("r1", "demo-ops", [change("months-old", "Archived", { archived: "2026-03-02" }), change("last-week", "Archived", { archived: "2026-09-18" })])]);
  expect(brief(diff(before, after))).toEqual([{ kind: "change-archived", repoName: "demo-ops", change: "last-week" }]);
});

test("event time: the change's last activity when it lies between the snapshots, otherwise detection time", () => {
  const before = snap(T0, [repo("r1", "demo-ops", [change("inside", "Drafts"), change("stale", "Drafts"), change("future", "Drafts")])]);
  const after = snap(T0 + 5 * MIN, [
    repo("r1", "demo-ops", [
      change("inside", "Ready", { lastActivityAt: iso(T0 + 2 * MIN) }),
      change("stale", "Ready", { lastActivityAt: iso(T0 - 60 * MIN) }),
      change("future", "Ready", { lastActivityAt: iso(T0 + 50 * MIN) }),
    ]),
  ]);
  const events = diff(before, after);
  expect(events.map((e) => e.at)).toEqual([iso(T0 + 2 * MIN), iso(T0 + 5 * MIN), iso(T0 + 5 * MIN)]);
  expect(new Set(events.map((e) => e.detectedAt))).toEqual(new Set([iso(T0 + 5 * MIN)]));
});

test("catch-up: marked when the snapshots are further apart than three poll intervals", () => {
  const before = [repo("r1", "demo-ops", [change("add-login", "Done")])];
  const archived = [repo("r1", "demo-ops", [change("add-login", "Archived", { archived: "2026-09-19", lastActivityAt: "2026-09-19T14:02:00.000Z" })])];
  const friday = Date.parse("2026-09-18T17:00:00.000Z");
  const [weekend] = diff(snap(friday, before), snap(T0, archived));
  expect(weekend).toMatchObject({ kind: "change-archived", catchUp: true, at: "2026-09-19T14:02:00.000Z" });
  const [regular] = diff(snap(T0 - MIN, before), snap(T0, archived));
  expect(regular.catchUp).toBeUndefined();
});

test("ids are unique and sort in the order they were created, also within one millisecond", () => {
  const ids = Array.from({ length: 500 }, () => newEventId(T0));
  expect(new Set(ids).size).toBe(500);
  expect([...ids].sort()).toEqual(ids);
  expect(newEventId(T0 + 1) > ids[ids.length - 1]).toBe(true);
  const events = diff(snap(T0, [repo("r1", "demo-ops", [change("a", "Drafts"), change("b", "Drafts")])]), snap(T0 + MIN, [repo("r1", "demo-ops", [change("a", "Ready"), change("b", "Ready")])]));
  expect(events[0].id < events[1].id).toBe(true);
});

test("a snapshot cached by a version with other columns is re-derived, so the first scan records no moves", () => {
  const A = (...done: boolean[]) => ["proposal", "specs", "design", "tasks"].map((id, i) => ({ id, status: done[i] ? ("done" as const) : ("ready" as const) }));
  const fresh = [
    change("cache-api-calls", "Drafts", { artifacts: A(true, true, true, false) }),
    change("bump-toolchain", "Done", { stage: "done", artifacts: A(true, true, true, true), tasks: { done: 4, total: 4 }, specsSynced: true }),
  ];
  // What an older version wrote: its own column names and stages for the very same data.
  const cached = [
    { ...fresh[0], stage: "artifact", column: "Specs" },
    { ...fresh[1], stage: "synced", column: "Synced" },
  ] as unknown as ChangeSnapshot[];
  const adopted = rederive(snap(T0, [repo("r1", "demo-ops", cached)]));
  expect(adopted.repos[0].changes.map((c) => [c.stage, c.column])).toEqual([["drafts", "Drafts"], ["done", "Done"]]);
  expect(diff(adopted, snap(T0 + MIN, [repo("r1", "demo-ops", fresh)]))).toEqual([]);
});

test("a snapshot cached before `awaiting` existed loads as `complete`, and a stale sub-state is dropped", () => {
  const A = ["proposal", "specs", "design", "tasks"].map((id) => ({ id, status: "done" as const }));
  const cached = [
    // No `awaiting`, no `subState`: what every version before this one wrote.
    change("bump-toolchain", "Done", { stage: "done", artifacts: A, tasks: { done: 4, total: 4 } }),
    // A sub-state left over from a scan before a task was reopened; it is derived, so it must not survive.
    change("cache-api-calls", "Done", { stage: "done", artifacts: A, tasks: { done: 2, total: 4 }, subState: "validate" }),
  ];
  const adopted = rederive(snap(T0, [repo("r1", "demo-ops", cached)])).repos[0].changes;
  expect(adopted.map((c) => [c.column, c.subState])).toEqual([["Done", "complete"], ["Implementing", undefined]]);
});

test("a cached change without a design keeps its column until rescanned, and keeps the required flag it was scanned with", () => {
  const artifacts = (required: boolean | undefined) =>
    ["proposal", "specs", "design", "tasks"].map((id) => ({ id, status: id === "design" ? ("ready" as const) : ("done" as const), ...(required === undefined ? {} : { required: id === "tasks" }) }));
  const cached = [
    // Written before artifacts said which are required: every artifact counts, so the missing design keeps it in Drafts.
    change("trim-log-noise", "Drafts", { artifacts: artifacts(undefined), tasks: { done: 0, total: 3 } }),
    // Scanned by this version: only `tasks` is required, so it is Ready.
    change("drop-legacy-flags", "Ready", { stage: "ready", artifacts: artifacts(true), tasks: { done: 0, total: 3 } }),
  ];
  const adopted = rederive(snap(T0, [repo("r1", "demo-ops", cached)])).repos[0].changes;
  expect(adopted.map((c) => c.column)).toEqual(["Drafts", "Ready"]);
  expect(adopted[1].artifacts.map((a) => a.required)).toEqual([false, false, false, true]);
});
