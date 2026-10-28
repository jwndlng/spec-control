// Pure helpers for the shared-config settings UI: profile ids, the assignment grid and what is pending.
import type { RepoSharedConfig, SharedConfigAssignment, SharedConfigPreview, SharedProfile } from "../shared/types.ts";

/** A profile id from a display name: lower-case slug, unique among `taken`. */
export function profileIdFrom(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "profile";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

export interface GridRow {
  repoId: string;
  name: string;
  /** Undefined until the repository has been scanned with profiles present. */
  current?: RepoSharedConfig;
  /** Profile ids ticked in the grid. */
  selected: string[];
}

/** What the file carries now, restricted to profiles that still exist: the grid's starting point. */
export function carriedIds(current: RepoSharedConfig | undefined, profiles: SharedProfile[]): string[] {
  const known = new Set(profiles.map((p) => p.id));
  return (current?.applied ?? []).map((p) => p.id).filter((id) => known.has(id));
}

/**
 * A row needs an apply when the ticked set differs from what the file carries, or when the file carries something
 * stale: an outdated profile that stays ticked, or sections of a profile that no longer exists.
 */
export function isPending(row: GridRow, profiles: SharedProfile[]): boolean {
  if (!row.current || row.current.unreadable) return false;
  const carried = carriedIds(row.current, profiles);
  const selected = profiles.map((p) => p.id).filter((id) => row.selected.includes(id));
  if (carried.length !== selected.length || carried.some((id, i) => id !== selected[i])) return true;
  return row.current.applied.some((p) => p.state === "orphaned" || (p.state === "outdated" && selected.includes(p.id)));
}

export function pendingAssignments(rows: GridRow[], profiles: SharedProfile[]): SharedConfigAssignment[] {
  return rows.filter((row) => isPending(row, profiles)).map((row) => ({ repoId: row.repoId, profileIds: profiles.map((p) => p.id).filter((id) => row.selected.includes(id)) }));
}

/**
 * What Apply sends: exactly the assignments the preview was produced for, each with its preview's digest, so the server
 * writes only what was shown. Repositories the preview refused are left out; the live grid is never consulted.
 */
export function withDigests(assignments: SharedConfigAssignment[], previews: SharedConfigPreview[]): SharedConfigAssignment[] {
  const byRepo = new Map(previews.map((p) => [p.repoId, p]));
  return assignments.flatMap((a) => {
    const preview = byRepo.get(a.repoId);
    return preview && !preview.refusal ? [{ repoId: a.repoId, profileIds: a.profileIds, digest: preview.digest }] : [];
  });
}

/** One-line summary for the overview and tooltips; undefined when there is nothing to say. */
export function summarize(current: RepoSharedConfig | undefined, profiles: { id: string; name: string }[]): { text: string; level: "ok" | "warning" | "danger" } | undefined {
  if (!current) return undefined;
  if (current.unreadable) return { text: "config unreadable", level: "danger" };
  if (current.applied.length === 0) return undefined;
  const name = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;
  const stale = current.applied.filter((p) => p.state !== "in-sync");
  const text = current.applied.map((p) => (p.state === "in-sync" ? name(p.id) : `${name(p.id)} (${p.state})`)).join(", ");
  return { text, level: stale.length ? "warning" : "ok" };
}
