// What the board and the detail say about a stale change (stale-changes spec): pure helpers and the hook-free card.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangeSnapshot, RepoSnapshot, SessionWorktree, Worktree } from "../src/shared/types.ts";
import { boardCards, ChangeCard } from "../src/ui/kanban.tsx";
import { listedWorktreePath, staleHint, staleReason } from "../src/ui/staleState.ts";
import { byTag, textOf } from "./vnode.ts";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const stranded = { branch: "feat/fix-release-pipeline", archive: "2026-10-22-fix-release-pipeline", commit: COMMIT };

const change = (patch: Partial<ChangeSnapshot> = {}): ChangeSnapshot => ({
  repoId: "demo",
  name: "fix-release-pipeline",
  schema: "spec-driven",
  artifacts: [],
  tasks: { done: 2, total: 5 },
  lastActivityAt: new Date(NOW).toISOString(),
  stage: "implementing",
  column: "Implementing",
  ...patch,
});

const worktree = (patch: Partial<SessionWorktree> = {}): SessionWorktree => ({
  repoId: "demo",
  name: "update-routines",
  path: "/h/worktrees/demo/update-routines",
  change: "update-routines",
  action: "implement",
  branch: "feat/update-routines",
  work: { state: "uncommitted", count: 1 },
  settled: { archive: "2026-10-22-update-routines", uncommitted: 1 },
  ...patch,
});

test("a stranded archive on an active change names its branch and commit", () => {
  const reason = staleReason(change({ strandedArchive: stranded }), [], "main");
  expect(reason).toMatchObject({ kind: "stranded", stranded });
  expect(reason?.title).toBe("Stale: its archive was committed on feat/fix-release-pipeline (0123456) but never reached main");
  // An archived change never carries one over; nothing at all without one.
  expect(staleReason(change({ strandedArchive: stranded, archived: "2026-10-22" }), [])).toBeUndefined();
  expect(staleReason(change(), [])).toBeUndefined();
});

test("a settled worktree marks its archived change, and only that one", () => {
  const archived = change({ name: "update-routines", archived: "2026-10-22", stage: "archived", column: "Archived" });
  const reason = staleReason(archived, [worktree()]);
  expect(reason).toMatchObject({ kind: "settled", worktree: worktree() });
  expect(reason?.title).toBe("Stale: the session worktree update-routines is left over with 1 uncommitted file inside the change, although everything it holds is already archived on the default branch");
  expect(staleReason(archived, [worktree({ settled: undefined })])).toBeUndefined();
  expect(staleReason(archived, [worktree({ repoId: "other" })])).toBeUndefined();
  // While active, the default branch has not archived it: a settled mark would be wrong anyway.
  expect(staleReason({ ...archived, archived: undefined }, [worktree()])).toBeUndefined();
});

test("the hint says what the action does, or what to do by hand without sessions", () => {
  const strandedReason = staleReason(change({ strandedArchive: stranded }), []);
  if (!strandedReason) throw new Error("expected a reason");
  expect(staleHint(strandedReason, true)).toContain("cherry-picks 0123456 onto a fresh branch");
  expect(staleHint(strandedReason, false, "main")).toBe(`Bring it over by hand: cherry-pick ${COMMIT} onto a new branch from main and open a pull request.`);
  const settledReason = staleReason(change({ name: "update-routines", archived: "2026-10-22" }), [worktree()]);
  if (!settledReason) throw new Error("expected a reason");
  expect(staleHint(settledReason, true, "main")).toContain("already archived on main");
});

test("the deletion dialog gets the path git lists for the worktree", () => {
  const listed = (path: string, branch?: string, extra: Partial<Worktree> = {}): Worktree => ({ path, branch, isMain: false, ...extra });
  expect(listedWorktreePath(worktree(), [listed("/h/worktrees/demo/update-routines", "feat/update-routines")])).toBe("/h/worktrees/demo/update-routines");
  expect(listedWorktreePath(worktree(), [listed("/private/h/worktrees/demo/update-routines", "feat/update-routines")])).toBe("/private/h/worktrees/demo/update-routines");
  expect(listedWorktreePath(worktree(), [listed("/w/acme/demo", "feat/update-routines", { isMain: true })])).toBeUndefined();
  expect(listedWorktreePath(worktree(), [listed("/h/worktrees/demo/update-routines", "feat/update-routines", { prunable: true })])).toBeUndefined();
});

test("the card shows the Stale badge with its reason and stays in its column", () => {
  const c = change({ strandedArchive: stranded });
  const repo: RepoSnapshot = { id: "demo", name: "demo-ops", path: "/w/acme/demo-ops", ok: true, scannedAt: new Date(NOW).toISOString(), isGit: true, worktrees: [], changes: [c] };
  const card = boardCards([repo], new Map([["demo", 120]]))[0];
  const stale = staleReason(card, []);
  const badge = byTag(ChangeCard({ card, now: NOW, from: "/board", stale }), "span").find((s) => String(s.props.class ?? "").includes("stale"));
  expect(textOf(badge).trim()).toBe("Stale");
  expect(badge?.props.title).toBe(stale?.title);
  expect(badge?.props["aria-label"]).toBe(stale?.title);
  expect(card.column).toBe("Implementing");
  const plain = byTag(ChangeCard({ card, now: NOW, from: "/board" }), "span").find((s) => String(s.props.class ?? "").includes("stale"));
  expect(plain).toBeUndefined();
});

test("the detail offers Remove worktree… through the deletion dialog and Carry over archive through an archive session", () => {
  const detail = readFileSync(join(import.meta.dir, "..", "src", "ui", "changeDetail.tsx"), "utf8");
  expect(detail).toContain("<StaleNotice repo={repo} change={change} />");
  expect(detail).toContain("<DeleteBranchDialog");
  expect(detail).toContain('ui.start(repo.id, change.name, "archive", true, { carryOver: true })');
});
