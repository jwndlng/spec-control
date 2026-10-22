// What the project details' Checkouts section marks and offers per worktree, and what the deletion dialog says (repository-
// cleanup: "One branch and its worktree can be deleted whatever they hold"). Kept free of Preact so it can be tested
// without a DOM; everything here is derived from the snapshot and the server's preview, never from git.
import { sessionBranch } from "../shared/sessionBranch.ts";
import type { BranchDeletePreview, BranchDeleteResult, RepoSnapshot, Worktree } from "../shared/types.ts";

/** Branches some active change belongs to: read from it, named as its branch, or the branch a session for it would use. */
export function branchesWithActiveChange(repo: RepoSnapshot): Set<string> {
  const out = new Set<string>();
  for (const c of repo.changes) {
    if (c.archived) continue;
    if (c.branchMatch) out.add(c.branchMatch);
    if (c.checkout?.branch && !c.checkout.isMain) out.add(c.checkout.branch);
    for (const o of c.otherCheckouts ?? []) if (o.branch && !o.isMain) out.add(o.branch);
    out.add(sessionBranch("implement", c.name));
    out.add(sessionBranch("archive", c.name));
  }
  return out;
}

/** A linked worktree on a branch of its own: the only kind of checkout that can be left over by a change. */
const ownBranch = (repo: RepoSnapshot, w: Worktree): w is Worktree & { branch: string } =>
  !w.isMain && !w.bare && !w.prunable && !w.detached && !!w.branch && w.branch !== repo.defaultBranch;

/** Whether `w` gets the `no active change` marker. `active` is `branchesWithActiveChange(repo)`, computed once per list. */
export function noActiveChange(repo: RepoSnapshot, w: Worktree, active: Set<string> = branchesWithActiveChange(repo)): boolean {
  return ownBranch(repo, w) && !active.has(w.branch);
}

export function countNoActiveChange(repo: RepoSnapshot): number {
  const active = branchesWithActiveChange(repo);
  return repo.worktrees.filter((w) => noActiveChange(repo, w, active)).length;
}

/** **Delete…** is offered on every linked worktree that is not stale, not bare and not on the default branch. */
export function canDelete(repo: RepoSnapshot, w: Worktree): boolean {
  return repo.isGit && repo.ok && !w.isMain && !w.bare && !w.prunable && (!w.branch || w.branch !== repo.defaultBranch);
}

/** Work that exists nowhere else is at stake: the user must say they know before the confirm control is enabled. */
export function atStake(p: BranchDeletePreview): boolean {
  return p.uncommittedCount > 0 || (p.branch !== undefined && p.merged !== true) || (p.branch === undefined && (p.notOnRemote ?? 0) > 0);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function confirmLabel(p: BranchDeletePreview): string {
  return p.branch ? `Delete ${p.branch} and its worktree` : "Remove this worktree";
}

/** The acknowledgement, naming exactly what goes. */
export function acknowledgement(p: BranchDeletePreview): string {
  const parts: string[] = [];
  if (p.uncommittedCount > 0) parts.push(plural(p.uncommittedCount, "uncommitted file"));
  if (p.branch && p.merged !== true) {
    if (p.notInBase !== undefined && p.notInBase > 0) parts.push(`${plural(p.notInBase, "commit")} not in ${p.base ?? "the default branch"}`);
    else if (p.notInBase === undefined) parts.push("commits that may not be in the default branch");
  }
  if (!p.branch && (p.notOnRemote ?? 0) > 0) parts.push(`${plural(p.notOnRemote ?? 0, "commit")} on no branch`);
  return `Delete it anyway, with ${parts.join(" and ")}`;
}

/** One line per fact the dialog states about what would be lost; empty when nothing is at stake. */
export function lossFacts(p: BranchDeletePreview): string[] {
  const facts: string[] = [];
  if (p.uncommittedCount > 0) facts.push(`${plural(p.uncommittedCount, "uncommitted or untracked file")} — copied to a backup folder first`);
  if (p.notOnRemote !== undefined && p.notOnRemote > 0) facts.push(`${plural(p.notOnRemote, "commit")} on no remote, as of the last fetch`);
  if (p.notInBase !== undefined && p.notInBase > 0 && p.merged !== true) facts.push(`${plural(p.notInBase, "commit")} not in ${p.base ?? "the default branch"}`);
  if (p.notInBase !== undefined && p.notInBase > 0 && p.merged === true) facts.push(`its changes are in ${p.base ?? "the default branch"} (squash or rebase merged)`);
  if (p.notInBase === undefined) facts.push("the default branch is unknown, so whether its work is merged is unknown");
  return facts;
}

/** Deleted branch names passed the server's branch-name check: safe to paste as is. */
export function restoreCommand(r: BranchDeleteResult): string | undefined {
  return r.outcome === "deleted" && r.branch && r.commit ? `git branch ${r.branch} ${r.commit}` : undefined;
}

export function resultText(r: BranchDeleteResult): string {
  if (r.outcome === "refused") return `Nothing was deleted: ${r.reason ?? "refused"}.`;
  if (r.outcome === "removed") return r.branch ? `The worktree was removed; ${r.reason ?? "the branch was kept"}.` : "The worktree was removed.";
  return `The worktree was removed and ${r.branch} was deleted.`;
}
