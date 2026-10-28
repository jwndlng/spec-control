// Change dependencies (`depends-on.yaml`): which changes wait for which, derived from one repository's merged changes.
// Pure, so the scanner, the demo and the tests share one answer — the server refuses Implement on exactly this.
import { type ChangeDependency, type ChangeSnapshot, type DependencyState, STAGE_COLUMN } from "./types.ts";

/**
 * Whether the main checkout holds this copy archived or in `Done`: "implemented and merged" as of the user's last
 * pull. A change without `checkout` is a non-git folder or an archive read from the main checkout, so it is main.
 */
function onMainAsFinished(change: ChangeSnapshot): boolean {
  const leaderIsMain = change.checkout?.isMain !== false;
  if (leaderIsMain) return change.archived !== undefined || change.stage === "done";
  // A pending archive or a copy leading on a branch: what counts is the main checkout's own copy.
  return change.otherCheckouts?.some((o) => o.isMain && o.column === STAGE_COLUMN.done) ?? false;
}

/** `depends-on.yaml` existed but held nothing usable; the scanner marks that as blocked without a list. */
function unreadable(change: ChangeSnapshot): boolean {
  return change.blocked === true && !change.dependsOn?.length;
}

/**
 * Resolves every declared dependency to its state (`met` → `cycle` → `missing` → `waiting`), sets `blocked`, fills
 * `requiredBy` and adds a warning for each `missing` dependency and cycle. Only edges to unmet dependencies can form
 * a cycle, so a finished change never manufactures one. Changes with neither dependencies nor dependents are returned
 * as the very same objects; archived changes are never blocked.
 */
export function resolveDependencies(changes: ChangeSnapshot[]): ChangeSnapshot[] {
  const byName = new Map<string, ChangeSnapshot[]>();
  for (const change of changes) byName.set(change.name, [...(byName.get(change.name) ?? []), change]);
  /**
   * An active change of the name is the one waited for: an archive dated before its creation belongs to an earlier
   * change that reused the name (the rule `foldLeftovers` and `mergeChanges` tell a leftover from a new change by).
   */
  const met = (name: string) => {
    const copies = byName.get(name) ?? [];
    const active = copies.find((c) => !c.archived);
    if (!active) return copies.some(onMainAsFinished);
    if (onMainAsFinished(active)) return true;
    const created = active.created;
    return created !== undefined && copies.some((c) => c.archived !== undefined && c.archived >= created && onMainAsFinished(c));
  };

  const declaring = changes.filter((c) => !c.archived && (c.dependsOn?.length || unreadable(c)));
  if (declaring.length === 0 && !changes.some((c) => c.dependsOn || c.requiredBy || c.blocked)) return changes;

  // Unmet edges between active changes: the graph a cycle can live in.
  const edges = new Map<string, string[]>();
  for (const change of declaring) {
    const targets = (change.dependsOn ?? []).map((d) => d.name).filter((name) => !met(name) && byName.get(name)?.some((c) => !c.archived));
    edges.set(change.name, [...(edges.get(change.name) ?? []), ...targets]);
  }
  /** The path `from → … → to` along unmet edges, or undefined. Breadth-first, so the reported cycle is a shortest one. */
  const pathBetween = (from: string, to: string): string[] | undefined => {
    const parent = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const at = queue.shift() as string;
      if (at === to) {
        const path: string[] = [];
        for (let n: string | null = at; n !== null; n = parent.get(n) ?? null) path.unshift(n);
        return path;
      }
      for (const next of edges.get(at) ?? []) {
        if (!parent.has(next)) {
          parent.set(next, at);
          queue.push(next);
        }
      }
    }
    return undefined;
  };

  const requiredBy = new Map<string, Set<string>>();
  const resolved = new Map<ChangeSnapshot, { dependsOn?: ChangeDependency[]; blocked: boolean; warnings: string[] }>();
  for (const change of declaring) {
    const warnings: string[] = [];
    const dependsOn = change.dependsOn?.map(({ name }): ChangeDependency => {
      requiredBy.set(name, (requiredBy.get(name) ?? new Set()).add(change.name));
      let state: DependencyState;
      const cycle = name === change.name ? [name, name] : met(name) ? undefined : pathBetween(name, change.name);
      if (cycle) {
        state = "cycle";
        warnings.push(`dependency cycle: ${[change.name, ...cycle.slice(name === change.name ? 1 : 0)].join(" → ")}`);
      } else if (met(name)) state = "met";
      else if (!byName.has(name)) {
        state = "missing";
        warnings.push(`depends on "${name}", but no change of that name exists`);
      } else state = "waiting";
      return { name, state };
    });
    resolved.set(change, { dependsOn, blocked: unreadable(change) || (dependsOn ?? []).some((d) => d.state !== "met"), warnings });
  }

  return changes.map((change) => {
    const own = resolved.get(change);
    const dependents = requiredBy.get(change.name);
    if (!own && !dependents && !change.dependsOn && !change.requiredBy && !change.blocked) return change;
    const { dependsOn: _d, requiredBy: _r, blocked: _b, ...rest } = change;
    const next: ChangeSnapshot = { ...rest };
    if (own?.dependsOn?.length) next.dependsOn = own.dependsOn;
    if (dependents) next.requiredBy = [...dependents].sort();
    if (own?.blocked) next.blocked = true;
    if (own?.warnings.length) next.warnings = [...new Set([...(change.warnings ?? []), ...own.warnings])];
    return next;
  });
}

/**
 * Why **Implement** — or **Fast-forward**, which implements too — is withheld from a blocked change, naming every
 * unmet dependency; undefined when it is not.
 */
export function blockedReason(change: Pick<ChangeSnapshot, "blocked" | "dependsOn">, starter: "Implement" | "Fast-forward" = "Implement"): string | undefined {
  if (!change.blocked) return undefined;
  const unmet = (change.dependsOn ?? []).filter((d) => d.state !== "met");
  if (unmet.length === 0) return `${starter} is held back: depends-on.yaml could not be read`;
  return `${starter} is held back: waits for ${unmet.map((d) => `${d.name} (${d.state})`).join(", ")}`;
}

/**
 * The card's "waits for" note: shown where **Implement** would be, for a blocked change in `Ready` or `Implementing`.
 * `label` names the first unmet dependency and how many others; `title` lists each with its state.
 */
export function waitingNote(change: Pick<ChangeSnapshot, "blocked" | "dependsOn" | "stage" | "archived">): { label: string; title: string } | undefined {
  if (!change.blocked || change.archived || (change.stage !== "ready" && change.stage !== "implementing")) return undefined;
  const unmet = (change.dependsOn ?? []).filter((d) => d.state !== "met");
  if (unmet.length === 0) return { label: "waits: depends-on.yaml unreadable", title: "depends-on.yaml could not be read — Implement is held back until it is fixed" };
  const more = unmet.length > 1 ? ` +${unmet.length - 1}` : "";
  return { label: `waits for ${unmet[0].name}${more}`, title: `Implement is held back until these are done or archived in the main checkout: ${unmet.map((d) => `${d.name} — ${d.state}`).join(", ")}` };
}
