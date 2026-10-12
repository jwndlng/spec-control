// Projects overview: URL state, row derivation and sorting. Pure, shared by the view and its tests.
import { isComplete } from "../shared/columns.ts";
import { type DisplayedLabel, displayedLabels, labelHue, labelKey, type LabelColors } from "../shared/labels.ts";
import type { AutoFetchOutcome, Config, DiscoveredRepo, DiscoverResult, GithubClone, RepoSharedConfig, RepoSnapshot, Snapshot, WorkInProgress, Worktree } from "../shared/types.ts";

/**
 * The snapshot as the config describes it now: only repositories it enables, under the names it gives them. A config
 * change triggers a rescan without waiting for it, if any, so a just-disabled repository would otherwise linger and a
 * rename show only after the next poll.
 */
export function enabledOnly(snapshot: Snapshot | null, config: Config | null): Snapshot | null {
  if (!snapshot || !config) return snapshot;
  const names = new Map(config.repos.filter((r) => r.enabled).map((r) => [r.id, r.name]));
  const repos = snapshot.repos.flatMap((r) => {
    const name = names.get(r.id);
    if (name === undefined) return [];
    return [name === r.name ? r : { ...r, name }];
  });
  return { ...snapshot, repos };
}

export type SortKey = "updated" | "name" | "open" | "archive" | "wip";
export type SortDir = "asc" | "desc";
export type OverviewLayout = "table" | "tiles";

export interface OverviewState {
  sort: SortKey;
  dir: SortDir;
  q: string;
  /** Only repositories with checkouts needing attention. */
  wip: boolean;
  view: OverviewLayout;
  /** Only repositories displaying every one of these labels (ignoring case). Absent when no label is filtered. */
  labels?: string[];
}

export const SORT_KEYS: SortKey[] = ["updated", "name", "open", "archive", "wip"];

/** Newest / biggest first, except names. */
export function naturalDir(sort: SortKey): SortDir {
  return sort === "name" ? "asc" : "desc";
}

export const DEFAULT_OVERVIEW_STATE: OverviewState = { sort: "updated", dir: "desc", q: "", wip: false, view: "table" };

export function parseOverviewState(search: string): OverviewState {
  const p = new URLSearchParams(search);
  const rawSort = p.get("sort") as SortKey | null;
  const sort = rawSort && SORT_KEYS.includes(rawSort) ? rawSort : "updated";
  const rawDir = p.get("dir");
  const dir = rawDir === "asc" || rawDir === "desc" ? rawDir : naturalDir(sort);
  // Anything but `tiles` is the table, so an unknown layout falls back to the default.
  const state: OverviewState = { sort, dir, q: p.get("q") ?? "", wip: p.get("wip") === "1", view: p.get("view") === "tiles" ? "tiles" : "table" };
  const labels = uniqueLabels(p.getAll("label"));
  return labels.length ? { ...state, labels } : state;
}

/** Trimmed, non-empty, each once ignoring case; the first spelling wins. */
function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (!label || seen.has(labelKey(label))) continue;
    seen.add(labelKey(label));
    out.push(label);
  }
  return out;
}

/** Adds a label to the filter, or removes it when it is already there (ignoring case). */
export function toggleLabel(state: OverviewState, label: string): OverviewState {
  const current = state.labels ?? [];
  const active = current.some((l) => labelKey(l) === labelKey(label));
  const labels = active ? current.filter((l) => labelKey(l) !== labelKey(label)) : [...current, label];
  const { labels: _old, ...rest } = state;
  return labels.length ? { ...rest, labels } : rest;
}

export function isLabelActive(state: OverviewState, label: string): boolean {
  return (state.labels ?? []).some((l) => labelKey(l) === labelKey(label));
}

/** Defaults are omitted so a plain `/` stays a plain `/`. */
export function serializeOverviewState(s: OverviewState): string {
  const p = new URLSearchParams();
  if (s.sort !== "updated") p.set("sort", s.sort);
  if (s.dir !== naturalDir(s.sort)) p.set("dir", s.dir);
  if (s.q) p.set("q", s.q);
  if (s.wip) p.set("wip", "1");
  if (s.view !== "table") p.set("view", s.view);
  for (const label of s.labels ?? []) p.append("label", label);
  const out = p.toString();
  return out ? `?${out}` : "";
}

