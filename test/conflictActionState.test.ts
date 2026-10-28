// Where the change detail offers Resolve conflicts, and what it says about each signal (resolve-pr-conflicts 4.1).
import { expect, test } from "bun:test";
import { conflictAction, conflictLines, resolvable } from "../src/ui/sessionState.ts";
import type { ChangeSession, PullRequest, RepoPullRequests, SessionWorktree } from "../src/shared/types.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const A = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const B = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const change = { repoId: "demo", name: "rotate-keys" };

const pr = (patch: Partial<PullRequest> = {}): PullRequest => ({
  number: 88,
  title: "rotate keys",
  url: "https://github.com/acme/demo-ops/pull/88",
  author: "octo",
  head: "feat/rotate-keys",
  base: "main",
  draft: false,
  state: "open",
  createdAt: "2026-10-23T08:00:00Z",
  review: "none",
  reviewRequestedFromViewer: false,
  checks: "passing",
  mergeable: "conflicting",
  headOid: A,
  ...patch,
});
const lists = (...prs: PullRequest[]): { repos: RepoPullRequests[] } => ({ repos: [{ repoId: "demo", status: "ok", fetchedAt: new Date(NOW - 5 * 60_000).toISOString(), pullRequests: prs }] });
const tree = (patch: Partial<SessionWorktree> = {}): SessionWorktree => ({
  repoId: "demo",
  name: "rotate-keys",
  path: "/h/worktrees/demo/rotate-keys",
  change: "rotate-keys",
  action: "implement",
  branch: "feat/rotate-keys",
  head: A,
  work: { state: "pushed", base: "origin/main" },
  ...patch,
});
const session = (patch: Partial<ChangeSession> = {}): ChangeSession => ({
  id: "s1",
  repoId: "demo",
  change: "rotate-keys",
  action: "implement",
  agentId: "fake",
  agentName: "Fake",
  state: "exited",
  worktreePath: "/h/worktrees/demo/rotate-keys",
  branch: "feat/rotate-keys",
  createdAt: "2026-10-23T08:00:00Z",
  updatedAt: "2026-10-23T08:00:00Z",
  resumable: true,
  ...patch,
});

test("GitHub's signal on an ended session's worktree: offered, sent to that session, said with GitHub's freshness", () => {
  const action = conflictAction(change, [tree({ sessionId: "s1" })], [session()], lists(pr()), NOW);
  expect(action?.sessionId).toBe("s1");
  expect(action?.lines).toEqual(["GitHub reports conflicts with main — as of 5m ago."]);
});

test("no worktree: offered as a new session on the head branch", () => {
  const action = conflictAction(change, [], [], lists(pr()), NOW);
  expect(action?.sessionId).toBeUndefined();
  expect(action?.signal.github?.head).toBe("feat/rotate-keys");
});

test("both signals are said, each with its own freshness; push pending is pointed out", () => {
  const conflicting = tree({ sessionId: "s1", head: B, work: { state: "unpushed", count: 1, base: "origin/main", conflicts: { base: "origin/main", files: ["keys.ts"] } } });
  expect(conflictAction(change, [conflicting], [session()], lists(pr()), NOW)?.lines).toEqual([
    "Conflicts with origin/main — as of your last fetch. Pull to refresh the base.",
    "GitHub reports conflicts with main — as of 5m ago — push pending: this worktree has commits GitHub has not seen.",
  ]);
  expect(conflictLines({ github: { number: 88, head: "feat/rotate-keys", base: "main" } })).toEqual(["GitHub reports conflicts with main — as of the last pull-request refresh."]);
});

test("not offered: nothing to resolve, a running session on another branch, a worktree in the way, an in-place session", () => {
  expect(conflictAction(change, [tree()], [], lists(pr({ mergeable: "mergeable" })), NOW)).toBeUndefined();
  const spike = tree({ branch: "wip/rotate-keys-spike", sessionId: "s1" });
  expect(conflictAction(change, [spike], [session({ state: "running", branch: "wip/rotate-keys-spike" })], lists(pr()), NOW)).toBeUndefined();
  expect(conflictAction(change, [spike], [], lists(pr()), NOW)).toBeUndefined();
  expect(conflictAction(change, [], [session({ inPlace: true, branch: undefined })], lists(pr()), NOW)).toBeUndefined();
  // The archive worktree is not in the way of a pull request on the implementation branch.
  expect(conflictAction(change, [tree({ name: "archive-rotate-keys", branch: "chore/archive-rotate-keys", path: "/h/worktrees/demo/archive-rotate-keys" })], [], lists(pr()), NOW)).toBeDefined();
});

test("the panel's rule is the same: either signal, on the pull request's branch only", () => {
  expect(resolvable(session(), tree(), pr())).toBe(true);
  expect(resolvable(session(), tree(), pr({ mergeable: "mergeable" }))).toBe(false);
  expect(resolvable(session(), tree({ branch: "wip/x", work: { state: "pushed", conflicts: { base: "origin/main", files: ["a"] } } }), pr())).toBe(false);
  expect(resolvable(session(), tree({ work: { state: "pushed", conflicts: { base: "origin/main", files: ["a"] } } }))).toBe(true);
  expect(resolvable(session({ inPlace: true }), tree(), pr())).toBe(false);
});

test("the recorded branch's conflicting pull request is the one followed, over a guessed branch's", () => {
  const recorded = { ...change, recorded: { branch: "fix/rotate-keys" } };
  const guessed = pr({ number: 90, mergeable: "mergeable" });
  const action = conflictAction(recorded, [], [], lists(guessed, pr({ head: "fix/rotate-keys" })), NOW);
  expect(action?.signal.github).toMatchObject({ number: 88, head: "fix/rotate-keys" });
  expect(action?.sessionId).toBeUndefined();
  // Not recorded: the guessed `feat/` branch's pull request decides, and it merges.
  expect(conflictAction(change, [], [], lists(guessed, pr({ head: "fix/rotate-keys" })), NOW)).toBeUndefined();
});

test("a running session on another branch than the pull request's head is not where the console step sends", () => {
  const running = session({ state: "running", branch: "feat/rotate-keys" });
  expect(conflictAction({ ...change, recorded: { branch: "fix/rotate-keys" } }, [tree({ sessionId: "s1" })], [running], lists(pr({ head: "fix/rotate-keys" })), NOW)).toBeUndefined();
});

test("another change's conflicting pull request is not offered for a copy carried along in its worktree (link-only-own-branch)", () => {
  // `rotate-keys` leads from `add-login`'s worktree; the scanner gives it no `branchMatch`, so `#20` is not its own.
  const merged = pr({ number: 10, head: "feat/rotate-keys", state: "merged", mergeable: undefined, mergedAt: "2026-10-22T08:00:00Z" });
  const other = pr({ number: 20, head: "feat/add-login" });
  expect(conflictAction(change, [], [], lists(merged, other), NOW)).toBeUndefined();
  expect(conflictAction({ repoId: "demo", name: "add-login", branchMatch: "feat/add-login" }, [], [], lists(merged, other), NOW)?.signal.github?.head).toBe("feat/add-login");
});
