// What the board and the detail say about a stale change (stale-changes spec): pure helpers and the hook-free card.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangeSnapshot, DuplicateAfterArchive, RepoSnapshot, StaleCleanupPreview, StaleLeftover, StaleLeftovers } from "../src/shared/types.ts";
import { boardCards, ChangeCard } from "../src/ui/kanban.tsx";
import {
  cleanupItemText,
  duplicateNotice,
  cleanupNeedsReport,
  endCleanupOffer,
  keptUntilStale,
  leftoverSummary,
  needsAcknowledgement,
  restoreCommands,
  staleHint,
  staleReason,
  staleRequest,
} from "../src/ui/staleState.ts";
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

const OTHER = "fedcba9876543210fedcba9876543210fedcba98";
const wtLeftover = (patch: Partial<Extract<StaleLeftover, { kind: "worktree" }>> = {}): StaleLeftover => ({
  kind: "worktree",
  path: "/h/worktrees/demo/rotate-keys",
  branch: "feat/rotate-keys",
  commit: COMMIT,
  uncommitted: ["openspec/changes/rotate-keys/tasks.md", "openspec/changes/rotate-keys/proposal.md"],
  uncommittedCount: 2,
  outside: [],
  managed: true,
  ...patch,
});
const branchLeftover: StaleLeftover = { kind: "branch", name: "chore/archive-rotate-keys", commit: OTHER };
const mainLeftover: StaleLeftover = { kind: "main", dir: "openspec/changes/rotate-keys", files: [{ path: "prompt.md", hash: OTHER, staged: true }] };
const stale = (leftovers: StaleLeftover[], patch: Partial<StaleLeftovers> = {}): StaleLeftovers => ({ archive: "2026-10-20-rotate-keys", pulled: true, leftovers, kept: [], ...patch });

test("a stranded archive on an active change names its branch and commit", () => {
  const reason = staleReason(change({ strandedArchive: stranded }), "main");
  expect(reason).toMatchObject({ kind: "stranded", stranded });
  expect(reason?.title).toBe("Stale: its archive was committed on feat/fix-release-pipeline (0123456) but never reached main");
  // An archived change never carries one over; nothing at all without one.
  expect(staleReason(change({ strandedArchive: stranded, archived: "2026-10-22" }))).toBeUndefined();
  expect(staleReason(change())).toBeUndefined();
});

test("an archived and merged change with leftovers is stale, counting worktrees, branches, copies and files", () => {
  const archived = change({ name: "rotate-keys", archived: "2026-10-20", stage: "archived", column: "Archived" });
  const reason = staleReason({ ...archived, stale: stale([wtLeftover(), branchLeftover]) });
  expect(reason).toMatchObject({ kind: "leftovers" });
  expect(reason?.title).toBe("Stale: archived and merged on the default branch, while 1 worktree and 1 branch are left over with 2 uncommitted files");
  expect(leftoverSummary([wtLeftover(), branchLeftover, mainLeftover])).toBe("1 worktree, 1 branch and 1 main-checkout copy are left over with 3 uncommitted files");
  expect(leftoverSummary([branchLeftover])).toBe("1 branch is left over");
  // Only kept leftovers: nothing is stale.
  expect(staleReason({ ...archived, stale: stale([], { kept: [{ kind: "worktree", id: "/x", reason: "an agent session is running in it" }] }) })).toBeUndefined();
  expect(staleReason(archived)).toBeUndefined();
});

test("the hint says what the action does, or what to do by hand without sessions, and that Pull brings an archive", () => {
  const strandedReason = staleReason(change({ strandedArchive: stranded }));
  if (!strandedReason) throw new Error("expected a reason");
  expect(staleHint(strandedReason, true)).toContain("cherry-picks 0123456 onto a fresh branch");
  expect(staleHint(strandedReason, false, "main")).toBe(`Bring it over by hand: cherry-pick ${COMMIT} onto a new branch from main and open a pull request.`);
  const leftoverReason = staleReason(change({ stale: stale([wtLeftover()]) }));
  if (!leftoverReason) throw new Error("expected a reason");
  expect(staleHint(leftoverReason, true, "main")).toContain("Clean up leftovers… removes them");
  expect(staleHint(leftoverReason, true, "main")).not.toContain("Pull");
  const notPulled = staleReason(change({ stale: stale([wtLeftover()], { pulled: false }) }));
  if (!notPulled) throw new Error("expected a reason");
  expect(staleHint(notPulled, true)).toContain("Pull brings it");
});

test("the card shows the Stale badge with its reason and stays in its column", () => {
  const c = change({ strandedArchive: stranded });
  const repo: RepoSnapshot = { id: "demo", name: "demo-ops", path: "/w/acme/demo-ops", ok: true, scannedAt: new Date(NOW).toISOString(), isGit: true, worktrees: [], changes: [c] };
  const card = boardCards([repo], new Map([["demo", 120]]))[0];
  const reason = staleReason(card);
  const badge = byTag(ChangeCard({ card, now: NOW, from: "/board", stale: reason }), "span").find((s) => String(s.props.class ?? "").includes("stale"));
  expect(textOf(badge).trim()).toBe("Stale");
  expect(badge?.props.title).toBe(reason?.title);
  expect(badge?.props["aria-label"]).toBe(reason?.title);
  expect(card.column).toBe("Implementing");
  const plain = byTag(ChangeCard({ card, now: NOW, from: "/board" }), "span").find((s) => String(s.props.class ?? "").includes("stale"));
  expect(plain).toBeUndefined();
});

