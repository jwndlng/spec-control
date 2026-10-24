// The one rule that ties a cached pull request to a change: exact head branch, own repository, open first.
import { expect, test } from "bun:test";
import { candidateBranches, isProposalPullRequest, linkedPullRequest } from "../src/shared/pullRequestLink.ts";
import type { PullRequest, RepoPullRequests } from "../src/shared/types.ts";

const HOUR = 3600_000;
const at = (hoursAgo: number) => new Date(Date.parse("2026-03-10T12:00:00Z") - hoursAgo * HOUR).toISOString();

const pr = (patch: Partial<PullRequest> & { number: number }): PullRequest => ({
  title: `change ${patch.number}`,
  url: `https://github.com/acme/alpha-infra/pull/${patch.number}`,
  author: "octo",
  head: "feat/add-validate-phase",
  base: "main",
  draft: false,
  state: "open",
  createdAt: at(10),
  review: "none",
  reviewRequestedFromViewer: false,
  checks: "none",
  ...patch,
});

const list = (repoId: string, pullRequests: PullRequest[], patch: Partial<RepoPullRequests> = {}): RepoPullRequests => ({
  repoId,
  github: `acme/${repoId}`,
  status: "ok",
  fetchedAt: at(0),
  pullRequests,
  ...patch,
});

// A name no test branch is derived from, so these cases exercise `branchMatch` alone.
const change = (branchMatch?: string, repoId = "alpha") => ({ repoId, name: "unrelated-change", branchMatch });

test("a pull request whose head branch is exactly the change's branch is its pull request", () => {
  const lists = [list("alpha", [pr({ number: 125 })])];
  expect(linkedPullRequest(change("feat/add-validate-phase"), lists)?.number).toBe(125);
});

test("no pull request for the branch means none", () => {
  expect(linkedPullRequest(change("feat/something-else"), [list("alpha", [pr({ number: 125 })])])).toBeUndefined();
});

test("an off-convention branch name is not matched", () => {
  const lists = [list("alpha", [pr({ number: 125, head: "jan/125-add-validate-phase" })])];
  expect(linkedPullRequest(change("feat/add-validate-phase"), lists)).toBeUndefined();
});

test("name containment is not a match, in either direction", () => {
  const lists = [list("alpha", [pr({ number: 125, head: "feat/add-validate-phase" })])];
  expect(linkedPullRequest(change("feat/add-validate"), lists)).toBeUndefined();
  const shorter = [list("alpha", [pr({ number: 7, head: "feat/add-validate" })])];
  expect(linkedPullRequest(change("feat/add-validate-phase"), shorter)).toBeUndefined();
  // Compared as written: no case folding, no trimming.
  expect(linkedPullRequest(change("Feat/add-validate-phase"), lists)).toBeUndefined();
  expect(linkedPullRequest(change("feat/add-validate-phase "), lists)).toBeUndefined();
});

test("the same branch in another repository is not this change's", () => {
  const lists = [list("beta", [pr({ number: 9 })])];
  expect(linkedPullRequest(change("feat/add-validate-phase", "alpha"), lists)).toBeUndefined();
  expect(linkedPullRequest(change("feat/add-validate-phase", "beta"), lists)?.number).toBe(9);
});

test("an open pull request wins over a merged one, and a draft counts as open", () => {
  const merged = pr({ number: 120, state: "merged", mergedAt: at(1), createdAt: at(50) });
  const open = pr({ number: 125, createdAt: at(30) });
  expect(linkedPullRequest(change("feat/add-validate-phase"), [list("alpha", [merged, open])])?.number).toBe(125);
  expect(linkedPullRequest(change("feat/add-validate-phase"), [list("alpha", [open, merged])])?.number).toBe(125);
  const draft = pr({ number: 126, draft: true, createdAt: at(30) });
  expect(linkedPullRequest(change("feat/add-validate-phase"), [list("alpha", [merged, draft])])?.number).toBe(126);
});

test("of several closed pull requests, the most recently closed is shown", () => {
  const older = pr({ number: 130, state: "closed", closedAt: at(40), createdAt: at(41) });
  const newer = pr({ number: 110, state: "closed", closedAt: at(2), createdAt: at(90) });
  const lists = [list("alpha", [older, newer])];
  expect(linkedPullRequest(change("feat/add-validate-phase"), lists)?.number).toBe(110);
  expect(linkedPullRequest(change("feat/add-validate-phase"), [list("alpha", [newer, older])])?.number).toBe(110);
});

