// What the cleanup dialog selects and says, kept free of Preact so it can be tested without a DOM.
import type { CleanupItemResult, CleanupPreview, CleanupSelection } from "../shared/types.ts";

export interface Selected {
  worktrees: Set<string>;
  prune: boolean;
  branches: Set<string>;
}

/** Everything removable starts selected: the dialog exists to remove it, and the user deselects what to keep. */
export function initialSelection(preview: CleanupPreview): Selected {
  return {
    worktrees: new Set(preview.worktrees.filter((w) => w.removable).map((w) => w.path)),
    prune: preview.prunable.length > 0,
    branches: new Set(preview.branches.filter((b) => b.removable).map((b) => b.name)),
  };
}

/** Deselecting a worktree deselects the branch checked out in it: git cannot delete a branch a worktree still holds. */
export function toggleWorktree(preview: CleanupPreview, selected: Selected, path: string, on: boolean): Selected {
  const worktrees = new Set(selected.worktrees);
  const branches = new Set(selected.branches);
  if (on) worktrees.add(path);
  else {
    worktrees.delete(path);
    for (const b of preview.branches) if (b.worktreePath === path) branches.delete(b.name);
  }
  return { ...selected, worktrees, branches };
}

/** Selecting a branch that a removable worktree holds selects that worktree too. */
export function toggleBranch(preview: CleanupPreview, selected: Selected, name: string, on: boolean): Selected {
  const worktrees = new Set(selected.worktrees);
  const branches = new Set(selected.branches);
  if (on) {
    branches.add(name);
    const holder = preview.branches.find((b) => b.name === name)?.worktreePath;
    if (holder) worktrees.add(holder);
  } else branches.delete(name);
  const needsPrune = on && preview.branches.some((b) => b.name === name && b.prunePath);
  return { ...selected, worktrees, branches, prune: selected.prune || needsPrune };
}

/** A stale record must go before its branch can be deleted. */
export function togglePrune(preview: CleanupPreview, selected: Selected, on: boolean): Selected {
  const branches = new Set(selected.branches);
  if (!on) for (const b of preview.branches) if (b.prunePath) branches.delete(b.name);
  return { ...selected, prune: on, branches };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Names what confirming will do, e.g. `Remove 2 worktrees, prune 1 record, delete 3 branches`; empty when nothing is selected. */
export function confirmLabel(preview: CleanupPreview, selected: Selected): string {
  const parts: string[] = [];
  if (selected.worktrees.size) parts.push(`remove ${plural(selected.worktrees.size, "worktree", "worktrees")}`);
  if (selected.prune && preview.prunable.length) parts.push(`prune ${plural(preview.prunable.length, "record", "records")}`);
  if (selected.branches.size) parts.push(`delete ${plural(selected.branches.size, "branch", "branches")}`);
  const text = parts.join(", ");
  return text && text[0].toUpperCase() + text.slice(1);
}

export function hasRemovable(preview: CleanupPreview): boolean {
  return preview.worktrees.some((w) => w.removable) || preview.prunable.length > 0 || preview.branches.some((b) => b.removable);
}

/** The request body; branches carry the commit the user saw, so one that moved since is kept. */
export function selectionPayload(preview: CleanupPreview, selected: Selected): CleanupSelection {
  return {
    worktrees: preview.worktrees.filter((w) => selected.worktrees.has(w.path)).map((w) => w.path),
    prune: selected.prune && preview.prunable.length > 0,
    branches: preview.branches.filter((b) => selected.branches.has(b.name)).map((b) => ({ name: b.name, commit: b.commit })),
  };
}

/** Deleted branch names passed the server's branch-name check (no spaces, quotes or leading dashes): safe to paste as is. */
export function restoreCommand(item: CleanupItemResult): string | undefined {
  if (item.kind !== "branch" || item.outcome !== "deleted" || !item.commit) return undefined;
  return `git branch ${item.id} ${item.commit}`;
}

export function outcomeText(item: CleanupItemResult): string {
  if (item.outcome === "kept") return `kept: ${item.reason ?? "not removable"}`;
  return item.outcome;
}