test("an archived and merged card keeps the Archived column with its badge", () => {
  const archived = change({ name: "rotate-keys", archived: "2026-10-20", stage: "archived", column: "Archived", stale: stale([wtLeftover()]) });
  const repo: RepoSnapshot = { id: "demo", name: "demo-ops", path: "/w/acme/demo-ops", ok: true, scannedAt: new Date(NOW).toISOString(), isGit: true, worktrees: [], changes: [archived] };
  const card = boardCards([repo], new Map([["demo", 120]]))[0];
  expect(card.column).toBe("Archived");
  expect(staleReason(card)?.kind).toBe("leftovers");
});

test("the detail offers Clean up leftovers… through the stale cleanup's dialog, Carry over archive and Remove duplicate through archive sessions", () => {
  const detail = readFileSync(join(import.meta.dir, "..", "src", "ui", "changeDetail.tsx"), "utf8");
  expect(detail).toContain("<StaleNotice repo={repo} change={change} />");
  expect(detail).toContain("<StaleCleanupDialog");
  expect(detail).not.toContain("Remove worktree…");
  expect(detail).toContain('ui.start(repo.id, change.name, "archive", true, options)');
  expect(detail).toContain("startArchive({ carryOver: true })");
  expect(detail).toContain("{duplicate?.offered && (");
  expect(detail).toContain("startArchive({ removeDuplicate: true })");
});

test("the request carries exactly the listed items and what the user saw of each", () => {
  expect(staleRequest([wtLeftover(), branchLeftover, mainLeftover], false)).toEqual({
    worktrees: [{ path: "/h/worktrees/demo/rotate-keys", branch: "feat/rotate-keys", commit: COMMIT, uncommitted: ["openspec/changes/rotate-keys/tasks.md", "openspec/changes/rotate-keys/proposal.md"] }],
    branches: [{ name: "chore/archive-rotate-keys", commit: OTHER }],
    mainCheckout: { files: [{ path: "prompt.md", hash: OTHER }] },
    acknowledged: false,
  });
  expect(needsAcknowledgement([wtLeftover(), mainLeftover])).toBe(false);
  expect(needsAcknowledgement([wtLeftover({ outside: ["src/keys.ts"] })])).toBe(true);
});

const preview = (leftovers: StaleLeftover[]): StaleCleanupPreview => ({ repoId: "demo", name: "rotate-keys", stale: stale(leftovers), backupRoot: "/h/branch-backups/demo" });
const ending = { branch: "chore/archive-rotate-keys", worktreePath: "/h/worktrees/demo/archive-rotate-keys" };
const archiveWorktree = (patch: Partial<Extract<StaleLeftover, { kind: "worktree" }>> = {}) =>
  wtLeftover({ path: "/private/h/worktrees/demo/archive-rotate-keys", branch: "chore/archive-rotate-keys", uncommitted: ["openspec/changes/rotate-keys/tasks.md"], uncommittedCount: 1, ...patch });

test("ending the archive session after the merge offers the cleanup, selected, with the other worktree listed", () => {
  expect(endCleanupOffer(preview([archiveWorktree(), wtLeftover()]), ending)).toEqual({ offered: true, preselected: true });
});

test("a source file outside the change is offered but not selected", () => {
  expect(endCleanupOffer(preview([archiveWorktree({ uncommitted: ["src/keys.ts"], outside: ["src/keys.ts"] })]), ending)).toEqual({ offered: true, preselected: false });
  // Another leftover's file outside the change counts too: the one confirmation removes it as well.
  expect(endCleanupOffer(preview([archiveWorktree(), wtLeftover({ outside: ["src/keys.ts"] })]), ending)).toEqual({ offered: true, preselected: false });
});

test("with the pull request still open nothing is offered and the dialog says the worktree will be marked stale", () => {
  // Not archived on the default branch: the preview has no stale part, or the session's worktree is not among the leftovers.
  expect(endCleanupOffer({ repoId: "demo", name: "rotate-keys", backupRoot: "/h" }, ending)).toEqual({ offered: false, preselected: false });
  expect(endCleanupOffer(preview([wtLeftover()]), ending)).toEqual({ offered: false, preselected: false });
  expect(endCleanupOffer(undefined, ending)).toEqual({ offered: false, preselected: false });
  expect(keptUntilStale).toContain("will be marked stale");
  const dialog = readFileSync(join(import.meta.dir, "..", "src", "ui", "endSessionDialog.tsx"), "utf8");
  expect(dialog).toContain("{keptUntilStale}");
});

