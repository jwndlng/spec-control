// The repository board header's project switcher (project-overview: "The repository board header switches between
// projects"): which projects it lists and what its search leaves. Pure, so it is tested without a DOM.
import { nameHints } from "../shared/nameHints.ts";
import type { RepoSnapshot } from "../shared/types.ts";

export interface SwitchEntry {
  id: string;
  name: string;
  path: string;
  /** The overview's path hint, only for a name another listed project shares. */
  hint?: string;
  current: boolean;
  /** The last scan failed; the project is listed anyway. */
  failed: boolean;
}

/** Every project of the snapshot, by name ignoring case (then path), the one on screen marked as current. */
export function switchEntries(repos: Pick<RepoSnapshot, "id" | "name" | "path" | "ok">[], currentId: string): SwitchEntry[] {
  const hints = nameHints(repos);
  return repos
    .map((r): SwitchEntry => ({ id: r.id, name: r.name, path: r.path, hint: hints.get(r.id), current: r.id === currentId, failed: !r.ok }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path));
}

/** The entries whose name or hint contains `q`, ignoring case; all of them for an empty search. */
export function filterEntries(entries: SwitchEntry[], q: string): SwitchEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(needle) || (e.hint?.toLowerCase().includes(needle) ?? false));
}
