import { expect, test } from "bun:test";
import { cdCommand, changeRef, checkoutHint, leftoverHint, pendingArchiveHint, splitBranchLabel } from "../src/ui/format.ts";

test("short branch names are not split", () => {
  expect(splitBranchLabel("feat/add-login")).toEqual({ head: "feat/add-login", tail: "" });
  expect(splitBranchLabel("")).toEqual({ head: "", tail: "" });
  expect(splitBranchLabel("a".repeat(20))).toEqual({ head: "a".repeat(20), tail: "" });
});

test("long conventional names keep a readable tail starting at a word boundary", () => {
  expect(splitBranchLabel("feat/introduce-tenant-quota-enforcement")).toEqual({
    head: "feat/introduce-tenant-",
    tail: "quota-enforcement",
  });
  // the default cut lands on the separator itself: it stays with the head
  expect(splitBranchLabel("chore/refresh-cache-warmup-schedule")).toEqual({
    head: "chore/refresh-cache-",
    tail: "warmup-schedule",
  });
});

test("the tail is nudged left to a separator only within the limit", () => {
  // default cut lands inside "subscription"; its start is 3 characters to the left
  expect(splitBranchLabel("feat/bulk-subscription-export").tail).toBe("subscription-export");
  // no separator within 4 characters: cut mid-word at exactly tailLength
  const name = `feat/${"x".repeat(40)}`;
  expect(splitBranchLabel(name).tail).toBe("x".repeat(16));
});

test("head and tail always reassemble to the full name", () => {
  for (const name of ["feat/a", "fix/some_really.long-branch/name-with-many-parts", "release/2026.09.20-hotfix-for-scanner-timeouts", "x".repeat(21)]) {
    const { head, tail } = splitBranchLabel(name);
    expect(head + tail).toBe(name);
  }
});

test("tail length and nudge are configurable", () => {
  expect(splitBranchLabel("feat/abcdefghij", 4, 0)).toEqual({ head: "feat/abcdef", tail: "ghij" });
});

test("checkoutHint says where a change lives and which other checkouts are at a different point", () => {
  const wt = { path: "/w/acme/alpha-infra/.claude/worktrees/audit-trail", branch: "feat/audit-trail", isMain: false };
  expect(checkoutHint({})).toBe("a branch or worktree matches this change");
  expect(checkoutHint({ checkout: { path: "/w/acme/alpha-infra", isMain: true } })).toBe("a branch or worktree matches this change");
  expect(checkoutHint({ checkout: wt })).toBe("lives in worktree /w/acme/alpha-infra/.claude/worktrees/audit-trail");
  expect(
    checkoutHint({
      checkout: wt,
      otherCheckouts: [
        { isMain: true, branch: "main", column: "Drafts" },
        { isMain: false, branch: "wip/old", column: "Ready" },
        { isMain: false, column: "Backlog" },
      ],
    }).split("\n"),
  ).toEqual(["lives in worktree /w/acme/alpha-infra/.claude/worktrees/audit-trail", "also in: main checkout — Drafts", "also in: wip/old — Ready", "also in: detached worktree — Backlog"]);
});

test("the cd command quotes a path only when it needs to", () => {
  expect(cdCommand("/w/acme/alpha-infra")).toBe("cd /w/acme/alpha-infra");
  expect(cdCommand("/w/acme/My Repos/alpha")).toBe(`cd '/w/acme/My Repos/alpha'`);
  expect(cdCommand("/w/acme/it's")).toBe(`cd '/w/acme/it'\\''s'`);
});

test("changeRef joins project and change with a slash and nothing else", () => {
  expect(changeRef("demo-ops", "cloud-deployment")).toBe("demo-ops/cloud-deployment");
  expect(changeRef("alpha-infra", "v1.2_audit-trail")).toBe("alpha-infra/v1.2_audit-trail");
  expect(changeRef("alpha-infra", "add-login")).not.toMatch(/\s/);
});

test("pendingArchiveHint: only for an archive that lives in a linked worktree", () => {
  const worktree = { path: "/w/acme/alpha-infra/.claude/worktrees/archive-audit-trail", branch: "chore/archive-audit-trail", isMain: false };
  const hint = pendingArchiveHint({ archived: "2026-09-20", checkout: worktree, otherCheckouts: [{ branch: "main", isMain: true, column: "Implementing" }] });
  expect(hint?.label).toBe("on chore/archive-audit-trail · not in main checkout");
  expect(hint?.title).toContain("still active in: main checkout — Implementing");
  expect(pendingArchiveHint({ archived: "2026-09-20" })).toBeUndefined();
  expect(pendingArchiveHint({ archived: "2026-09-20", checkout: { path: "/w/acme/alpha-infra", isMain: true } })).toBeUndefined();
  expect(pendingArchiveHint({ archived: null, checkout: worktree })).toBeUndefined();
  expect(pendingArchiveHint({ archived: "2026-09-20", checkout: { ...worktree, branch: undefined } })?.label).toContain("a detached worktree");
});

test("leftoverHint: only for an archive in the main checkout with an active copy left there", () => {
  const main = { path: "/w/acme/alpha-infra", branch: "main", isMain: true, column: "Done" };
  const hint = leftoverHint({ name: "audit-trail", archived: "2026-09-20", otherCheckouts: [main] });
  expect(hint?.label).toBe("active copy left · Done");
  expect(hint?.title).toContain("openspec/changes/audit-trail/");
  expect(hint?.title).toContain("never committed");
  expect(hint?.title).toContain("remove openspec/changes/audit-trail/ to clear this");
  // a main checkout named explicitly is the same; an ordinary archive, a pending archive and an active change are not
  expect(leftoverHint({ name: "audit-trail", archived: "2026-09-20", checkout: { isMain: true }, otherCheckouts: [main] })?.label).toBe("active copy left · Done");
  expect(leftoverHint({ name: "audit-trail", archived: "2026-09-20" })).toBeUndefined();
  expect(leftoverHint({ name: "audit-trail", archived: "2026-09-20", checkout: { isMain: false }, otherCheckouts: [{ ...main, column: "Implementing" }] })).toBeUndefined();
  expect(leftoverHint({ name: "audit-trail", archived: null, checkout: { isMain: true }, otherCheckouts: [{ isMain: false, column: "Drafts" }] })).toBeUndefined();
  expect(leftoverHint({ name: "audit-trail", archived: null, otherCheckouts: [main] })).toBeUndefined();
});

test("leftoverHint: a duplicate after archive is said to be committed, not uncommitted", () => {
  const main = { path: "/w/acme/alpha-infra", branch: "main", isMain: true, column: "Done" };
  const hint = leftoverHint({ name: "audit-trail", archived: "2026-09-20", otherCheckouts: [main], duplicate: {} });
  expect(hint?.label).toBe("active copy left · Done");
  expect(hint?.title).toContain("committed next to its archive on the default branch");
  expect(hint?.title).not.toContain("never committed");
  expect(hint?.title).not.toContain("to clear this");
});
