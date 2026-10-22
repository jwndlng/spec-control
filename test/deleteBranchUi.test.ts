// The Checkouts section's `no active change` marker and **Delete…** control, and what the deletion dialog says
// (project-overview: "Repository board header"; repository-cleanup: "One branch and its worktree can be deleted whatever
// they hold").
import { expect, test } from "bun:test";
import type { BranchDeletePreview, ChangeSnapshot, RepoSnapshot, Worktree } from "../src/shared/types.ts";
import { CheckoutList } from "../src/ui/checkout.tsx";
import {
  acknowledgement,
  atStake,
  branchesWithActiveChange,
  canDelete,
  confirmLabel,
  countNoActiveChange,
  lossFacts,
  noActiveChange,
  restoreCommand,
  resultText,
} from "../src/ui/deleteBranchState.ts";
import { byTag, textOf } from "./vnode.ts";

const change = (name: string, patch: Partial<ChangeSnapshot> = {}): ChangeSnapshot => ({
  repoId: "a",
  name,
  schema: "spec-driven",
  artifacts: [],
  tasks: null,
  stage: "drafts",
  column: "Drafts",
  checkout: { path: "/w/acme/alpha-infra", branch: "main", isMain: true },
  ...patch,
});

const main: Worktree = { path: "/w/acme/alpha-infra", branch: "main", isMain: true };
const wt = (branch: string | undefined, patch: Partial<Worktree> = {}): Worktree => ({
  path: `/w/wt/${branch ?? "detached"}`,
  ...(branch ? { branch } : { detached: true, head: "abc1234" }),
  ...patch,
});

function repo(worktrees: Worktree[], changes: ChangeSnapshot[] = [], patch: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return { id: "a", name: "alpha-infra", path: "/w/acme/alpha-infra", ok: true, scannedAt: "2026-10-01T00:00:00Z", isGit: true, defaultBranch: "main", worktrees, changes, ...patch };
}

test("a branch belongs to an active change through its checkout, its other checkouts, its branch match or a session branch name", () => {
  const r = repo(
    [],
    [
      change("report", { checkout: { path: "/w/wt/feat-report", branch: "feat/report", isMain: false } }),
      change("parser", { otherCheckouts: [{ path: "/w/wt/fix", branch: "fix/parser-copy", isMain: false, column: "Drafts" }] }),
      change("audit", { branchMatch: "topic/audit" }),
      change("old", { archived: "2026-09-01", branchMatch: "feat/old" }),
    ],
  );
  const active = branchesWithActiveChange(r);
  for (const b of ["feat/report", "fix/parser-copy", "topic/audit", "feat/parser", "chore/archive-parser"]) expect(active.has(b)).toBe(true);
  expect(active.has("feat/old")).toBe(false);
  expect(active.has("main")).toBe(false);
});

test("the marker goes on linked worktrees whose branch has no active change, never on main, detached, stale or default", () => {
  const spike = wt("spike/old-idea");
  const report = wt("feat/report");
  const archived = wt("feat/audit-trail");
  const r = repo(
    [main, report, spike, archived, wt(undefined), wt("feat/gone", { prunable: true }), wt("main", { path: "/w/wt/main-copy" })],
    [change("report"), change("audit-trail", { archived: "2026-09-01" })],
  );
  expect(noActiveChange(r, spike)).toBe(true);
  expect(noActiveChange(r, archived)).toBe(true);
  expect(noActiveChange(r, report)).toBe(false);
  expect(r.worktrees.filter((w) => noActiveChange(r, w)).map((w) => w.branch)).toEqual(["spike/old-idea", "feat/audit-trail"]);
  expect(countNoActiveChange(r)).toBe(2);
});

test("Delete… is offered on linked worktrees that are not stale, bare or on the default branch", () => {
  const r = repo([]);
  expect(canDelete(r, main)).toBe(false);
  expect(canDelete(r, wt("feat/report"))).toBe(true);
  expect(canDelete(r, wt(undefined))).toBe(true);
  expect(canDelete(r, wt("feat/gone", { prunable: true }))).toBe(false);
  expect(canDelete(r, wt("main", { path: "/w/wt/main-copy" }))).toBe(false);
  expect(canDelete(repo([], [], { ok: false }), wt("feat/report"))).toBe(false);
});

