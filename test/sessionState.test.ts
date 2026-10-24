import { expect, test } from "bun:test";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import type { ChangeSession, ChangeSnapshot, PullRequest } from "../src/shared/types.ts";
import { cardSessionControls, pullRequestSession } from "../src/ui/sessionState.ts";
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
