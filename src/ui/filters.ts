// Board filters live in the URL query string so a reload keeps them.
/**
 * How the board lays its columns out: side by side as lanes, or stacked as full-width sections for a narrow window.
 * `auto` follows the window's width. Not a filter: it changes no card, and clearing the filters keeps it.
 */
export type BoardLayout = "auto" | "lanes" | "stack";

export interface Filters {
  repos: string[];
  q: string;
  /** Keep only changes with activity within this many days; 0 is off. */
  activeDays: number;
  hideArchived: boolean;
  /** Keep only archived changes that still have to be pushed or merged. On by default: only `merged=1` turns it off. */
  hideMerged: boolean;
  layout: BoardLayout;
}

export const EMPTY_FILTERS: Filters = { repos: [], q: "", activeDays: 0, hideArchived: false, hideMerged: true, layout: "auto" };

/** Below this window width, `auto` stacks the columns. */
export const STACK_BELOW_PX = 1280;

/** The layout on screen: an explicit choice, or for `auto` the one that fits the window. */
export function resolveLayout(layout: BoardLayout, narrow: boolean): "lanes" | "stack" {
  return layout === "auto" ? (narrow ? "stack" : "lanes") : layout;
}

export function parseFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  // The former `stale` parameter meant the opposite and is deliberately not read.
  const active = Number(p.get("active") ?? 0);
  return {
    repos: (p.get("repos") ?? "").split(",").filter(Boolean),
    q: p.get("q") ?? "",
    activeDays: Number.isFinite(active) && active > 0 ? Math.floor(active) : 0,
    hideArchived: p.get("archived") === "0",
    hideMerged: p.get("merged") !== "1",
    layout: p.get("layout") === "lanes" || p.get("layout") === "stack" ? (p.get("layout") as BoardLayout) : "auto",
  };
}

export function serializeFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.repos.length) p.set("repos", f.repos.join(","));
  if (f.q) p.set("q", f.q);
  if (f.activeDays > 0) p.set("active", String(f.activeDays));
  if (f.hideArchived) p.set("archived", "0");
  if (!f.hideMerged) p.set("merged", "1");
  if (f.layout !== "auto") p.set("layout", f.layout);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The recent-activity thresholds the Activity selector offers besides "Any time". */
export const ACTIVITY_PRESETS = [7, 14, 30, 90];

export function activityLabel(days: number): string {
  return days > 0 ? `Last ${days} days` : "Any time";
}

/** The Activity selector's options: any time, the presets, and the current threshold when the URL holds another one. */
export function activityOptions(current: number): { value: number; label: string }[] {
  const days = [...new Set([...ACTIVITY_PRESETS, ...(current > 0 ? [current] : [])])].sort((a, b) => a - b);
  return [0, ...days].map((value) => ({ value, label: activityLabel(value) }));
}

export interface FilterTag {
  key: string;
  label: string;
  /** Set for a repository tag, so it can wear that repository's colour. */
  repoId?: string;
  /** What removing the tag changes. */
  clear: Partial<Filters>;
}

/**
 * The removable tags of the filter bar: each selected repository, in the board's repository order, and the
 * recent-activity threshold. The search stays in its own field and is not repeated as a tag.
 */
export function activeTags(filters: Filters, repos: { id: string; name: string }[]): FilterTag[] {
  const tags: FilterTag[] = repos
    .filter((r) => filters.repos.includes(r.id))
    .map((r) => ({ key: `repo:${r.id}`, label: r.name, repoId: r.id, clear: { repos: filters.repos.filter((id) => id !== r.id) } }));
  if (filters.activeDays > 0) tags.push({ key: "active", label: activityLabel(filters.activeDays), clear: { activeDays: 0 } });
  return tags;
}

/** Whether any filter differs from the defaults. */
export function hasActiveFilters(f: Filters): boolean {
  return f.q !== "" || f.repos.length > 0 || f.activeDays > 0 || f.hideArchived || !f.hideMerged;
}
