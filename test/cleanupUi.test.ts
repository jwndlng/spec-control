import { expect, test } from "bun:test";
import { h } from "preact";
import { BranchRow } from "../src/ui/cleanup.tsx";
import { textOf } from "./vnode.ts";
import type { CleanupPreview } from "../src/shared/types.ts";
import {
  confirmLabel,
  hasRemovable,
  initialSelection,
  outcomeText,
  restoreCommand,
  selectionPayload,
  toggleBranch,
  togglePrune,
  toggleWorktree,
} from "../src/ui/cleanupState.ts";

const C1 = "1".repeat(40);
const C2 = "2".repeat(40);
const C3 = "3".repeat(40);

const preview: CleanupPreview = {
  repoId: "r",
  base: "origin/main",
  worktrees: [
    { path: "/w/acme/wt/audit-trail", branch: "feat/audit-trail", work: { state: "merged" }, managed: true, removable: true },
    {
      path: "/w/acme/wt/report",
      branch: "feat/report",
      work: { state: "uncommitted", count: 1 },
      managed: false,
      removable: false,
      reason: "the worktree has uncommitted changes",
    },
  ],
  prunable: [{ path: "/w/acme/wt/gone" }],
  branches: [
    { name: "feat/audit-trail", commit: C1, mergedBy: "content", worktreePath: "/w/acme/wt/audit-trail", removable: true },
    { name: "feat/done", commit: C2, mergedBy: "ancestry", removable: true },
    { name: "fix/parser", commit: C3, removable: false, reason: "2 commit(s) not in origin/main" },
  ],
};

test("removable items start selected and the confirm label names what will happen", () => {
  const s = initialSelection(preview);
  expect([...s.worktrees]).toEqual(["/w/acme/wt/audit-trail"]);
  expect([...s.branches]).toEqual(["feat/audit-trail", "feat/done"]);
  expect(confirmLabel(preview, s)).toBe("Remove 1 worktree, prune 1 record, delete 2 branches");
  expect(selectionPayload(preview, s)).toEqual({
    worktrees: ["/w/acme/wt/audit-trail"],
    prune: true,
    branches: [
      { name: "feat/audit-trail", commit: C1 },
      { name: "feat/done", commit: C2 },
    ],
  });
});

test("a branch goes with its worktree: deselecting the worktree drops it, selecting the branch brings the worktree", () => {
  let s = toggleWorktree(preview, initialSelection(preview), "/w/acme/wt/audit-trail", false);
  expect([...s.branches]).toEqual(["feat/done"]);
  s = toggleBranch(preview, s, "feat/audit-trail", true);
  expect([...s.worktrees]).toEqual(["/w/acme/wt/audit-trail"]);
  s = toggleBranch(preview, s, "feat/audit-trail", false);
  expect([...s.worktrees]).toEqual(["/w/acme/wt/audit-trail"]); // the worktree may go on its own
});

test("nothing selected means no confirm label; nothing removable is said", () => {
  const none = { worktrees: new Set<string>(), prune: false, branches: new Set<string>() };
  expect(confirmLabel(preview, none)).toBe("");
  const kept: CleanupPreview = { repoId: "r", worktrees: [preview.worktrees[1]], prunable: [], branches: [preview.branches[2]] };
  expect(hasRemovable(kept)).toBe(false);
  expect(confirmLabel(kept, initialSelection(kept))).toBe("");
  expect(hasRemovable(preview)).toBe(true);
});

test("a stale branch selects pruning; deselecting pruning drops only its dependent branches", () => {
  const p: CleanupPreview = { ...preview, branches: [...preview.branches, { name: "feat/gone", commit: C1, removable: true, prunePath: preview.prunable[0].path }] };
  let selected = initialSelection(p);
  expect(selected.branches.has("feat/gone")).toBe(true);
  selected = togglePrune(p, selected, false);
  expect(selected.branches.has("feat/gone")).toBe(false);
  expect(selected.branches.has("feat/done")).toBe(true);
  selected = toggleBranch(p, selected, "feat/gone", true);
  expect(selected.prune).toBe(true);
  expect(selectionPayload(p, selected).branches.some((b) => b.name === "feat/gone")).toBe(true);
});

test("deleted branches come with a restore command; kept items with their reason", () => {
  expect(restoreCommand({ kind: "branch", id: "feat/done", outcome: "deleted", commit: C2 })).toBe(`git branch feat/done ${C2}`);
  expect(restoreCommand({ kind: "worktree", id: "/w/x", outcome: "removed" })).toBeUndefined();
  expect(outcomeText({ kind: "branch", id: "feat/done", outcome: "kept", reason: "it changed since the preview" })).toBe("kept: it changed since the preview");
  expect(outcomeText({ kind: "prune", id: "/w/gone", outcome: "pruned" })).toBe("pruned");
});

test("branch rows explain exact PR proof, evidence age, stale-record dependency and recovery", () => {
  const evidenceFetchedAt = new Date(Date.now() - 60_000).toISOString();
  const b = { name: "feat/proof", commit: C1, removable: true, mergedBy: "pull-request" as const, pullRequest: 81, evidenceFetchedAt, prunePath: "/w/acme/gone" };
  const merged = textOf(h(BranchRow, { b }));
  expect(merged).toContain("merged PR #81");
  expect(merged).toContain("PR evidence fetched");
  expect(merged).toContain("pruning its stale worktree record");
  const kept = textOf(h(BranchRow, { b: { ...b, removable: false, mergedBy: undefined, reason: "merge evidence is insufficient", nextAction: "Refresh Pull requests or inspect the branch." } }));
  expect(kept).toContain("merge evidence is insufficient");
  expect(kept).toContain("Refresh Pull requests or inspect the branch.");
});
