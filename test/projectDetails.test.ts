// The repository board header's model (project-overview: "Repository board header", kanban-board: "Actions have their
// own area"): which action groups it offers and how they are described, what its quick view shows and which sections
// its project details overlay holds.
import { expect, test } from "bun:test";
import { defaultConfig } from "../src/server/config.ts";
import type { Config, RepoSnapshot } from "../src/shared/types.ts";
import { ACTION_DESCRIPTIONS, actionGroups, afterBoardDisable, boardSettingsOffered, detailSections, quickViewFacts, sharedConfigAttention } from "../src/ui/projectDetails.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");

function repo(patch: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return { id: "a", name: "alpha-infra", path: "/w/acme/alpha-infra", ok: true, scannedAt: "2026-10-01T00:00:00Z", isGit: true, worktrees: [], changes: [], ...patch };
}

function config(patch: Partial<Config["repos"][number]> = {}): Config {
  return { ...defaultConfig(), repos: [{ id: "a", path: "/w/acme/alpha-infra", name: "alpha-infra", enabled: true, ...patch }] };
}

const shape = (input: Parameters<typeof actionGroups>[0]) => actionGroups(input).map((g) => [g.caption, g.actions.map((a) => a.id)]);

test("a git repository with sessions on offers Agent, Repository and Changes in order, New change last", () => {
  expect(shape({ console: undefined, isGit: true, ok: true })).toEqual([
    ["Agent", ["console"]],
    ["Repository", ["pull", "cleanup"]],
    ["Changes", ["import", "newChange"]],
  ]);
});

test("a folder without git and sessions off shows only Changes, without Import from issues", () => {
  expect(shape({ console: null, isGit: false, ok: true })).toEqual([["Changes", ["newChange"]]]);
});

test("a failed scan keeps the console and drops everything that needs a good scan", () => {
  expect(shape({ console: undefined, isGit: true, ok: false })).toEqual([["Agent", ["console"]]]);
  expect(actionGroups({ console: null, isGit: true, ok: false })).toEqual([]);
});

test("each action is described in one sentence; Pull says it only fast-forwards", () => {
  const actions = actionGroups({ console: undefined, isGit: true, ok: true }).flatMap((g) => g.actions);
  for (const a of actions) expect(a.description).toBe(ACTION_DESCRIPTIONS[a.id]);
  expect(ACTION_DESCRIPTIONS.pull).toBe("Brings the main checkout up to date with its remote by fast-forward only; never merges, rebases or discards work.");
  expect(ACTION_DESCRIPTIONS.console).toMatch(/own folder.*not a change/);
  expect(ACTION_DESCRIPTIONS.cleanup).toMatch(/safe to remove.*confirm/);
  expect(ACTION_DESCRIPTIONS.import).toMatch(/GitHub issues.*changes/);
  expect(ACTION_DESCRIPTIONS.newChange).toMatch(/change directory.*optional prompt/);
});

test("an inactive console says why in its description", () => {
  const [agent] = actionGroups({ console: "agent sessions are off for this project", isGit: true, ok: true });
  expect(agent.actions[0]).toEqual({ id: "console", inactive: "agent sessions are off for this project", description: `Unavailable: agent sessions are off for this project. ${ACTION_DESCRIPTIONS.console}` });
});

test("the shared-config attention marker: unreadable, outdated or orphaned, never when all are in sync", () => {
  expect(sharedConfigAttention(repo())).toBeUndefined();
  expect(sharedConfigAttention(repo({ sharedConfig: { unreadable: false, applied: [{ id: "base", state: "in-sync" }] } }))).toBeUndefined();
  expect(sharedConfigAttention(repo({ sharedConfig: { unreadable: false, applied: [{ id: "base", state: "outdated" }, { id: "security", state: "in-sync" }] } }))).toEqual({
    label: "⚙ shared config needs attention",
    detail: "base is outdated. See Details.",
    tone: "warning",
  });
  expect(sharedConfigAttention(repo({ sharedConfig: { unreadable: false, applied: [{ id: "old", state: "orphaned" }] } }))?.detail).toBe("old is orphaned. See Details.");
  expect(sharedConfigAttention(repo({ sharedConfig: { unreadable: true, applied: [] } }))?.label).toBe("⚙ config unreadable");
});

test("the quick view: checkout summary or branch, PRs for git, the fetch note, no labels or age", () => {
  const main = { path: "/w/acme/alpha-infra", branch: "main", isMain: true };
  const facts = quickViewFacts(repo({ worktrees: [main], hasRemote: true, lastFetchedAt: new Date(NOW - 4 * 60_000).toISOString(), lastUpdatedAt: "2026-09-30T00:00:00Z" }), config(), NOW);
  expect(facts.checkouts).toBe("summary");
  expect(facts.pullRequests).toBe(true);
  expect(facts.fetchNote?.label).toBe("fetched 4m ago");
  expect(Object.keys(facts).sort()).toEqual(["checkouts", "fetchNote", "pullRequests"]);

  expect(quickViewFacts(repo({ currentBranch: "main" }), config(), NOW).checkouts).toBe("branch");
  const plain = quickViewFacts(repo({ isGit: false }), config(), NOW);
  expect(plain).toEqual({ checkouts: "none", pullRequests: false });
  // A failed scan shows no fetch note, as before.
  expect(quickViewFacts(repo({ ok: false, hasRemote: true }), config(), NOW).fetchNote).toBeUndefined();
});

test("overlay sections: only those with something to show, in order", () => {
  expect(detailSections(repo({ isGit: false }), config())).toEqual(["repository"]);
  // No checkout information: no Checkouts section; no labels: no Labels section.
  expect(detailSections(repo({ currentBranch: "main" }), config())).toEqual(["repository", "sync", "pullRequests"]);
  const full = repo({
    worktrees: [{ path: "/w/acme/alpha-infra", branch: "main", isMain: true }],
    sharedConfig: { unreadable: false, applied: [{ id: "base", state: "in-sync" }] },
    detectedLabels: [{ label: "terraform", marker: ".tf files" }],
  });
  expect(detailSections(full, config({ labels: ["client"] }))).toEqual(["repository", "checkouts", "sync", "pullRequests", "sharedConfig", "labels"]);
  expect(detailSections(repo({ sharedConfig: { unreadable: true, applied: [] } }), config())).toContain("sharedConfig");
  expect(detailSections(repo({ sharedConfig: { unreadable: false, applied: [] } }), config())).not.toContain("sharedConfig");
});

test("the board's settings button only for an enabled repository; Disable from the board leads to the overview", () => {
  expect(boardSettingsOffered(config(), "a")).toBe(true);
  expect(boardSettingsOffered(config({ enabled: false }), "a")).toBe(false);
  expect(boardSettingsOffered(config(), "missing")).toBe(false);
  expect(boardSettingsOffered(null, "a")).toBe(false);
  expect(afterBoardDisable("a", "a")).toBe("/");
  expect(afterBoardDisable("b", "a")).toBeUndefined();
});