/** Activating the active header flips direction; a new header starts in its natural direction. */
export function toggleSort(state: OverviewState, key: SortKey): OverviewState {
  if (state.sort === key) return { ...state, dir: state.dir === "asc" ? "desc" : "asc" };
  return { ...state, sort: key, dir: naturalDir(key) };
}

export interface OverviewRow {
  id: string;
  name: string;
  path: string;
  /** Set only when another row has the same name: the shortest part of the parent directory that tells them apart. */
  hint?: string;
  ok: boolean;
  error?: string;
  open: number;
  toArchive: number;
  archived: number;
  lastUpdatedAt?: string;
  sharedConfig?: RepoSharedConfig;
  isGit: boolean;
  currentBranch?: string;
  defaultBranch?: string;
  onDefaultBranch?: boolean;
  /** Absent for non-git repositories and until the first scan after an upgrade. */
  workInProgress?: WorkInProgress;
  /** Every checkout of the repository, the main one included. */
  worktrees: Worktree[];
  /** Whether it can be fetched, when it last was, and its last automatic fetch: the note beside Pull. */
  hasRemote?: boolean;
  lastFetchedAt?: string;
  autoFetch?: AutoFetchOutcome;
  /** Custom labels from the config, then detected ones (`displayedLabels`). */
  labels: DisplayedLabel[];
}

/** Checkouts needing attention: uncommitted plus unpushed plus stale. 0 without a summary. */
export function attentionCount(row: Pick<OverviewRow, "workInProgress">): number {
  const s = row.workInProgress;
  return s ? s.uncommitted + s.unpushed + s.stale : 0;
}

export interface WipIndicator {
  /** Non-zero parts in the order worktrees, uncommitted, unpushed, stale. */
  parts: string[];
  text: string;
  /** Something is uncommitted, unpushed or stale; otherwise there are only clean worktrees. */
  warn: boolean;
}

/** The overview's work-in-progress indicator, or undefined when there is nothing to say (clean repository, or no summary). */
export function wipIndicator(summary: WorkInProgress | undefined): WipIndicator | undefined {
  if (!summary) return undefined;
  const parts: string[] = [];
  if (summary.worktrees > 0) parts.push(`${summary.worktrees} ${summary.worktrees === 1 ? "worktree" : "worktrees"}`);
  if (summary.uncommitted > 0) parts.push(`${summary.uncommitted} uncommitted`);
  if (summary.unpushed > 0) parts.push(`${summary.unpushed} unpushed`);
  if (summary.stale > 0) parts.push(`${summary.stale} stale`);
  if (parts.length === 0) return undefined;
  return { parts, text: parts.join(" · "), warn: summary.uncommitted + summary.unpushed + summary.stale > 0 };
}

function newestActivity(repo: RepoSnapshot): string | undefined {
  let best: string | undefined;
  for (const c of repo.changes) {
    if (c.lastActivityAt && (!best || Date.parse(c.lastActivityAt) > Date.parse(best))) best = c.lastActivityAt;
  }
  return best;
}

/** Parent-directory segments of a path, nearest first. */
function parentSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean).slice(0, -1).reverse();
}

/** Anything listed on the overview with a name and a path: rows, pending rows and untracked entries. */
interface Hinted {
  name: string;
  path: string;
  hint?: string;
}

/** For entries sharing a name: the shortest trailing run of parent segments that is unique within the group. */
function addHints(rows: Hinted[]): void {
  const groups = new Map<string, Hinted[]>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const parents = group.map((r) => parentSegments(r.path));
    const deepest = Math.max(1, ...parents.map((p) => p.length));
    const suffix = (segments: string[], depth: number) => segments.slice(0, depth).reverse().join("/");
    for (const [i, row] of group.entries()) {
      let depth = 1;
      while (depth < deepest && parents.some((other, j) => j !== i && suffix(other, depth) === suffix(parents[i], depth))) depth++;
      row.hint = suffix(parents[i], depth) || row.path;
    }
  }
}

