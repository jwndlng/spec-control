import { expect, test } from "bun:test";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import type { ChangeSession, ChangeSnapshot, PullRequest, SessionWorktree } from "../src/shared/types.ts";
import { cardSessionControls, consoleSteps, endProposalConfirmation, handedOverProposal, mergeControl, mergeNotice, pullRequestSession } from "../src/ui/sessionState.ts";
import { fakeProfile } from "./sessionHelpers.ts";

// The split button a card shows (kanban-board: "A change's actions are one split button"), as the pure rule the card
// and the Console tab both render.
const base = defaultConfig();
const repo = newRepoConfig("/w/acme/demo-ops", true);
const prompts = { draft: "draft {change}", implement: "implement {change}", validate: "validate {change}", archive: "archive {change}" };
const config = { ...base, repos: [repo], agentSessions: { ...base.agentSessions, enabled: true, agents: [fakeProfile({ prompts })], defaultAgent: "fake" } };
const artifacts = (design: "done" | "ready") => [{ id: "proposal", status: "done" as const, required: true }, { id: "tasks", status: "done" as const, required: true }, { id: "design", status: design, required: false }];
const card = (patch: Partial<ChangeSnapshot> & { pullRequest?: PullRequest } = {}) => ({ repoId: repo.id, name: "rotate-keys", stage: "ready" as const, artifacts: artifacts("done"), ...patch });
const pr = (patch: Partial<PullRequest> = {}): PullRequest => ({
  number: 58,
  title: "Rotate keys",
  url: "https://github.com/acme/demo-ops/pull/58",
  author: "someone",
  head: "feat/rotate-keys",
  base: "main",
  draft: false,
  state: "open",
  createdAt: "2026-10-01T10:00:00Z",
  review: "none",
  reviewRequestedFromViewer: false,
  checks: "passing",
  mergeable: "mergeable",
  ...patch,
});
const session = (patch: Partial<ChangeSession> = {}): ChangeSession => ({
  id: "s1",
  repoId: repo.id,
  change: "rotate-keys",
  action: "implement",
  agentId: "fake",
  agentName: "Fake",
  state: "exited",
  exitCode: 0,
  worktreePath: "/w/wt",
  branch: "feat/rotate-keys",
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-01T09:30:00Z",
  resumable: true,
  ...patch,
});

test("a Ready card without a design shows Implement with Draft in the menu", () => {
  const controls = cardSessionControls(config, [], card({ artifacts: artifacts("ready") }));
  expect(controls.main).toEqual({ kind: "start", action: "implement" });
  expect(controls.menu).toEqual([{ kind: "start", action: "draft" }]);
  // With the design written there is nothing else: no arrow part.
  expect(cardSessionControls(config, [], card()).menu).toEqual([]);
});

test("a card whose pull request's checks run shows the waiting label with its starters in the menu", () => {
  const controls = cardSessionControls(config, [session()], card({ stage: "done", subState: "validate", pullRequest: pr({ checks: "pending" }) }));
  expect(controls.main).toEqual({ kind: "waiting", reason: "checks running" });
  expect(controls.menu).toEqual([
    { kind: "start", action: "validate" },
    { kind: "start", action: "archive" },
  ]);
  expect(controls.starters).toEqual(["validate", "archive"]);
});

test("a running session's badge stands in for the whole split button", () => {
  const controls = cardSessionControls(config, [session({ state: "running", exitCode: undefined })], card({ pullRequest: pr() }));
  expect(controls.shown).toHaveLength(1);
  expect(controls.main).toBeUndefined();
  expect(controls.menu).toEqual([]);
});

test("Merge leads to the session whose branch heads the pull request, else to nothing", () => {
  const mine = session();
  const older = session({ id: "s0", createdAt: "2026-09-30T09:00:00Z" });
  const archive = session({ id: "a1", action: "archive", branch: "chore/archive-rotate-keys", createdAt: "2026-10-02T09:00:00Z" });
  expect(pullRequestSession([older, archive, mine], card(), pr())?.id).toBe("s1");
  expect(pullRequestSession([archive], card(), pr())).toBeUndefined();
  expect(pullRequestSession([mine], card({ name: "other" }), pr())).toBeUndefined();
  expect(pullRequestSession([mine], card(), undefined)).toBeUndefined();
  expect(cardSessionControls(config, [], card({ stage: "done", pullRequest: pr() })).main).toEqual({ kind: "pullRequest", step: "merge" });
});

