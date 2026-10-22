// What the board and the change detail say about a stale change (openspec/specs/stale-changes): its reason in words and
// which action fits. Pure, so the card badge and the detail notice say the same and tests need no DOM. Everything comes
// from the snapshot and the worktree listing; nothing here is decided from git.
import type { ChangeSnapshot, SessionWorktree, StrandedArchive, Worktree } from "../shared/types.ts";

export type StaleReason =
  | { kind: "stranded"; stranded: StrandedArchive; title: string }
  | { kind: "settled"; worktree: SessionWorktree; title: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Why `change` is stale, or undefined. A stranded archive only for an active change; a settled worktree only for an
 * archived one, because the archive on the default branch is what makes its leftovers safe to let go. `base` names the
 * default branch in the text when it is known.
 */
export function staleReason(
  change: Pick<ChangeSnapshot, "repoId" | "name" | "archived" | "strandedArchive">,
  worktrees: readonly SessionWorktree[],
  base?: string,
): StaleReason | undefined {
  const target = base ?? "the default branch";
  if (!change.archived && change.strandedArchive) {
    const s = change.strandedArchive;
    return { kind: "stranded", stranded: s, title: `Stale: its archive was committed on ${s.branch} (${s.commit.slice(0, 7)}) but never reached ${target}` };
  }
  if (change.archived) {
    const worktree = worktrees.find((w) => w.repoId === change.repoId && w.change === change.name && w.settled);
    if (worktree?.settled) {
      const held = worktree.settled.uncommitted > 0 ? ` with ${plural(worktree.settled.uncommitted, "uncommitted file")} inside the change` : "";
      return { kind: "settled", worktree, title: `Stale: the session worktree ${worktree.name} is left over${held}, although everything it holds is already archived on ${target}` };
    }
  }
  return undefined;
}

/**
 * The path the deletion dialog is opened with: the one git lists for that worktree (by path, else by branch), since the
 * server finds the worktree in that list. Undefined when git does not list it — then there is nothing to delete.
 */
export function listedWorktreePath(worktree: Pick<SessionWorktree, "path" | "branch">, listed: readonly Worktree[]): string | undefined {
  const linked = listed.filter((w) => !w.isMain && !w.bare && !w.prunable);
  return (linked.find((w) => w.path === worktree.path) ?? (worktree.branch ? linked.find((w) => w.branch === worktree.branch) : undefined))?.path;
}

/** What the detail's notice says under the reason: what the action does, or what to do by hand without sessions. */
export function staleHint(reason: StaleReason, sessionsAvailable: boolean, base?: string): string {
  const target = base ?? "the default branch";
  if (reason.kind === "settled") return `Everything it holds is already archived on ${target}. Removing it deletes the worktree and its branch, after a copy of its uncommitted files is kept.`;
  if (sessionsAvailable) return `Carry over archive starts an archive session that cherry-picks ${reason.stranded.commit.slice(0, 7)} onto a fresh branch instead of archiving again; ship it from there.`;
  return `Bring it over by hand: cherry-pick ${reason.stranded.commit} onto a new branch from ${target} and open a pull request.`;
}
