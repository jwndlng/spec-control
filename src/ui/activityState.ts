// The Activity view's pure parts: filters ↔ URL, grouping by day, wording, and what counts as unseen.
// Free of DOM access at import time; the storage helpers tolerate a browser that refuses localStorage.
import { needsAttention } from "../shared/activity.ts";
import { ACTIVITY_GROUPS, type ActivityEvent, type ActivityKind, type ActivityRepoCount, type ActivitySummary } from "../shared/types.ts";
import { storageKey } from "./storage.ts";

export type ActivityGroup = keyof typeof ACTIVITY_GROUPS;
export const GROUP_LABELS: Record<ActivityGroup, string> = { changes: "Changes", tasks: "Tasks", sessions: "Sessions", repositories: "Repositories" };
export const GROUP_ORDER = Object.keys(GROUP_LABELS) as ActivityGroup[];

export interface ActivityFilters {
  repos: string[];
  /** Empty means every kind. */
  groups: ActivityGroup[];
}

export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = { repos: [], groups: [] };

export function parseActivityFilters(search: string): ActivityFilters {
  const params = new URLSearchParams(search);
  const list = (name: string) => (params.get(name) ?? "").split(",").filter(Boolean);
  return { repos: list("repos"), groups: list("show").filter((g): g is ActivityGroup => g in ACTIVITY_GROUPS) };
}

export function serializeActivityFilters(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  if (filters.repos.length) params.set("repos", filters.repos.join(","));
  if (filters.groups.length) params.set("show", GROUP_ORDER.filter((g) => filters.groups.includes(g)).join(","));
  const text = params.toString().replaceAll("%2C", ",");
  return text ? `?${text}` : "";
}

export function kindsFor(groups: readonly ActivityGroup[]): ActivityKind[] {
  return groups.flatMap((g) => ACTIVITY_GROUPS[g]);
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface ActivityDay {
  key: string;
  label: string;
  events: ActivityEvent[];
}

/** Groups events (newest first) under local calendar days: Today, Yesterday, then the date. */
export function groupByDay(events: readonly ActivityEvent[], now: Date): ActivityDay[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days: ActivityDay[] = [];
  for (const event of events) {
    const at = new Date(event.at);
    const key = dayKey(at);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      const label = key === today ? "Today" : key === yesterday ? "Yesterday" : at.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      day = { key, label, events: [] };
      days.push(day);
    }
    day.events.push(event);
  }
  return days;
}

