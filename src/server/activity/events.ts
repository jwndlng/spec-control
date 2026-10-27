// What happened between two snapshots (design: add-activity-feed D1, D3, D4). Pure: a function of the two
// snapshots only — it reads no repository and no clock other than the `now` it is given.
import type { ActivityEvent, ChangeSnapshot, RepoSnapshot, Snapshot, TaskProgress } from "../../shared/types.ts";

/** An archive the dashboard never saw before only counts as activity when it is this recent (e.g. not after a pull). */
const RECENT_ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000;
/** Snapshots further apart than this many poll intervals mean the dashboard was not running in between. */
const CATCH_UP_INTERVALS = 3;

let lastIdTime = 0;
let idCounter = 0;

/** Unique and sortable: a fixed-width millisecond timestamp, a counter for events of the same millisecond, a random tail. */
export function newEventId(now = Date.now()): string {
  if (now <= lastIdTime) idCounter += 1;
  else {
    lastIdTime = now;
    idCounter = 0;
  }
  const random = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `${lastIdTime.toString(36).padStart(9, "0")}${idCounter.toString(36).padStart(3, "0")}${random}`;
}

export interface DiffOptions {
  now: Date;
  pollIntervalSeconds: number;
}

// Distributes over the union, so each event kind keeps its own fields.
type Draft = ActivityEvent extends infer E ? (E extends ActivityEvent ? Omit<E, "v" | "id" | "at" | "detectedAt" | "repoId" | "repoName" | "catchUp"> : never) : never;

const sameTasks = (a: TaskProgress | null, b: TaskProgress | null) => (a?.done ?? -1) === (b?.done ?? -1) && (a?.total ?? -1) === (b?.total ?? -1);
/** The counts only: the `[~]` tasks' text (`awaitingTasks`) is the repository's current state, not history to keep. */
const taskCounts = ({ awaitingTasks: _text, ...counts }: TaskProgress): TaskProgress => counts;
const tasksOf = (c: ChangeSnapshot) => (c.tasks ? { tasks: { done: c.tasks.done, total: c.tasks.total } } : {});
const openChanges = (repo: RepoSnapshot) => repo.changes.filter((c) => !c.archived).length;

export function diffSnapshots(previous: Snapshot, next: Snapshot, options: DiffOptions): ActivityEvent[] {
  const nowMs = options.now.getTime();
  const previousMs = Date.parse(previous.generatedAt);
  const catchUp = Number.isFinite(previousMs) && nowMs - previousMs > CATCH_UP_INTERVALS * options.pollIntervalSeconds * 1000;
  const detectedAt = options.now.toISOString();
  const events: ActivityEvent[] = [];

  const emit = (repo: RepoSnapshot, draft: Draft, change?: ChangeSnapshot) => {
    // The change's own last activity is the better time, but only when it falls between the two snapshots.
    const activityMs = change?.lastActivityAt ? Date.parse(change.lastActivityAt) : Number.NaN;
    const useActivity = Number.isFinite(activityMs) && Number.isFinite(previousMs) && activityMs > previousMs && activityMs <= nowMs;
    events.push({
      v: 1,
      id: newEventId(nowMs),
      at: useActivity ? new Date(activityMs).toISOString() : detectedAt,
      detectedAt,
      repoId: repo.id,
      repoName: repo.name,
      ...(catchUp ? { catchUp: true } : {}),
      ...draft,
    } as ActivityEvent);
  };

  const before = new Map(previous.repos.map((r) => [r.id, r]));
  const after = new Set(next.repos.map((r) => r.id));

  for (const repo of next.repos) {
    const was = before.get(repo.id);
    if (!was) {
      // First sight of a repository is a baseline, not activity: one line, nothing per change.
      emit(repo, { kind: "repo-tracked", openChanges: openChanges(repo) });
      continue;
    }
    if (was.ok && !repo.ok) emit(repo, { kind: "repo-failing", error: repo.error ?? "scan failed" });
    if (!was.ok && repo.ok) emit(repo, { kind: "repo-recovered" });
    // A failing scan keeps showing the previous changes; comparing them would say nothing (or something wrong).
    if (!repo.ok || !was.ok) continue;

    const wasChanges = new Map(was.changes.map((c) => [c.name, c]));
    const seen = new Set<string>();
    for (const change of repo.changes) {
      seen.add(change.name);
      const old = wasChanges.get(change.name);
      if (!old) {
        if (!change.archived) emit(repo, { kind: "change-created", change: change.name, to: change.column, ...tasksOf(change) }, change);
        else if (nowMs - Date.parse(change.archived) <= RECENT_ARCHIVE_MS) emit(repo, { kind: "change-archived", change: change.name }, change);
        continue;
      }
      if (!old.archived && change.archived) emit(repo, { kind: "change-archived", change: change.name, from: old.column }, change);
      else if (old.column !== change.column) emit(repo, { kind: "change-moved", change: change.name, from: old.column, to: change.column, ...tasksOf(change) }, change);
      else if (!change.archived && change.tasks && old.tasks && !sameTasks(old.tasks, change.tasks)) {
        emit(repo, { kind: "tasks-progress", change: change.name, column: change.column, from: taskCounts(old.tasks), to: taskCounts(change.tasks) }, change);
      }
    }
    for (const old of was.changes) {
      if (!seen.has(old.name) && !old.archived) emit(repo, { kind: "change-removed", change: old.name, from: old.column });
    }
  }

  for (const was of previous.repos) {
    if (!after.has(was.id)) emit(was, { kind: "repo-untracked" });
  }
  return events;
}

/** What the session manager reports; the base fields are filled in by `sessionEvent`. */
export type SessionActivity =
  | { kind: "session-started"; action: string; agentName: string; resumed?: boolean }
  | { kind: "session-ended"; exitCode?: number; error?: string }
  | { kind: "session-shipped"; submitted?: boolean }
  | { kind: "session-conflicts-resolve"; submitted?: boolean }
  | { kind: "session-auto-ended"; pr: number; removed: boolean; reason?: string }
  | { kind: "session-merge"; pr: number; by: "dashboard" | "user"; submitted: boolean };

export function sessionEvent(session: { repoId: string; change: string }, repoName: string, activity: SessionActivity, now = new Date()): ActivityEvent {
  const at = now.toISOString();
  return { v: 1, id: newEventId(now.getTime()), at, detectedAt: at, repoId: session.repoId, repoName, change: session.change, ...activity } as ActivityEvent;
}