test("a change without a branch has no pull request", () => {
  const lists = [list("alpha", [pr({ number: 125, head: "" })])];
  expect(linkedPullRequest(change(undefined), lists)).toBeUndefined();
  expect(linkedPullRequest(change(""), lists)).toBeUndefined();
});

test("a repository whose pull requests are unavailable links nothing, a failed one keeps its last list", () => {
  const p = pr({ number: 125 });
  expect(linkedPullRequest(change("feat/add-validate-phase"), [list("alpha", [p], { status: "unavailable", reason: "gh is not installed" })])).toBeUndefined();
  expect(linkedPullRequest(change("feat/add-validate-phase"), [list("alpha", [p], { status: "failed", reason: "timed out" })])?.number).toBe(125);
});

test("it is total: empty, missing and older-cache input give undefined rather than throwing", () => {
  expect(linkedPullRequest(change("feat/x"), [])).toBeUndefined();
  expect(linkedPullRequest(change("feat/x"), undefined)).toBeUndefined();
  expect(linkedPullRequest(change(undefined), undefined)).toBeUndefined();
  // What an older cache might hold: entries without fields this version reads, extra fields, holes.
  const odd = [
    { repoId: "alpha", status: "ok", pullRequests: [{ number: 1, title: "old", legacyHeadRefName: "feat/x" }, null, "garbage"] },
    { repoId: "alpha", status: "ok" },
    null,
  ] as unknown as RepoPullRequests[];
  expect(() => linkedPullRequest(change("feat/x"), odd)).not.toThrow();
  expect(linkedPullRequest(change("feat/x"), odd)).toBeUndefined();
  // Unreadable dates do not throw either; the higher number decides.
  const undated = [list("alpha", [pr({ number: 3, state: "closed", createdAt: "not a date" }), pr({ number: 4, state: "closed", createdAt: "" })])];
  expect(linkedPullRequest(change("feat/add-validate-phase"), undated)?.number).toBe(4);
});

test("it is pure: the input is left as it was", () => {
  const lists = [list("alpha", [pr({ number: 120, state: "merged", mergedAt: at(1) }), pr({ number: 125 })])];
  const before = structuredClone(lists);
  linkedPullRequest(change("feat/add-validate-phase"), lists);
  expect(lists).toEqual(before);
});

// ---- candidate branches: `branchMatch` plus the dashboard's own session branches ----

const named = (name: string, patch: { branchMatch?: string; created?: string; repoId?: string } = {}) => ({ repoId: "alpha", name, ...patch });

test("the candidates are branchMatch, then the session branches, without duplicates", () => {
  expect(candidateBranches(named("add-validate-phase"))).toEqual(["feat/add-validate-phase", "chore/archive-add-validate-phase", "docs/add-validate-phase"]);
  expect(candidateBranches(named("add-validate-phase", { branchMatch: "fix/add-validate-phase" }))).toEqual([
    "fix/add-validate-phase",
    "feat/add-validate-phase",
    "chore/archive-add-validate-phase",
    "docs/add-validate-phase",
  ]);
  expect(candidateBranches(named("add-validate-phase", { branchMatch: "feat/add-validate-phase" }))).toEqual(["feat/add-validate-phase", "chore/archive-add-validate-phase", "docs/add-validate-phase"]);
});

test("after its worktree is removed, a change still finds the merged pull request on its session branch", () => {
  const merged = pr({ number: 125, state: "merged", mergedAt: at(1) });
  expect(linkedPullRequest(named("add-validate-phase"), [list("alpha", [merged])])?.number).toBe(125);
});

test("the session branches are exact too: no containment, no off-convention name, no other repository", () => {
  const lists = [list("alpha", [pr({ number: 125, head: "feat/add-validate-phase" }), pr({ number: 131, head: "chore/archive-add-validate-phase" })])];
  expect(linkedPullRequest(named("add-validate", { branchMatch: "feat/add-validate" }), lists)).toBeUndefined();
  expect(linkedPullRequest(named("add-validate"), lists)).toBeUndefined();
  const offConvention = [list("alpha", [pr({ number: 125, head: "jan/125-add-validate-phase" })])];
  expect(linkedPullRequest(named("add-validate-phase", { branchMatch: "feat/add-validate-phase" }), offConvention)).toBeUndefined();
  expect(linkedPullRequest(named("add-validate-phase", { repoId: "beta" }), lists)).toBeUndefined();
});