test("each item's outcome is reported, with the backup and the restore command, and only what needs saying is", () => {
  const result = {
    repoId: "demo",
    name: "rotate-keys",
    items: [
      { kind: "worktree" as const, id: "/h/w", outcome: "deleted" as const, branch: "feat/rotate-keys", commit: COMMIT, backupDir: "/h/b/1", backedUp: 1 },
      { kind: "branch" as const, id: "chore/archive-rotate-keys", outcome: "kept" as const, reason: "it changed since you looked" },
    ],
  };
  expect(result.items.map(cleanupItemText)).toEqual([
    "The worktree /h/w was removed and its branch feat/rotate-keys deleted.",
    "The branch chore/archive-rotate-keys was kept: it changed since you looked.",
  ]);
  expect(restoreCommands(result)).toEqual([`git branch feat/rotate-keys ${COMMIT}`]);
  expect(cleanupNeedsReport(result)).toBe(true);
  expect(cleanupNeedsReport({ repoId: "demo", name: "x", items: [{ kind: "branch", id: "b", outcome: "deleted", branch: "b", commit: COMMIT }] })).toBe(false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Duplicate after archive
// ---------------------------------------------------------------------------------------------------------------------

const duplicate = (patch: Partial<DuplicateAfterArchive> = {}): DuplicateAfterArchive => ({ archive: "2026-10-20-rotate-keys", differing: ["tasks.md"], differingCount: 1, pulled: true, ...patch });
const archivedDuplicate = (patch: Partial<ChangeSnapshot> = {}) =>
  change({ name: "rotate-keys", archived: "2026-10-20", stage: "archived", column: "Archived", duplicate: duplicate(), ...patch });

test("a duplicate after archive is stale with its own reason and keeps the Archived column", () => {
  const reason = staleReason(archivedDuplicate(), "main");
  expect(reason).toMatchObject({ kind: "duplicate", duplicate: duplicate() });
  expect(reason?.title).toBe("Stale: archived on main, but openspec/changes/rotate-keys/ is still committed there too");
  expect(staleHint(reason as NonNullable<typeof reason>, true, "main")).toBe("");
  const repo: RepoSnapshot = { id: "demo", name: "demo-ops", path: "/w/acme/demo-ops", ok: true, scannedAt: new Date(NOW).toISOString(), isGit: true, worktrees: [], changes: [archivedDuplicate()] };
  const card = boardCards([repo], new Map([["demo", 120]]))[0];
  expect(card.column).toBe("Archived");
  const badges = byTag(ChangeCard({ card, now: NOW, from: "/board", stale: staleReason(card) }), "span").filter((s) => String(s.props.class ?? "").includes("stale"));
  expect(badges).toHaveLength(1);
  expect(badges[0].props["aria-label"]).toContain("still committed there too");
});

test("a change stale for leftovers and a duplicate shows one badge naming both reasons", () => {
  const reason = staleReason(archivedDuplicate({ stale: stale([branchLeftover]) }), "main");
  expect(reason?.kind).toBe("leftovers");
  expect(reason?.duplicate).toEqual(duplicate());
  expect(reason?.title).toBe("Stale: archived and merged on main, while 1 branch is left over; and openspec/changes/rotate-keys/ is still committed next to its archive on main");
});

test("the duplicate notice offers Remove duplicate, or says why not, or what to do by hand", () => {
  const offered = duplicateNotice("rotate-keys", duplicate(), { sessionsAvailable: true, running: false }, "main");
  expect(offered.offered).toBe(true);
  expect(offered.text).toBe(
    "Its archive is openspec/changes/archive/2026-10-20-rotate-keys/. The copy differs from the archive in tasks.md. Remove duplicate starts an archive session that asks you what to carry over into the archive, deletes openspec/changes/rotate-keys/ and opens a pull request for main.",
  );
  const branch = duplicateNotice("rotate-keys", duplicate({ archiveBranch: "chore/archive-rotate-keys" }), { sessionsAvailable: true, running: false });
  expect(branch).toEqual({ offered: false, text: expect.stringContaining("not offered while the branch chore/archive-rotate-keys exists: Clean up leftovers… removes it once it is merged.") });
  expect(duplicateNotice("rotate-keys", duplicate(), { sessionsAvailable: true, running: true }).offered).toBe(false);
  const byHand = duplicateNotice("rotate-keys", duplicate({ differing: [], differingCount: 0 }), { sessionsAvailable: false, running: false }, "main");
  expect(byHand).toEqual({
    offered: false,
    text: "Its archive is openspec/changes/archive/2026-10-20-rotate-keys/. The two copies are identical. Delete openspec/changes/rotate-keys/ in a commit: the deletion has to be committed to main.",
  });
  expect(duplicateNotice("rotate-keys", duplicate({ pulled: false, differing: ["a.md"], differingCount: 3 }), { sessionsAvailable: true, running: false }).text).toContain("in a.md and 2 more. ");
  expect(duplicateNotice("rotate-keys", duplicate({ pulled: false }), { sessionsAvailable: true, running: false }).text).toEndWith("Pull brings it.");
});