// One console per change (one-console-per-change): the proposal session on docs/<change> is a running session like any
// other on the card, and its console offers the next steps as ending it first.
const proposal = (patch: Partial<ChangeSession> = {}) =>
  session({ id: "p1", action: "draft", branch: "docs/rotate-keys", worktreePath: "/w/docs-rotate-keys", state: "running", exitCode: undefined, autoMergeAskedAt: "2026-10-01T09:05:00Z", ...patch });
const worktree = (path: string, state: SessionWorktree["work"]["state"]): SessionWorktree => ({ repoId: repo.id, change: "rotate-keys", action: "draft", name: path.split("/").pop() as string, path, work: { state } });

test("a running proposal session's card shows its badge and no starter", () => {
  const controls = cardSessionControls(config, [proposal()], card({ artifacts: artifacts("ready") }));
  expect(controls.shown.map((s) => s.id)).toEqual(["p1"]);
  expect([controls.starters, controls.main, controls.menu]).toEqual([[], undefined, []]);
});

test("a proposal console in Ready recommends Implement, as ending the proposal session first", () => {
  const running = proposal();
  const steps = consoleSteps(config, [running], card({ artifacts: artifacts("ready") }), running);
  expect(steps).toEqual({ into: ["draft"], endFirst: ["implement"] });
  // In Drafts it offers Draft alone, sent into it; Fast-forward never ends it.
  expect(consoleSteps(config, [running], card({ stage: "drafts", artifacts: [{ id: "proposal", status: "ready" as const, required: true }] }), running)?.endFirst).not.toContain("fastForward");
  // Any other running session takes every step itself, and an ended one takes none.
  const impl = session({ state: "running", exitCode: undefined });
  expect(consoleSteps(config, [impl], card({ artifacts: artifacts("ready") }), impl)).toEqual({ into: ["draft", "implement"], endFirst: [] });
  expect(consoleSteps(config, [session()], card(), session())).toBeUndefined();
});

test("ending the proposal session asks once only while the proposal is not pushed", () => {
  expect(endProposalConfirmation(worktree("/w/docs-rotate-keys", "uncommitted"))).toContain("not pushed yet");
  expect(endProposalConfirmation(worktree("/w/docs-rotate-keys", "unpushed"))).toContain("worktree and its branch are kept");
  for (const state of ["clean", "pushed", "merged", "missing"] as const) expect(endProposalConfirmation(worktree("/w/docs-rotate-keys", state))).toBeUndefined();
  expect(endProposalConfirmation(undefined)).toBeUndefined();
});

test("the running session's panel offers Merge for the handed-over proposal pull request", () => {
  const ended = proposal({ state: "exited", exitCode: 0 });
  const impl = session({ id: "i1", state: "running", exitCode: undefined, createdAt: "2026-10-01T10:00:00Z" });
  const trees = [worktree("/w/docs-rotate-keys", "pushed")];
  const ready = pr({ number: 90, head: "docs/rotate-keys", headOid: "c0ffee1".padEnd(40, "0") });
  const lists = [{ repoId: repo.id, status: "ok" as const, pullRequests: [ready] }];

  expect(handedOverProposal(impl, [ended, impl], trees)?.id).toBe("p1");
  const merge = mergeControl(impl, lists, handedOverProposal(impl, [ended, impl], trees));
  expect(merge).toMatchObject({ enabled: true, pr: { number: 90 }, recordedOn: { id: "p1" }, title: expect.stringContaining("the proposal's pull request #90 (from docs/rotate-keys)") });
  // The pending wording reads the proposal session's record.
  const asked = { ...ended, mergeAsked: { pr: 90, head: ready.headOid as string, at: "2026-10-01T10:05:00Z", submitted: true, by: "dashboard" as const } };
  expect(mergeNotice(mergeControl(impl, lists, asked)?.recordedOn, ready)?.text).toBe("Asked the agent to merge #90 at c0ffee1.");

  // Not handed over: its worktree is gone, it was ended by the dashboard, it carries no record, or two sessions run.
  expect(handedOverProposal(impl, [ended, impl], [])).toBeUndefined();
  expect(handedOverProposal(impl, [proposal({ state: "exited", autoEnded: { pr: 90, at: "x", removed: true } }), impl], trees)).toBeUndefined();
  expect(handedOverProposal(impl, [proposal({ state: "exited", autoMergeAskedAt: undefined }), impl], trees)).toBeUndefined();
  expect(handedOverProposal(impl, [proposal(), impl], trees)).toBeUndefined();
  // Its own branch's pull request comes first.
  const own = pr({ number: 91, headOid: "b".repeat(40) });
  expect(mergeControl(impl, [{ repoId: repo.id, status: "ok" as const, pullRequests: [own, ready] }], ended)).toMatchObject({ pr: { number: 91 }, recordedOn: { id: "i1" } });
});
