// A change can exist in several checkouts of one repository: a proposal merged to main, the implementation progressing
// in a linked worktree, stale copies on branches cut earlier. The board shows one card per change; these pure functions
// decide which copy that card is.
import type { ChangeCheckout, ChangeSnapshot, Stage } from "../shared/types.ts";

/** One checkout's view of a change. */
export interface ChangeCopy {
  change: ChangeSnapshot;
  checkout: ChangeCheckout;
}

const STAGE_RANK: Record<Stage, number> = { unknown: 0, backlog: 1, drafts: 2, ready: 3, implementing: 4, done: 5, archived: 6 };

/** The record of a merged change: the leading copy's, else the main checkout's copy's — it is on a branch until it merges. */
function mergedRecord(lead: ChangeCopy, copies: readonly ChangeCopy[]): Pick<ChangeSnapshot, "recorded"> {
  const recorded = lead.change.recorded ?? copies.find((c) => c.checkout.isMain)?.change.recorded;
  return recorded ? { recorded } : {};
}

const instant = (iso: string | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? Date.parse(iso) : 0);

function sameProgress(a: ChangeCopy, b: ChangeCopy): boolean {
  const done = (c: ChangeCopy) => c.change.artifacts.filter((x) => x.status === "done").length;
  return a.change.column === b.change.column && done(a) === done(b) && (a.change.tasks?.done ?? 0) === (b.change.tasks?.done ?? 0) && (a.change.tasks?.total ?? 0) === (b.change.tasks?.total ?? 0);
}

/** Sort key, best first: furthest along, then most progress, then most recent, then main, then path. */
function compareCopies(a: ChangeCopy, b: ChangeCopy): number {
  const done = (c: ChangeCopy) => c.change.artifacts.filter((x) => x.status === "done").length;
  return (
    STAGE_RANK[b.change.stage] - STAGE_RANK[a.change.stage] ||
    done(b) - done(a) ||
    (b.change.tasks?.done ?? 0) - (a.change.tasks?.done ?? 0) ||
    instant(b.change.lastActivityAt) - instant(a.change.lastActivityAt) ||
    Number(b.checkout.isMain) - Number(a.checkout.isMain) ||
    a.checkout.path.localeCompare(b.checkout.path)
  );
}

/**
 * The copy a card shows. "Furthest along" rather than "most recent": a rebase touches a stale copy without advancing
 * it, so progress is the better signal and recency only breaks ties. Total and independent of input order.
 */
export function leadingCopy(copies: ChangeCopy[]): ChangeCopy {
  return [...copies].sort(compareCopies)[0];
}

/**
 * The main checkout's own active copies of changes it has also archived. Git moves only what it tracks, so an
 * uncommitted change directory stays behind when its archive arrives by a merge — a leftover, not a change of its own.
 * Such a copy (not created after the archive) is removed from `mainCopies` and listed among the other checkouts of the
 * newest archive of its name, with its column; a copy created later is a new change reusing the name and is kept.
 * `archived` is newest first, as `listChanges` returns it. Runs for repositories without git too.
 */
export function foldLeftovers(mainCopies: ChangeCopy[], archived: ChangeSnapshot[]): { copies: ChangeCopy[]; archived: ChangeSnapshot[] } {
  const newest = new Map<string, number>();
  for (const [i, change] of archived.entries()) if (change.archived && !newest.has(change.name)) newest.set(change.name, i);
  const leftovers = new Map<number, ChangeCopy[]>();
  const copies: ChangeCopy[] = [];
  for (const copy of mainCopies) {
    const i = newest.get(copy.change.name);
    if (i === undefined || (copy.change.created ?? "") > (archived[i].archived ?? "")) copies.push(copy);
    else leftovers.set(i, [...(leftovers.get(i) ?? []), copy]);
  }
  const folded = archived.map((change, i) => {
    const left = leftovers.get(i);
    if (!left) return change;
    return { ...change, otherCheckouts: [...(change.otherCheckouts ?? []), ...left.map((o) => ({ ...o.checkout, column: o.change.column }))] };
  });
  return { copies, archived: folded };
}

/**
 * One change per name from the active copies of every checkout. `archivedOnMain` maps a change name to the date it was
 * archived in the main checkout: a worktree copy of such a change is a leftover on a branch cut before the archive and
 * is dropped — unless it was created after the archive, which makes it a new change reusing the name.
 *
 * `pending` are archives found only in linked worktrees (the main checkout does not have them yet). Archived is the
 * furthest stage there is, so such an archive leads: the change is reported once, as archived, from that worktree, and
 * the active copies that still exist — usually a main checkout that has not been updated — become its other checkouts.
 * The same name-reuse exception applies.
 */
export function mergeChanges(copies: ChangeCopy[], archivedOnMain: Map<string, string>, pending: ChangeCopy[] = []): ChangeSnapshot[] {
  const pendingByName = new Map<string, ChangeCopy>();
  const byDateThenPath = (a: ChangeCopy, b: ChangeCopy) => (b.change.archived ?? "").localeCompare(a.change.archived ?? "") || a.checkout.path.localeCompare(b.checkout.path);
  for (const copy of [...pending].sort(byDateThenPath)) if (!pendingByName.has(copy.change.name)) pendingByName.set(copy.change.name, copy);

  const byName = new Map<string, ChangeCopy[]>();
  const superseded = new Map<string, ChangeCopy[]>();
  for (const copy of copies) {
    const name = copy.change.name;
    const archived = archivedOnMain.get(name);
    if (!copy.checkout.isMain && archived !== undefined && !((copy.change.created ?? "") > archived)) continue;
    const archivedElsewhere = pendingByName.get(name)?.change.archived;
    const target = archivedElsewhere !== undefined && !((copy.change.created ?? "") > archivedElsewhere) ? superseded : byName;
    target.set(name, [...(target.get(name) ?? []), copy]);
  }
  const archivedInWorktrees = [...pendingByName.values()].map((lead): ChangeSnapshot => {
    const others = [...(superseded.get(lead.change.name) ?? [])].sort(compareCopies);
    return { ...lead.change, ...mergedRecord(lead, others), checkout: lead.checkout, otherCheckouts: others.length ? others.map((o) => ({ ...o.checkout, column: o.change.column })) : undefined };
  });
  const active = [...byName.values()].map((group) => {
    const sorted = [...group].sort(compareCopies);
    const [lead, ...rest] = sorted;
    // Every branch carries main's committed changes along, so most worktrees hold a copy that says nothing new.
    // Only copies whose progress differs from the main checkout's are worth mentioning.
    const main = group.find((c) => c.checkout.isMain);
    const others = rest.filter((c) => c.checkout.isMain || !main || !sameProgress(c, main));
    return {
      ...lead.change,
      ...mergedRecord(lead, group),
      // A change found in a linked worktree is on that worktree's branch; no guessing from names needed.
      branchMatch: lead.checkout.isMain ? lead.change.branchMatch : lead.checkout.branch,
      checkout: lead.checkout,
      otherCheckouts: others.length ? others.map((o) => ({ ...o.checkout, column: o.change.column })) : undefined,
    };
  });
  return [...active, ...archivedInWorktrees];
}