export function overviewRows(snapshot: Snapshot, config?: Config | null): OverviewRow[] {
  const configured = new Map((config?.repos ?? []).map((r) => [r.id, r]));
  const rows = snapshot.repos.map((repo): OverviewRow => {
    let open = 0;
    let toArchive = 0;
    let archived = 0;
    for (const c of repo.changes) {
      if (c.archived) {
        archived++;
        continue;
      }
      open++;
      if (isComplete(c.stage)) toArchive++;
    }
    return {
      id: repo.id,
      name: repo.name,
      path: repo.path,
      ok: repo.ok,
      error: repo.error,
      open,
      toArchive,
      archived,
      // Snapshots cached by older versions, and repos that never scanned cleanly, have no repo-level date.
      lastUpdatedAt: repo.lastUpdatedAt ?? newestActivity(repo),
      sharedConfig: repo.sharedConfig,
      workInProgress: repo.workInProgress,
      worktrees: repo.worktrees,
      hasRemote: repo.hasRemote,
      lastFetchedAt: repo.lastFetchedAt,
      autoFetch: repo.autoFetch,
      isGit: repo.isGit,
      currentBranch: repo.currentBranch,
      defaultBranch: repo.defaultBranch,
      onDefaultBranch: repo.onDefaultBranch,
      labels: displayedLabels(configured.get(repo.id), repo.detectedLabels, config?.labelColors),
    };
  });
  addHints(rows);
  return rows;
}

const byName = (a: OverviewRow, b: OverviewRow) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export function sortRows(rows: OverviewRow[], sort: SortKey, dir: SortDir): OverviewRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const time = (r: OverviewRow) => (r.lastUpdatedAt ? Date.parse(r.lastUpdatedAt) : Number.NaN);
  return [...rows].sort((a, b) => {
    if (sort === "name") return sign * byName(a, b);
    if (sort === "updated") {
      const [ta, tb] = [time(a), time(b)];
      // Undated repos go last whichever way the column is sorted.
      if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) === Number.isNaN(tb) ? byName(a, b) : Number.isNaN(ta) ? 1 : -1;
      return sign * (ta - tb) || byName(a, b);
    }
    const value = (r: OverviewRow) => (sort === "open" ? r.open : sort === "archive" ? r.toArchive : attentionCount(r));
    return sign * (value(a) - value(b)) || byName(a, b);
  });
}

/** A repository enabled in the config that the snapshot does not hold yet: it was enabled a moment ago. */
export interface PendingRow {
  id: string;
  name: string;
  path: string;
  hint?: string;
}

/** Enabled repositories the scan has not reached yet, by name. None while the snapshot is still loading. */
export function pendingRows(config: Config | null, snapshot: Snapshot | null): PendingRow[] {
  if (!config || !snapshot) return [];
  const scanned = new Set(snapshot.repos.map((r) => r.id));
  return config.repos
    .filter((r) => r.enabled && !scanned.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, path: r.path }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path));
}

/** What an unmanaged project is, which decides the actions it is offered. */
export type UntrackedKind = "disabled" | "discovered" | "integratable" | "clone";

export interface UntrackedEntry {
  kind: UntrackedKind;
  id: string;
  name: string;
  path: string;
  hint?: string;
  /** Discovered entries only: other known repositories with the same `origin`. */
  sameRemoteAs?: DiscoveredRepo["sameRemoteAs"];
  /** Clone entries only: the clone as the clone list reports it. */
  clone?: GithubClone;
}

/**
 * The overview's unmanaged projects: disabled repositories from the config and the latest discovery's candidates and
 * repositories without OpenSpec — minus anything the config already holds, which covers the moment between an Enable
 * and the next discovery result. One list, by name, then path, whatever each entry is.
 */
export function untrackedEntries(config: Config | null, discover: DiscoverResult | undefined, clones: readonly GithubClone[] = []): UntrackedEntry[] {
  const configured = new Set(config?.repos.map((r) => r.id));
  const entries: UntrackedEntry[] = [
    ...(config?.repos ?? []).filter((r) => !r.enabled).map((r): UntrackedEntry => ({ kind: "disabled", id: r.id, name: r.name, path: r.path })),
    ...(discover?.candidates ?? [])
      .filter((c) => !configured.has(c.id))
      .map((c): UntrackedEntry => ({ kind: "discovered", id: c.id, name: c.name, path: c.path, sameRemoteAs: c.sameRemoteAs })),
    ...(discover?.integratable ?? [])
      .filter((r) => !configured.has(r.id))
      .map((r): UntrackedEntry => ({ kind: "integratable", id: r.id, name: r.name, path: r.path })),
    // Queued, running, failed and cancelled clones; a finished one is a repository like any other, found by discovery or tracked.
    ...clones
      .filter((c) => c.state !== "tracked" && c.state !== "integratable")
      .map((c): UntrackedEntry => ({ kind: "clone", id: c.id, name: c.name, path: c.path, clone: c })),
  ];
  return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path));
}