test("the Checkouts list renders the marker and the control, and offers no control without onDelete", () => {
  const r = repo([main, wt("feat/report"), wt("spike/old-idea"), wt("feat/gone", { prunable: true })], [change("report")]);
  const offered: string[] = [];
  const list = CheckoutList({ repo: r, onDelete: (w) => offered.push(w.path) });
  const rows = byTag(list, "li");
  expect(rows.filter((li) => li.props.class === "no-change")).toHaveLength(1);
  expect(textOf(list)).toContain("no active change");
  const buttons = byTag(list, "button").filter((b) => textOf(b) === "Delete…");
  expect(buttons.map((b) => b.props.title)).toEqual(["Delete feat/report and its worktree — shows what would be lost first", "Delete spike/old-idea and its worktree — shows what would be lost first"]);
  (buttons[1].props.onClick as (e: { currentTarget: unknown }) => void)({ currentTarget: {} });
  expect(offered).toEqual(["/w/wt/spike/old-idea"]);
  expect(byTag(CheckoutList({ repo: r }), "button").filter((b) => textOf(b) === "Delete…")).toHaveLength(0);
});

const preview = (patch: Partial<BranchDeletePreview> = {}): BranchDeletePreview => ({
  repoId: "a",
  path: "/w/wt/feat/report",
  branch: "feat/report",
  commit: "c".repeat(40),
  statusDigest: "d".repeat(64),
  uncommitted: [],
  uncommittedCount: 0,
  notOnRemote: 0,
  notInBase: 0,
  base: "origin/main",
  merged: true,
  managed: false,
  ...patch,
});

test("work at stake needs the acknowledgement; a clean, merged worktree does not", () => {
  expect(atStake(preview())).toBe(false);
  expect(lossFacts(preview())).toEqual([]);
  const dirty = preview({ uncommitted: ["README.md", "notes/draft.md", "x"], uncommittedCount: 3 });
  expect(atStake(dirty)).toBe(true);
  expect(acknowledgement(dirty)).toBe("Delete it anyway, with 3 uncommitted files");
  const unmerged = preview({ notInBase: 2, notOnRemote: 2, merged: false });
  expect(atStake(unmerged)).toBe(true);
  expect(acknowledgement(unmerged)).toBe("Delete it anyway, with 2 commits not in origin/main");
  expect(lossFacts(unmerged)).toEqual(["2 commits on no remote, as of the last fetch", "2 commits not in origin/main"]);
  const squashed = preview({ notInBase: 3, merged: true });
  expect(atStake(squashed)).toBe(false);
  expect(lossFacts(squashed)).toEqual(["its changes are in origin/main (squash or rebase merged)"]);
  expect(atStake(preview({ notInBase: undefined, merged: undefined, base: undefined }))).toBe(true);
});

test("the confirm control names what happens", () => {
  expect(confirmLabel(preview())).toBe("Delete feat/report and its worktree");
  expect(confirmLabel(preview({ branch: undefined }))).toBe("Remove this worktree");
});

test("results say what happened, with the restore command for a deleted branch", () => {
  const deleted = { repoId: "a", path: "/w/wt/x", outcome: "deleted" as const, branch: "feat/report", commit: "c".repeat(40), backupDir: "/h/b", backedUp: 2 };
  expect(resultText(deleted)).toBe("The worktree was removed and feat/report was deleted.");
  expect(restoreCommand(deleted)).toBe(`git branch feat/report ${"c".repeat(40)}`);
  expect(resultText({ repoId: "a", path: "/w/wt/x", outcome: "refused", reason: "the branch changed since you looked — look again" })).toBe(
    "Nothing was deleted: the branch changed since you looked — look again.",
  );
  expect(resultText({ repoId: "a", path: "/w/wt/x", outcome: "removed" })).toBe("The worktree was removed.");
  expect(restoreCommand({ repoId: "a", path: "/w/wt/x", outcome: "removed" })).toBeUndefined();
});
