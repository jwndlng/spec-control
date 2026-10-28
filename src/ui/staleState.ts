// What the board and the change detail say about a stale change (openspec/specs/stale-changes): its reason in words and
// which action fits. Pure, so the card badge and the detail notice say the same and tests need no DOM. Everything comes
// from the snapshot; nothing here is decided from git.
import type { ChangeSnapshot, DuplicateAfterArchive, StaleCleanupItem, StaleCleanupPreview, StaleCleanupRequest, StaleCleanupResult, StaleLeftover, StaleLeftovers, StrandedArchive } from "../shared/types.ts";

/**
 * Why a change is stale. A change can be stale for more than one reason at once and still shows one badge: `duplicate`
 * rides along with the stranded or leftovers reason, and is a reason of its own when there is no other.
 */
export type StaleReason = (
  | { kind: "stranded"; stranded: StrandedArchive }
  | { kind: "leftovers"; stale: StaleLeftovers }
  | { kind: "duplicate" }
) & { title: string; duplicate?: DuplicateAfterArchive };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1 worktree and 2 branches", "1 worktree, 1 branch and 1 main-checkout copy". */
function joinWords(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Uncommitted files a stale cleanup would copy and delete: a worktree's uncommitted paths and a main-checkout copy's files. */
export function uncommittedCount(leftovers: readonly StaleLeftover[]): number {
  return leftovers.reduce((n, l) => n + (l.kind === "worktree" ? l.uncommittedCount : l.kind === "main" ? l.files.length : 0), 0);
}

/** What is left over, in words: counts of worktrees, branches and main-checkout copies, and the uncommitted files they hold. */
export function leftoverSummary(leftovers: readonly StaleLeftover[]): string {
  const count = (kind: StaleLeftover["kind"]) => leftovers.filter((l) => l.kind === kind).length;
  const parts = [
    count("worktree") > 0 ? plural(count("worktree"), "worktree") : "",
    count("branch") > 0 ? plural(count("branch"), "branch", "branches") : "",
    count("main") > 0 ? plural(count("main"), "main-checkout copy", "main-checkout copies") : "",
  ].filter(Boolean);
  const files = uncommittedCount(leftovers);
  return `${joinWords(parts)} ${leftovers.length === 1 ? "is" : "are"} left over${files > 0 ? ` with ${plural(files, "uncommitted file")}` : ""}`;
}

/** The change's directory as the duplicate text names it. */
const changeDir = (name: string) => `openspec/changes/${name}/`;

/**
 * Why `change` is stale, or undefined. A stranded archive only for an active change; leftovers whenever the scan found a
 * stale one — the default branch holds the archive, which is what makes them safe to let go; a duplicate whenever the
 * default branch holds the change's directory next to its archive. `base` names the default branch in the text when it
 * is known.
 */
export function staleReason(change: Pick<ChangeSnapshot, "name" | "archived" | "strandedArchive" | "stale" | "duplicate">, base?: string): StaleReason | undefined {
  const target = base ?? "the default branch";
  const duplicate = change.duplicate;
  const also = duplicate ? `; and ${changeDir(change.name)} is still committed next to its archive on ${target}` : "";
  const withDuplicate = duplicate ? { duplicate } : {};
  if (!change.archived && change.strandedArchive) {
    const s = change.strandedArchive;
    return { kind: "stranded", stranded: s, title: `Stale: its archive was committed on ${s.branch} (${s.commit.slice(0, 7)}) but never reached ${target}${also}`, ...withDuplicate };
  }
  if (change.stale && change.stale.leftovers.length > 0) {
    return { kind: "leftovers", stale: change.stale, title: `Stale: archived and merged on ${target}, while ${leftoverSummary(change.stale.leftovers)}${also}`, ...withDuplicate };
  }
  if (duplicate) return { kind: "duplicate", title: `Stale: archived on ${target}, but ${changeDir(change.name)} is still committed there too`, duplicate };
  return undefined;
}

/** What the detail says about a duplicate after archive, and whether it offers Remove duplicate. */
export interface DuplicateNotice {
  text: string;
  offered: boolean;
}

/**
 * The duplicate part of the stale notice (stale-changes: "A duplicate is marked on the board and offered Remove
 * duplicate"): the archive and the differing paths, then the action or why it is not offered, or what to do by hand
 * where sessions are not available, and that Pull brings the state when the main checkout has not pulled it.
 */
export function duplicateNotice(name: string, duplicate: DuplicateAfterArchive, { sessionsAvailable, running }: { sessionsAvailable: boolean; running: boolean }, base?: string): DuplicateNotice {
  const target = base ?? "the default branch";
  const dir = changeDir(name);
  const more = duplicate.differingCount - duplicate.differing.length;
  const differs =
    duplicate.differingCount === 0
      ? "The two copies are identical."
      : `The copy differs from the archive in ${duplicate.differing.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`;
  const what = `Its archive is openspec/changes/archive/${duplicate.archive}/. ${differs}`;
  const pull = duplicate.pulled ? "" : " The main checkout has not pulled this yet: Pull brings it.";
  if (!sessionsAvailable) return { text: `${what} Delete ${dir} in a commit: the deletion has to be committed to ${target}.${pull}`, offered: false };
  if (duplicate.archiveBranch) {
    return { text: `${what} Remove duplicate is not offered while the branch ${duplicate.archiveBranch} exists: Clean up leftovers… removes it once it is merged.${pull}`, offered: false };
  }
  if (running) return { text: `${what} Remove duplicate is offered once the change's running session has ended.${pull}`, offered: false };
  return {
    text: `${what} Remove duplicate starts an archive session that asks you what to carry over into the archive, deletes ${dir} and opens a pull request for ${target}.${pull}`,
    offered: true,
  };
}

/** What the detail's notice says under the reason: what the action does, or what to do by hand without sessions. */
export function staleHint(reason: StaleReason, sessionsAvailable: boolean, base?: string): string {
  const target = base ?? "the default branch";
  // The duplicate's own text is `duplicateNotice`.
  if (reason.kind === "duplicate") return "";
  if (reason.kind === "leftovers") {
    const pull = reason.stale.pulled ? "" : ` The main checkout has not pulled the archive yet: Pull brings it.`;
    return `Everything they hold is already archived on ${target}. Clean up leftovers… removes them, after a copy of their uncommitted files is kept.${pull}`;
  }
  if (sessionsAvailable) return `Carry over archive starts an archive session that cherry-picks ${reason.stranded.commit.slice(0, 7)} onto a fresh branch instead of archiving again; ship it from there.`;
  return `Bring it over by hand: cherry-pick ${reason.stranded.commit} onto a new branch from ${target} and open a pull request.`;
}

/** Uncommitted paths outside the change's own directories, across the listed worktrees: what the acknowledgement is for. */
export function outsidePaths(leftovers: readonly StaleLeftover[]): string[] {
  return [...new Set(leftovers.flatMap((l) => (l.kind === "worktree" ? l.outside : [])))];
}

/** Whether removing the listed leftovers deletes files outside the change, so the user must acknowledge it first. */
export function needsAcknowledgement(leftovers: readonly StaleLeftover[]): boolean {
  return outsidePaths(leftovers).length > 0;
}

/** What the dialog posts: exactly the items it listed and what the user saw of each. */
export function staleRequest(leftovers: readonly StaleLeftover[], acknowledged: boolean): StaleCleanupRequest {
  const main = leftovers.find((l) => l.kind === "main");
  return {
    worktrees: leftovers.flatMap((l) => (l.kind === "worktree" ? [{ path: l.path, branch: l.branch ?? null, commit: l.commit, uncommitted: l.uncommitted }] : [])),
    branches: leftovers.flatMap((l) => (l.kind === "branch" ? [{ name: l.name, commit: l.commit }] : [])),
    mainCheckout: main?.kind === "main" ? { files: main.files.map(({ path, hash }) => ({ path, hash })) } : null,
    acknowledged,
  };
}

/** One line naming a leftover. */
export function leftoverLabel(l: StaleLeftover): string {
  if (l.kind === "worktree") return `Worktree ${l.branch ? `on ${l.branch}` : `at ${l.commit.slice(0, 7)} (detached)`}`;
  if (l.kind === "branch") return `Branch ${l.name} at ${l.commit.slice(0, 7)}`;
  return `${l.dir}/ in the main checkout, never committed there`;
}

/** What became of one item. */
export function cleanupItemText(item: StaleCleanupItem): string {
  const what = item.kind === "worktree" ? `The worktree ${item.id}` : item.kind === "branch" ? `The branch ${item.id}` : `${item.id}/ in the main checkout`;
  if (item.outcome === "kept") return `${what} was kept: ${item.reason ?? "it was refused"}.`;
  if (item.kind === "branch") return `${what} was deleted.`;
  if (item.kind === "main") return `${what} was deleted${item.reason ? `, but ${item.reason}` : " and its removal staged"}.`;
  if (item.outcome === "deleted") return `${what} was removed and its branch ${item.branch} deleted.`;
  return `${what} was removed${item.reason ? `; ${item.reason}` : ""}.`;
}

/** `git branch <name> <commit>` for every branch the cleanup deleted. */
export function restoreCommands(result: StaleCleanupResult): string[] {
  return result.items.filter((i) => i.outcome === "deleted" && i.branch && i.commit).map((i) => `git branch ${i.branch} ${i.commit}`);
}

/** Whether a cleanup's outcome must be shown rather than the dialog just closing: something was kept or copied. */
export function cleanupNeedsReport(result: StaleCleanupResult): boolean {
  return result.refused !== undefined || result.items.some((i) => i.outcome === "kept" || i.backupDir !== undefined);
}

export interface EndCleanupOffer {
  /** The session's worktree is a stale leftover once the session has ended: Clean up leftovers replaces the plain removal. */
  offered: boolean;
  /** Whenever it is offered: files outside the change are named beside it and copied before anything is deleted. */
  preselected: boolean;
}

/** The end-session dialog's offer, from the `?ending=` preview (agent-sessions: "Ending a session cleans up a stale change's leftovers"). */
export function endCleanupOffer(preview: StaleCleanupPreview | undefined, session: { branch?: string; worktreePath: string }): EndCleanupOffer {
  const leftovers = preview?.stale?.leftovers ?? [];
  const own = leftovers.some((l) => l.kind === "worktree" && ((session.branch !== undefined && l.branch === session.branch) || l.path === session.worktreePath));
  return own ? { offered: true, preselected: true } : { offered: false, preselected: false };
}

/** Said when a session's worktree is kept because it cannot be removed and its change is not stale yet. */
export const keptUntilStale = "It will be marked stale, with Clean up leftovers… on the board, once the change is archived and merged.";