/**
 * Path hints across everything on the overview — a tracked row, a pending row and a discovered entry with the same name
 * must tell each other apart too. Replaces the hints `overviewRows` computed among the rows alone.
 */
export function hintAcross(...lists: Hinted[][]): void {
  const all = lists.flat();
  for (const entry of all) entry.hint = undefined;
  addHints(all);
}

/** The overview's search over anything with a name and a hint: the same rule as for rows. */
export function matchesSearch(entry: Pick<Hinted, "name" | "hint">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || entry.name.toLowerCase().includes(needle) || (entry.hint?.toLowerCase().includes(needle) ?? false);
}

/** Whether the row displays every one of the labels, ignoring case. */
export function hasLabels(row: Pick<OverviewRow, "labels">, labels: string[] = []): boolean {
  const own = new Set(row.labels.map((l) => labelKey(l.label)));
  return labels.every((l) => own.has(labelKey(l)));
}

/** Search, the work-in-progress filter and the label filter combine. */
export function filterRows(rows: OverviewRow[], q: string, wip = false, labels: string[] = []): OverviewRow[] {
  return rows.filter((r) => (!wip || attentionCount(r) > 0) && hasLabels(r, labels) && matchesSearch(r, q));
}

export interface LabelOption {
  label: string;
  /** Repositories displaying it. 0 for an active label from the URL that no repository displays. */
  count: number;
  /** The label's colour, the same as on every row and tile that displays it. */
  hue: number;
}

/** The label filter's choices: every label any row displays, each once ignoring case, plus active labels nothing displays. */
export function labelOptions(rows: OverviewRow[], active: string[] = [], colors?: LabelColors): LabelOption[] {
  const options = new Map<string, LabelOption>();
  for (const row of rows) {
    for (const key of new Set(row.labels.map((l) => labelKey(l.label)))) {
      const shown = row.labels.find((l) => labelKey(l.label) === key);
      const seen = options.get(key);
      options.set(key, { label: seen?.label ?? shown?.label ?? key, count: (seen?.count ?? 0) + 1, hue: seen?.hue ?? shown?.hue ?? labelHue(key, colors) });
    }
  }
  for (const label of active) if (!options.has(labelKey(label))) options.set(labelKey(label), { label, count: 0, hue: labelHue(label, colors) });
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/** How many labels a table row shows before the rest moves into a `+<n>` indicator. */
export const ROW_LABEL_LIMIT = 3;

/** A tile's monogram: the initials of up to two words of the repository name (`atlas-api` → `AA`, `docs` → `D`). */
export function monogram(name: string): string {
  const words = name.split(/[-_.\s/]+/).filter(Boolean);
  return (words.length ? words.slice(0, 2).map((w) => w[0]) : ["?"]).join("").toUpperCase();
}

export interface CheckoutSummary {
  /** Linked worktrees; the main checkout is not a worktree. */
  worktrees: number;
  /** Distinct branches checked out anywhere, main checkout included; detached and bare entries have none. */
  branches: number;
  text: string;
  /** One line per checkout, for the tooltip: where the details went when the tile stopped listing them. */
  detail: string;
}

/** A tile's checkout line: `3 worktrees · 4 branches active` instead of one chip per checkout. */
export function checkoutSummary(worktrees: Worktree[]): CheckoutSummary {
  const linked = worktrees.filter((w) => !w.isMain && !w.bare);
  const branches = new Set(worktrees.filter((w) => !w.bare && !w.detached && w.branch).map((w) => w.branch as string));
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const text = `${plural(linked.length, "worktree", "worktrees")} · ${plural(branches.size, "branch", "branches")} active`;
  const detail = worktrees
    .filter((w) => !w.bare)
    .map((w) => `${w.branch ?? `detached @ ${w.head ?? "?"}`} — ${w.isMain ? "main checkout" : w.prunable ? "stale worktree" : "worktree"}`)
    .join("\n");
  return { worktrees: linked.length, branches: branches.size, text, detail };
}