test("a settled pull request older than the change belongs to an earlier change of that name", () => {
  const old = pr({ number: 90, head: "feat/rotate-keys", state: "merged", mergedAt: "2026-09-10T10:00:00Z", createdAt: "2026-09-08T10:00:00Z" });
  expect(linkedPullRequest(named("rotate-keys", { created: "2026-09-20" }), [list("alpha", [old])])).toBeUndefined();
  const closed = pr({ number: 91, head: "feat/rotate-keys", state: "closed", closedAt: "2026-09-10T10:00:00Z" });
  expect(linkedPullRequest(named("rotate-keys", { created: "2026-09-20" }), [list("alpha", [closed])])).toBeUndefined();
  // Merged the day the change was created, or the evening before in UTC: the day of slack keeps it.
  const sameDay = pr({ number: 92, head: "feat/rotate-keys", state: "merged", mergedAt: "2026-09-20T18:00:00Z" });
  expect(linkedPullRequest(named("rotate-keys", { created: "2026-09-20" }), [list("alpha", [sameDay])])?.number).toBe(92);
  const eveningBefore = pr({ number: 93, head: "feat/rotate-keys", state: "merged", mergedAt: "2026-09-19T22:30:00Z" });
  expect(linkedPullRequest(named("rotate-keys", { created: "2026-09-20" }), [list("alpha", [eveningBefore])])?.number).toBe(93);
  // An open pull request, and a change without a creation date, are never filtered.
  const open = pr({ number: 94, head: "feat/rotate-keys", createdAt: "2026-09-01T10:00:00Z" });
  expect(linkedPullRequest(named("rotate-keys", { created: "2026-09-20" }), [list("alpha", [open])])?.number).toBe(94);
  expect(linkedPullRequest(named("rotate-keys"), [list("alpha", [old])])?.number).toBe(90);
});

test("across candidates: an open archive pull request wins, and once both are merged the later one does", () => {
  const implementation = pr({ number: 125, state: "merged", mergedAt: "2026-10-01T09:00:00Z", createdAt: "2026-09-30T09:00:00Z" });
  const archiveOpen = pr({ number: 131, head: "chore/archive-add-validate-phase", createdAt: "2026-10-01T12:00:00Z" });
  expect(linkedPullRequest(named("add-validate-phase"), [list("alpha", [implementation, archiveOpen])])?.number).toBe(131);
  const archiveMerged = { ...archiveOpen, state: "merged" as const, mergedAt: "2026-10-02T09:00:00Z" };
  expect(linkedPullRequest(named("add-validate-phase"), [list("alpha", [archiveMerged, implementation])])?.number).toBe(131);
  // Merged the other way round, the implementation pull request is the later one.
  const lateImplementation = { ...implementation, mergedAt: "2026-10-03T09:00:00Z" };
  expect(linkedPullRequest(named("add-validate-phase"), [list("alpha", [archiveMerged, lateImplementation])])?.number).toBe(125);
});

// A change that records the branches its pull requests were opened from (pull-requests: the "Recorded branch" step).
const rotate = (recorded?: { branch?: string; archiveBranch?: string }, patch: { branchMatch?: string; created?: string } = {}) => ({ repoId: "alpha", name: "rotate-keys", recorded, ...patch });

test("an off-convention branch that is recorded links its pull request", () => {
  const lists = [list("alpha", [pr({ number: 88, head: "fix/rotate-keys" })])];
  expect(linkedPullRequest(rotate({ branch: "fix/rotate-keys" }), lists)?.number).toBe(88);
  // Unrecorded, the same branch is no candidate.
  expect(linkedPullRequest(rotate(), lists)).toBeUndefined();
});

test("a recorded branch wins over a guessed one, even a merged pull request over an open one", () => {
  const lists = [list("alpha", [pr({ number: 142, head: "fix/rotate-keys", state: "merged", mergedAt: at(5) }), pr({ number: 150, head: "feat/rotate-keys" })])];
  expect(linkedPullRequest(rotate({ branch: "fix/rotate-keys" }), lists)?.number).toBe(142);
});