export function timeOfDay(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

const tasks = (t: { done: number; total: number }) => `${t.done}/${t.total}`;

/** What happened, in a few words. The repository and the change are shown next to it, so they are not repeated here. */
export function describe(event: ActivityEvent): string {
  switch (event.kind) {
    case "change-created":
      return `created in ${event.to}`;
    case "change-moved":
      return `moved ${event.from} → ${event.to}${event.tasks ? ` · ${tasks(event.tasks)}` : ""}`;
    case "tasks-progress":
      return `tasks ${tasks(event.from)} → ${tasks(event.to)}`;
    case "change-archived":
      return event.from ? `archived from ${event.from}` : "archived";
    case "change-removed":
      return `removed (was in ${event.from})`;
    case "repo-tracked":
      return `now tracked · ${event.openChanges} open change${event.openChanges === 1 ? "" : "s"}`;
    case "repo-untracked":
      return "no longer tracked";
    case "repo-failing":
      return `scan failing: ${event.error}`;
    case "repo-recovered":
      return "scan recovered";
    case "session-started":
      return `session ${event.resumed ? "resumed" : "started"}: ${event.action} with ${event.agentName}`;
    case "session-ended":
      if (event.error) return `session failed: ${event.error}`;
      return event.exitCode === undefined || event.exitCode === 0 ? "session ended" : `session ended (exit ${event.exitCode})`;
    case "session-shipped":
      return event.submitted === false ? "ship requested — typed, not sent" : "ship requested";
    case "session-conflicts-resolve":
      // What was handed over, not what came of it: the outcome is re-read from git, never taken from the agent.
      return event.submitted === false ? "conflict resolution requested — typed, not sent" : "conflict resolution requested";
    case "session-auto-ended":
      return `session ended because #${event.pr} merged · ${event.removed ? "worktree removed" : `worktree kept: ${event.reason ?? "it could not be removed"}`}`;
    case "session-merge":
      // What was handed over, not what came of it: whether it merged is learned from a later pull-request query.
      return `merge of #${event.pr} requested${event.by === "dashboard" ? " by Spec Control, as it is ready and docs-only" : ""}${event.submitted ? "" : " — typed, not sent"}`;
  }
}

/** Visual weight of an entry: what needs a second look stands out, routine progress recedes. */
export function tone(event: ActivityEvent): "danger" | "ok" | "quiet" | "normal" {
  if (needsAttention(event)) return "danger";
  if (event.kind === "change-archived" || event.kind === "repo-recovered") return "ok";
  if (event.kind === "tasks-progress" || event.kind === "repo-tracked" || event.kind === "repo-untracked") return "quiet";
  return "normal";
}

// ---- summary strip (activity-summary) ----

export interface Figure {
  key: keyof ActivitySummary;
  label: string;
  /** The kinds of event it counts: hidden when the kind filter excludes all of them. */
  kinds: readonly ActivityKind[];
}

/** In display order. Labels say what happened, not what is, so they are not read as the state of the board. */
export const FIGURES: readonly Figure[] = [
  { key: "created", label: "changes created", kinds: ["change-created"] },
  { key: "moved", label: "changes moved", kinds: ["change-moved"] },
  { key: "archived", label: "changes archived", kinds: ["change-archived"] },
  { key: "tasksCompleted", label: "tasks completed", kinds: ["tasks-progress"] },
  { key: "sessions", label: "sessions run", kinds: ["session-started"] },
  { key: "attention", label: "need attention", kinds: ["repo-failing", "session-ended"] },
];

export function visibleFigures(groups: readonly ActivityGroup[]): Figure[] {
  if (groups.length === 0) return [...FIGURES];
  const shown = new Set(kindsFor(groups));
  return FIGURES.filter((f) => f.kinds.some((k) => shown.has(k)));
}

// ---- busy days (activity-summary) ----

/** A day with more loaded entries than this is collapsed… */
export const DAY_COLLAPSE_ABOVE = 30;
/** …to this many, its newest; the gap means the view never offers "Show 3 more". */
export const DAY_SHOWN = 20;

export function collapseDay(day: ActivityDay, expanded: boolean): { shown: ActivityEvent[]; hidden: number } {
  if (expanded || day.events.length <= DAY_COLLAPSE_ABOVE) return { shown: day.events, hidden: 0 };
  return { shown: day.events.slice(0, DAY_SHOWN), hidden: day.events.length - DAY_SHOWN };
}

/** Whether a day offers Show more / Show fewer at all. */
export const isBusyDay = (day: ActivityDay) => day.events.length > DAY_COLLAPSE_ABOVE;

// ---- metrics (add-metrics-to-activity) ----

/** The browser's own time zone, which the server counts the per-day metrics in; undefined when it cannot say. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** The per-project panel lists this many before offering Show N more. */
export const REPOS_SHOWN = 6;

export function visibleRepos(repos: readonly ActivityRepoCount[], expanded: boolean): { shown: ActivityRepoCount[]; hidden: number } {
  if (expanded || repos.length <= REPOS_SHOWN) return { shown: [...repos], hidden: 0 };
  return { shown: repos.slice(0, REPOS_SHOWN), hidden: repos.length - REPOS_SHOWN };
}

/** A bar's length as a share of the largest one, in [0, 1]; nothing at all draws nothing. */
export function barShare(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(1, value / max);
}

/** A `YYYY-MM-DD` key as a local date, never as UTC midnight, so it names the same day as the feed's headings. */
const localDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Under a day's bar: `Today`, else its short weekday. */
export function dayLabel(key: string, todayKey: string): string {
  return key === todayKey ? "Today" : localDate(key).toLocaleDateString(undefined, { weekday: "short" });
}

/** A day's full name, for the bar's accessible label. */
export function dayTitle(key: string): string {
  return localDate(key).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

// ---- charts (refactor-metrics-activity) ----

/** The kind groups a chart draws and names in its legend: those the kind filter lets through, always in this order. */
export function chartGroups(groups: readonly ActivityGroup[]): ActivityGroup[] {
  return groups.length === 0 ? [...GROUP_ORDER] : GROUP_ORDER.filter((g) => groups.includes(g));
}

/**
 * A value axis that fits `max`: a clean step (1, 2 or 5 × 10ⁿ) giving at most three intervals, and the ticks from 0 to
 * the top. Nothing at all still gets an axis of one, so an empty week draws a flat baseline, not a division by zero.
 */
export function axisTicks(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const rough = max / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return { top, ticks };
}

/** The heatmap's shading: 0 for no events, else 1–4 by share of the busiest hour (≤¼, ≤½, ≤¾, more). */
export function heatStep(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!(value > 0) || !(max > 0)) return 0;
  const share = value / max;
  return share <= 0.25 ? 1 : share <= 0.5 ? 2 : share <= 0.75 ? 3 : 4;
}

/** The hour of the day (0–23) with the most events across `days`, the earliest on a tie; undefined when there are none. */
export function busiestHour(days: readonly { hours: readonly number[] }[]): number | undefined {
  let best: number | undefined;
  let most = 0;
  for (let h = 0; h < 24; h++) {
    const n = days.reduce((sum, d) => sum + (d.hours[h] ?? 0), 0);
    if (n > most) {
      most = n;
      best = h;
    }
  }
  return best;
}

export const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export type MetricsView = "chart" | "table";
export const ACTIVITY_METRICS_VIEW_KEY = storageKey("activity.metricsView");

/** Chart or table; storage that cannot be read shows the charts. */
export function loadMetricsView(): MetricsView {
  try {
    return localStorage.getItem(ACTIVITY_METRICS_VIEW_KEY) === "table" ? "table" : "chart";
  } catch {
    return "chart";
  }
}

export function saveMetricsView(view: MetricsView): void {
  try {
    if (view === "table") localStorage.setItem(ACTIVITY_METRICS_VIEW_KEY, "table");
    else localStorage.removeItem(ACTIVITY_METRICS_VIEW_KEY);
  } catch {
    // Storage unavailable: the choice lasts until the page reloads.
  }
}

export const ACTIVITY_METRICS_KEY = storageKey("activity.metrics");

/** Whether the user hid the metrics; storage that cannot be read shows them. */
export function loadMetricsHidden(): boolean {
  try {
    return localStorage.getItem(ACTIVITY_METRICS_KEY) === "hidden";
  } catch {
    return false;
  }
}

export function saveMetricsHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(ACTIVITY_METRICS_KEY, "hidden");
    else localStorage.removeItem(ACTIVITY_METRICS_KEY);
  } catch {
    // Storage unavailable: the choice lasts until the page reloads.
  }
}

// ---- unseen ----

export const ACTIVITY_SEEN_KEY = storageKey("activity.seen");

export function loadSeen(): string | undefined {
  try {
    return localStorage.getItem(ACTIVITY_SEEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveSeen(id: string): void {
  try {
    localStorage.setItem(ACTIVITY_SEEN_KEY, id);
  } catch {
    // Storage unavailable: no unseen count, the feed itself works.
  }
}

/** The number next to the navigation entry: nothing for none, capped so it never grows wide. */
export function unseenLabel(count: number | undefined): string {
  if (!count || count < 1) return "";
  return count > 99 ? "99+" : String(count);
}

/**
 * Latest request wins, as in `githubState.ts`: `begin()` numbers a request and supersedes every earlier one,
 * `supersede()` does the same without a request (a filter change), `latest()` reads the current number without
 * superseding (Load older), and `current(n)` says whether an answer to request `n` may still be applied.
 */
export function latestOnly(): { begin: () => number; supersede: () => void; latest: () => number; current: (n: number) => boolean } {
  let seq = 0;
  return {
    begin: () => ++seq,
    supersede: () => {
      seq++;
    },
    latest: () => seq,
    current: (n) => n === seq,
  };
}
