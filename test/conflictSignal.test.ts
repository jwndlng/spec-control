// The one rule that says whether Resolve conflicts is offered: the local merge-tree signal, GitHub's mergeability, or both.
import { expect, test } from "bun:test";
import { conflictSignal } from "../src/shared/conflictSignal.ts";
import type { PullRequest, SessionWorktree } from "../src/shared/types.ts";

const A = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const B = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const FETCHED = "2026-10-20T08:00:00.000Z";

const pr = (patch: Partial<PullRequest> = {}): PullRequest => ({
  number: 88,
  title: "rotate keys",
  url: "https://github.com/acme/demo-ops/pull/88",
  author: "octo",
  head: "feat/rotate-keys",
  base: "main",
  draft: false,
  state: "open",
  createdAt: "2026-10-19T08:00:00.000Z",
  review: "none",
  reviewRequestedFromViewer: false,
  checks: "passing",
  mergeable: "conflicting",
  headOid: A,
  ...patch,
});

type Tree = Pick<SessionWorktree, "branch" | "work" | "head" | "name">;
const tree = (patch: Partial<Tree> = {}): Tree => ({ name: "rotate-keys", branch: "feat/rotate-keys", head: A, work: { state: "pushed", base: "origin/main" }, ...patch });
const conflicting = (patch: Partial<Tree> = {}) => tree({ work: { state: "pushed", base: "origin/main", conflicts: { base: "origin/main", files: ["keys.ts"] } }, ...patch });

test("local only: the worktree's merge-tree conflict, with no pull request", () => {
  const w = conflicting();
  expect(conflictSignal([w], undefined)).toEqual({ local: { base: "origin/main", files: ["keys.ts"] }, worktree: w });
});

test("GitHub only: a conflicting open pull request and a worktree that merges cleanly as of the last fetch", () => {
  const w = tree();
  const signal = conflictSignal([w], pr(), FETCHED);
  expect(signal?.local).toBeUndefined();
  expect(signal?.github).toEqual({ number: 88, head: "feat/rotate-keys", base: "main", at: FETCHED });
  expect(signal?.worktree).toBe(w);
});

test("GitHub only, with no worktree at all: offered, and nowhere to run yet", () => {
  const signal = conflictSignal([], pr(), FETCHED);
  expect(signal?.github?.number).toBe(88);
  expect(signal?.worktree).toBeUndefined();
  expect(signal?.pullRequest?.number).toBe(88);
});

test("both agreeing: one signal carrying both", () => {
  const signal = conflictSignal([conflicting()], pr(), FETCHED);
  expect(signal?.local?.files).toEqual(["keys.ts"]);
  expect(signal?.github?.number).toBe(88);
});

test("both disagreeing: still offered, each side as it is", () => {
  // Local conflict, GitHub mergeable: the local base may be ahead of what GitHub last computed.
  expect(conflictSignal([conflicting()], pr({ mergeable: "mergeable" }))).toMatchObject({ local: { base: "origin/main" } });
  expect(conflictSignal([conflicting()], pr({ mergeable: "mergeable" }))?.github).toBeUndefined();
  // GitHub conflicting, local clean: GitHub's base may be ahead of the user's last fetch.
  expect(conflictSignal([tree()], pr())).toMatchObject({ github: { number: 88 } });
});

test("push pending: the worktree's HEAD is not the pull request's head commit", () => {
  expect(conflictSignal([tree({ head: B })], pr())?.github?.pushPending).toBe(true);
  expect(conflictSignal([tree({ head: A })], pr())?.github?.pushPending).toBeUndefined();
  // Without a head commit on either side there is nothing to compare.
  expect(conflictSignal([tree({ head: undefined })], pr())?.github?.pushPending).toBeUndefined();
  expect(conflictSignal([tree({ head: B })], pr({ headOid: undefined }))?.github?.pushPending).toBeUndefined();
});

test("neither: nothing to resolve", () => {
  expect(conflictSignal([tree()], pr({ mergeable: "mergeable" }))).toBeUndefined();
  expect(conflictSignal([tree()], pr({ mergeable: "unknown" }))).toBeUndefined();
  expect(conflictSignal([tree()], undefined)).toBeUndefined();
  expect(conflictSignal([], undefined)).toBeUndefined();
});

test("a draft pull request that conflicts counts", () => {
  expect(conflictSignal([], pr({ draft: true }))?.github?.number).toBe(88);
});

test("a merged pull request is no GitHub signal, and does not hide the local one", () => {
  expect(conflictSignal([tree()], pr({ state: "merged" }))).toBeUndefined();
  const w = conflicting({ branch: "chore/archive-rotate-keys", name: "archive-rotate-keys" });
  expect(conflictSignal([w], pr({ state: "merged" }))).toEqual({ local: { base: "origin/main", files: ["keys.ts"] }, worktree: w });
});

test("a worktree on another branch than the open pull request's head is not where its conflict is", () => {
  const other = conflicting({ branch: "wip/rotate-keys-spike" });
  // Its local conflict is about another branch: only GitHub's signal holds, and there is no worktree for it.
  const signal = conflictSignal([other], pr());
  expect(signal?.local).toBeUndefined();
  expect(signal?.worktree).toBeUndefined();
  expect(conflictSignal([other], pr({ mergeable: "mergeable" }))).toBeUndefined();
  // The worktree on the head branch is picked from several.
  const right = conflicting();
  expect(conflictSignal([other, right], pr())?.worktree).toBe(right);
});
