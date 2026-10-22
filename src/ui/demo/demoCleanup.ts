// Repository cleanup, simulated: the preview is derived from the sample's checkouts and DEMO_BRANCHES, and applying it
// only remembers what was removed for this page session. No git, no disk; a reload brings everything back.
import type {
  BranchDeletePreview,
  BranchDeleteRequest,
  BranchDeleteResult,
  CleanupBranch,
  CleanupItemResult,
  CleanupPreview,
  CleanupResult,
  CleanupSelection,
  CleanupWorktree,
  RepoSnapshot,
  Worktree,
} from "../../shared/types.ts";
import { DEMO_BRANCHES } from "./sampleData.ts";

/** A made-up but stable 40-hex commit per branch name. */
function fakeCommit(name: string): string {
  let h = 2166136261;
  let out = "";
  for (let round = 0; out.length < 40; round++) {
    for (const ch of `${name}#${round}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 40);
}

export interface DemoCleanupState {
  removedWorktrees: Set<string>;
  pruned: Set<string>;
  deletedBranches: Set<string>;
}

export const newCleanupState = (): DemoCleanupState => ({ removedWorktrees: new Set(), pruned: new Set(), deletedBranches: new Set() });

/** The repository's checkouts minus what a demo cleanup removed; the snapshot shows these. */
export function remainingWorktrees(state: DemoCleanupState, worktrees: Worktree[]): Worktree[] {
  return worktrees.filter((w) => !state.removedWorktrees.has(w.path) && !state.pruned.has(w.path));
}

const key = (repoId: string, name: string) => `${repoId}\0${name}`;

function judgeWorktree(w: Worktree, merged: Set<string>): CleanupWorktree {
  const status = typeof w.status === "object" ? w.status : undefined;
  const dirty = status ? status.modified + status.untracked + status.conflicts : 0;
  const isMerged = w.branch !== undefined && merged.has(w.branch);
  const work: CleanupWorktree["work"] =
    dirty > 0
      ? { state: "uncommitted", count: dirty, base: "origin/main" }
      : isMerged
        ? { state: "merged", base: "origin/main" }
        : w.unpushed
          ? { state: "unpushed", count: w.unpushed, base: "origin/main" }
          : { state: "pushed", base: "origin/main" };
  const item: CleanupWorktree = { path: w.path, branch: w.branch, work, managed: false, locked: w.locked || undefined, removable: false };
  if (w.locked) return { ...item, reason: `it is locked${w.lockReason ? ` (${w.lockReason})` : ""}` };
  if (!status) return { ...item, reason: "could not read the worktree's status" };
  if (dirty > 0) return { ...item, reason: "the worktree has uncommitted changes" };
  if (!isMerged && w.unpushed)
    return { ...item, reason: `${w.unpushed} commit(s) ${status.upstream ? "have not been pushed" : "exist only on this worktree's branch"}` };
  return { ...item, removable: true };
}

export function demoPreview(state: DemoCleanupState, repo: RepoSnapshot): CleanupPreview {
  const facts = DEMO_BRANCHES[repo.name] ?? { merged: [], unmerged: [] };
  const merged = new Set(facts.merged);
  const all = remainingWorktrees(state, repo.worktrees);
  const linked = all.filter((w) => !w.isMain && !w.prunable);
  const worktrees = linked.map((w) => judgeWorktree(w, merged));
  const removable = new Set(worktrees.filter((w) => w.removable).map((w) => w.path));
  const unmerged = new Map(facts.unmerged);

  const names = new Set([...all.flatMap((w) => (w.branch ? [w.branch] : [])), ...facts.merged, ...unmerged.keys()]);
  names.delete(repo.defaultBranch ?? "main");
  const branches = [...names]
    .filter((name) => !state.deletedBranches.has(key(repo.id, name)))
    .sort()
    .map((name): CleanupBranch => {
      const item: CleanupBranch = { name, commit: fakeCommit(`${repo.id}/${name}`), removable: false };
      const holder = all.find((w) => w.branch === name);
      if (holder?.isMain) return { ...item, reason: "it is checked out in the main checkout" };
      if (!merged.has(name)) return { ...item, reason: `${unmerged.get(name) ?? holder?.unpushed ?? 1} commit(s) not in origin/main` };
      const mergedItem: CleanupBranch = { ...item, mergedBy: name.startsWith("chore/") ? "ancestry" : "content" };
      if (holder?.prunable) return { ...mergedItem, reason: "it is checked out in a stale worktree record — prune it, then clean up again" };
      if (holder) {
        if (!removable.has(holder.path))
          return { ...mergedItem, worktreePath: holder.path, reason: `it is checked out in the worktree ${holder.path}, which is kept` };
        return { ...mergedItem, worktreePath: holder.path, removable: true };
      }
      return { ...mergedItem, removable: true };
    });
  return { repoId: repo.id, base: "origin/main", worktrees, prunable: all.filter((w) => !w.isMain && w.prunable).map((w) => ({ path: w.path })), branches };
}

/** Same order and re-checks as the server: worktrees, then records, then branches — each against the current preview. */
export function demoApply(state: DemoCleanupState, repo: RepoSnapshot, selection: CleanupSelection): CleanupResult {
  const items: CleanupItemResult[] = [];
  let preview = demoPreview(state, repo);
  for (const path of selection.worktrees) {
    const w = preview.worktrees.find((x) => x.path === path);
    if (!w) items.push({ kind: "worktree", id: path, outcome: "kept", reason: "not a worktree of this repository" });
    else if (!w.removable) items.push({ kind: "worktree", id: path, outcome: "kept", reason: w.reason });
    else {
      state.removedWorktrees.add(path);
      items.push({ kind: "worktree", id: path, outcome: "removed" });
    }
  }
  if (selection.prune) {
    for (const { path } of preview.prunable) {
      state.pruned.add(path);
      items.push({ kind: "prune", id: path, outcome: "pruned" });
    }
  }
  preview = demoPreview(state, repo);
  for (const { name, commit } of selection.branches) {
    const b = preview.branches.find((x) => x.name === name);
    if (!b) items.push({ kind: "branch", id: name, outcome: "kept", reason: "no such branch" });
    else if (b.commit !== commit) items.push({ kind: "branch", id: name, outcome: "kept", reason: "it changed since the preview" });
    else if (!b.removable) items.push({ kind: "branch", id: name, outcome: "kept", reason: b.reason });
    else {
      state.deletedBranches.add(key(repo.id, name));
      items.push({ kind: "branch", id: name, outcome: "deleted", commit });
    }
  }
  return { repoId: repo.id, items };
}

/** Made-up uncommitted paths, as many as the sample's status says, so the dialog has something to list. */
function demoUncommitted(w: Worktree): string[] {
  const status = typeof w.status === "object" ? w.status : undefined;
  const files: string[] = [];
  for (let i = 1; i <= (status?.modified ?? 0); i++) files.push(`src/module-${i}.ts`);
  for (let i = 1; i <= (status?.untracked ?? 0); i++) files.push(`notes/draft-${i}.md`);
  return files;
}

/** Deleting one worktree and its branch, simulated over the sample: same refusals and re-check as the server. */
export function demoBranchDeletePreview(state: DemoCleanupState, repo: RepoSnapshot, path: string): BranchDeletePreview {
  const w = remainingWorktrees(state, repo.worktrees).find((x) => !x.isMain && x.path === path);
  const base = { repoId: repo.id, path, commit: "", statusDigest: "", uncommitted: [], uncommittedCount: 0, managed: false };
  if (!w) return { ...base, refused: "it is not a linked worktree of this repository" };
  if (w.prunable) return { ...base, refused: "its directory no longer exists — Clean up prunes the record" };
  const facts = DEMO_BRANCHES[repo.name] ?? { merged: [], unmerged: [] };
  const merged = w.branch !== undefined && facts.merged.includes(w.branch);
  const uncommitted = demoUncommitted(w);
  const commit = fakeCommit(`${repo.id}/${w.branch ?? w.path}`);
  const preview: BranchDeletePreview = {
    ...base,
    branch: w.branch,
    commit,
    statusDigest: (fakeCommit(`${commit}/${uncommitted.join(",")}`) + commit).slice(0, 64),
    uncommitted,
    uncommittedCount: uncommitted.length,
    notOnRemote: w.unpushed ?? 0,
    notInBase: merged ? 0 : (new Map(facts.unmerged).get(w.branch ?? "") ?? w.unpushed ?? 1),
    base: "origin/main",
    merged,
    ...(w.locked ? { locked: true } : {}),
  };
  if (w.branch && w.branch === (repo.defaultBranch ?? "main")) return { ...preview, refused: "it is the default branch" };
  if (w.locked) return { ...preview, refused: `it is locked${w.lockReason ? ` (${w.lockReason})` : ""} — unlock it yourself first` };
  return preview;
}

export function demoDeleteBranch(state: DemoCleanupState, repo: RepoSnapshot, request: BranchDeleteRequest): BranchDeleteResult {
  const p = demoBranchDeletePreview(state, repo, request.path);
  const refuse = (reason: string): BranchDeleteResult => ({ repoId: repo.id, path: request.path, outcome: "refused", reason });
  if (p.refused) return refuse(p.refused);
  if ((p.branch ?? null) !== request.branch || p.commit !== request.commit || p.statusDigest !== request.statusDigest) return refuse("the worktree changed since you looked — look again");
  state.removedWorktrees.add(request.path);
  const backup = p.uncommittedCount > 0 ? { backupDir: `~/.spec-control/branch-backups/${repo.id}/demo-${(p.branch ?? "detached").replace(/[^A-Za-z0-9._-]/g, "_")}`, backedUp: p.uncommittedCount } : {};
  if (!p.branch) return { repoId: repo.id, path: request.path, outcome: "removed", ...backup };
  state.deletedBranches.add(key(repo.id, p.branch));
  return { repoId: repo.id, path: request.path, outcome: "deleted", branch: p.branch, commit: p.commit, ...backup };
}