test("recorded implementation and archive branches: the open archive pull request is shown", () => {
  const lists = [list("alpha", [pr({ number: 142, head: "feat/rotate-keys", state: "merged", mergedAt: "2026-10-01T10:00:00Z" }), pr({ number: 151, head: "chore/archive-rotate-keys" })])];
  expect(linkedPullRequest(rotate({ branch: "feat/rotate-keys", archiveBranch: "chore/archive-rotate-keys" }), lists)?.number).toBe(151);
  const bothMerged = [list("alpha", [pr({ number: 142, head: "feat/rotate-keys", state: "merged", mergedAt: "2026-10-01T10:00:00Z" }), pr({ number: 151, head: "chore/archive-rotate-keys", state: "merged", mergedAt: "2026-10-02T10:00:00Z" })])];
  expect(linkedPullRequest(rotate({ branch: "feat/rotate-keys", archiveBranch: "chore/archive-rotate-keys" }), bothMerged)?.number).toBe(151);
});

test("a recorded branch without a cached pull request falls through to the candidates", () => {
  const lists = [list("alpha", [pr({ number: 150, head: "feat/rotate-keys" })])];
  expect(linkedPullRequest(rotate({ branch: "fix/rotate-keys" }), lists)?.number).toBe(150);
});

test("a reused recorded branch is not inherited, and nothing else is guessed instead", () => {
  const lists = [list("alpha", [pr({ number: 77, head: "fix/rotate-keys", state: "merged", mergedAt: "2026-09-10T10:00:00Z" })])];
  expect(linkedPullRequest(rotate({ branch: "fix/rotate-keys" }, { created: "2026-09-20" }), lists)).toBeUndefined();
});

test("an existing change without a record keeps the exact candidates", () => {
  const lists = [list("alpha", [pr({ number: 150, head: "feat/rotate-keys" })])];
  expect(linkedPullRequest(rotate(undefined, { created: "2026-09-20" }), lists)?.number).toBe(150);
});

test("a recorded branch of another repository's pull request is not linked", () => {
  const lists = [list("beta", [pr({ number: 88, head: "fix/rotate-keys" })])];
  expect(linkedPullRequest(rotate({ branch: "fix/rotate-keys" }), lists)).toBeUndefined();
});

test("candidate branches start with the recorded ones; a malformed record from an older cache is ignored", () => {
  expect(candidateBranches({ name: "rotate-keys", branchMatch: "wip/keys", recorded: { branch: "fix/rotate-keys", archiveBranch: "chore/archive-rotate-keys" } })).toEqual([
    "fix/rotate-keys",
    "chore/archive-rotate-keys",
    "wip/keys",
    "feat/rotate-keys",
    "docs/rotate-keys",
  ]);
  const odd = { name: "rotate-keys", recorded: { branch: 42 } } as unknown as Parameters<typeof candidateBranches>[0];
  expect(candidateBranches(odd)).toEqual(["feat/rotate-keys", "chore/archive-rotate-keys", "docs/rotate-keys"]);
  expect(linkedPullRequest({ ...rotate(), recorded: "fix/rotate-keys" } as unknown as Parameters<typeof linkedPullRequest>[0], [list("alpha", [pr({ number: 150, head: "feat/rotate-keys" })])])?.number).toBe(150);
});

// ---- the proposal pull request (ship-proposals-as-docs-prs) ----

test("an open proposal pull request is linked to its change, marked as the proposal's", () => {
  const proposal = pr({ number: 90, head: "docs/rotate-keys" });
  const linked = linkedPullRequest(named("rotate-keys"), [list("alpha", [proposal])]);
  expect(linked?.number).toBe(90);
  expect(isProposalPullRequest(named("rotate-keys"), linked)).toBe(true);
});

test("once the proposal merged, an open implementation pull request is shown, not marked", () => {
  const proposal = pr({ number: 90, head: "docs/rotate-keys", state: "merged", mergedAt: at(5) });
  const implementation = pr({ number: 94, head: "feat/rotate-keys", createdAt: at(2) });
  const linked = linkedPullRequest(named("rotate-keys"), [list("alpha", [proposal, implementation])]);
  expect(linked?.number).toBe(94);
  expect(isProposalPullRequest(named("rotate-keys"), linked)).toBe(false);
  expect(isProposalPullRequest(named("rotate-keys"), undefined)).toBe(false);
});

test("a proposal branch is compared exactly: containment is still not a match", () => {
  expect(linkedPullRequest(named("rotate"), [list("alpha", [pr({ number: 90, head: "docs/rotate-keys" })])])).toBeUndefined();
  expect(isProposalPullRequest(named("rotate"), pr({ number: 90, head: "docs/rotate-keys" }))).toBe(false);
});
