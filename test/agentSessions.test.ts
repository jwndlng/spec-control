// Tests for deterministic server-side Ship, auto-ship on session exit, and deterministic Merge (Tasks 3.2, 3.3, 3.4)
import { launchCommand, launchWithoutPrompt, resolveModel, resumeLaunch, withPermissionArgs } from "../src/server/sessions/agents.ts";
import { defaultConfig } from "../src/server/config.ts";
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionActivity } from "../src/server/activity/events.ts";
import type { SessionManager } from "../src/server/sessions/manager.ts";
import { defaultShipTitle } from "../src/server/sessions/manager.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { recordBranchInWorktree } from "../src/server/frameworks/worktreeMetadata.ts";
import type { ChangeSession, PullRequest } from "../src/shared/types.ts";
import { installFakeGh, type GhHarness } from "./ghHelpers.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { fakeProfile, git, harness, waitFor, watch, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

test("permission arguments follow configured launch args and precede the prompt command tail", () => {
  const agent = { id: "codex", name: "Codex", command: ["codex", "exec", "{prompt}"], launchArgs: ["--profile", "work"], prompts: {} };
  const launched = launchCommand(agent, "implement change");
  expect(withPermissionArgs(agent, launched.argv, ["--sandbox", "workspace-write"])).toEqual(["codex", "--profile", "work", "--sandbox", "workspace-write", "exec", "implement change"]);
});

test("Antigravity receives supported mode and sandbox flags without an undocumented settings flag", async () => {
  const h = await harness({ agent: { id: "agy" } });
  managers.push(h.manager);
  h.config.agentSessions.defaultAgent = "agy";
  h.config.agentSessions.defaultPermissionProfile = "less-friction";
  const session = await h.manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  const terminal = await watch(h.manager, session.id);
  await waitFor(() => terminal.text().includes("--mode"), "Antigravity mode flag");
  const args = JSON.parse(/args=(\[[^\n]+?\])/.exec(terminal.text())?.[1] ?? "[]") as string[];
  expect(args).toContain("--sandbox");
  expect(args).not.toContain("--settings");
  await h.manager.submit(session.id, "exit");
  await waitFor(() => h.manager.list().find((item) => item.id === session.id)?.state === "exited", "agent process exit");
  terminal.detach();
});

let cleanup: () => Promise<void>;
let gh: GhHarness;
const managers: SessionManager[] = [];

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  gh = await installFakeGh({});
});

afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  await gh.scenario({});
  await gh.forget();
});

afterAll(async () => {
  gh.restore();
  await cleanup();
});

const IMPLEMENT = "upgrade-runtime";
const ARCHIVE = "confirm-retention";
const DRAFT = "trim-log-noise";

function pr(patch: Partial<PullRequest> & { head: string }): PullRequest {
  return {
    number: 88,
    title: "test pr",
    url: "https://github.com/acme/demo-ops/pull/88",
    author: "octo",
    base: "main",
    draft: false,
    state: "open",
    createdAt: new Date().toISOString(),
    review: "none",
    reviewRequestedFromViewer: false,
    checks: "passing",
    mergeable: "mergeable",
    docsOnly: true,
    ...patch,
  };
}

async function putFile(dir: string, file: string, content = "hello\n"): Promise<void> {
  const full = join(dir, file);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}

async function setupFakeRemote(repoPath: string): Promise<string> {
  const bare = await tempDir("bare-remote-");
  git(bare, "init", "--bare", "-q");
  git(repoPath, "remote", "add", "origin", "https://github.com/acme/demo-ops.git");
  git(repoPath, "config", "remote.origin.pushurl", bare);
  return bare;
}

// ---------------------------------------------------------------------------
// 3.2 Deterministic Ship
// ---------------------------------------------------------------------------

test("defaultShipTitle derives conventional and plain titles for proposal, archive, and feat branches", () => {
  const proposalSession: ChangeSession = {
    id: "s1",
    repoId: "r1",
    change: "rotate-keys",
    action: "draft",
    agentId: "fake",
    agentName: "Fake Agent",
    branch: "docs/rotate-keys",
    createdAt: "",
    updatedAt: "",
    state: "running",
    worktreePath: "/tmp/wt",
    resumable: false,
  };
  expect(defaultShipTitle(proposalSession, "conventional-commits")).toBe("docs(openspec): add rotate-keys");
  expect(defaultShipTitle(proposalSession, undefined)).toBe("Add OpenSpec proposal rotate-keys");

  const archiveSession: ChangeSession = {
    ...proposalSession,
    action: "archive",
    branch: "chore/archive-rotate-keys",
  };
  expect(defaultShipTitle(archiveSession, "conventional-commits")).toBe("chore(openspec): archive rotate-keys");
  expect(defaultShipTitle(archiveSession, undefined)).toBe("Archive OpenSpec change rotate-keys");

  const implementSession: ChangeSession = {
    ...proposalSession,
    action: "implement",
    branch: "feat/rotate-keys",
  };
  expect(defaultShipTitle(implementSession, "conventional-commits")).toBe("feat: rotate-keys");
  expect(defaultShipTitle(implementSession, undefined)).toBe("rotate-keys");

  // Reuses latest commit subject if worktree was already clean and ahead of base
  expect(defaultShipTitle(implementSession, "conventional-commits", "feat(keys): rotate existing keys", true)).toBe("feat(keys): rotate existing keys");
});

test("Ship commits uncommitted changes, pushes branch to origin, and opens PR via gh pr create without agent interaction", async () => {
  const h = await harness();
  h.config.repos[0].prTitleConvention = "conventional-commits";
  await setupFakeRemote(h.repoPath);

  const events: SessionActivity[] = [];
  const manager = h.newManager({ onActivity: (_s, a) => events.push(a) });
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  await putFile(session.worktreePath, `openspec/changes/${IMPLEMENT}/tasks.md`, "- [x] Verified check\n");
  await putFile(session.worktreePath, `openspec/changes/${IMPLEMENT}/pull-request.md`, "  ## Summary\n\nPrepared body.  \n");
  expect(session.branch).toBe(`feat/${IMPLEMENT}`);

  // Add an uncommitted file to the worktree
  await putFile(session.worktreePath, "src/keys.ts", "export const key = '123';\n");

  // Run Ship
  const result = await manager.ship(session.id);
  expect(result.shipped).toBe(true);
  expect(result.pullRequestUrl).toBe("https://github.com/acme/demo-ops/pull/99");
  expect(result.pullRequestNumber).toBe(99);
  expect(result.pullRequestState).toBe("created");

  // Verify .openspec.yaml has recorded branch
  const marker = await Bun.file(join(session.worktreePath, `openspec/changes/${IMPLEMENT}/.openspec.yaml`)).text();
  expect(marker).toContain(`branch: feat/${IMPLEMENT}`);

  // Verify commit was made
  const lastCommit = git(session.worktreePath, "log", "-1", "--format=%s");
  expect(lastCommit).toBe(`feat: ${IMPLEMENT}`);

  // Verify gh pr create was called
  const calls = await gh.calls();
  const prCreate = calls.find((c) => c.argv.includes("create"));
  expect(prCreate).toBeDefined();
  expect(prCreate?.argv).toContain("--repo");
  expect(prCreate?.argv).toContain("acme/demo-ops");
  expect(prCreate?.argv).toContain("--head");
  expect(prCreate?.argv).toContain(`feat/${IMPLEMENT}`);
  expect(prCreate?.argv.slice(prCreate.argv.indexOf("--body") + 1)[0]).toBe("## Summary\n\nPrepared body.");

  // Verify activity event was reported
  expect(events.some((e) => e.kind === "session-shipped")).toBe(true);
});

test("Ship uses a non-empty fallback for blank and unsafe description artifacts", async () => {
  for (const mode of ["blank", "symlink", "directory"] as const) {
    const h = await harness();
    await setupFakeRemote(h.repoPath);
    const manager = h.newManager();
    managers.push(manager);
    const session = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
    await putFile(session.worktreePath, `openspec/changes/${IMPLEMENT}/tasks.md`, "- [x] Verified check\n");
    const description = join(session.worktreePath, `openspec/changes/${IMPLEMENT}/pull-request.md`);
    if (mode === "blank") await writeFile(description, " \n\t");
    if (mode === "symlink") await symlink("../../../../outside.md", description);
    if (mode === "directory") await mkdir(description);
    await putFile(session.worktreePath, "src/keys.ts", "export const v = 3;\n");
    const result = await manager.ship(session.id);
    expect(result.shipped).toBe(true);
    const create = (await gh.calls()).find((call) => call.argv.includes("create"));
    const bodyIndex = create?.argv.indexOf("--body") ?? -1;
    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    expect(create?.argv[bodyIndex + 1]).toBe(`Review the OpenSpec artifacts for ${IMPLEMENT}.`);
  }
});

test("Ship uses the fallback when the description artifact is absent", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);
  const manager = h.newManager();
  managers.push(manager);
  const session = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  await putFile(session.worktreePath, `openspec/changes/${IMPLEMENT}/tasks.md`, "- [x] Verified check\n");
  await putFile(session.worktreePath, "src/keys.ts", "export const v = 4;\n");
  await manager.ship(session.id);
  const create = (await gh.calls()).find((call) => call.argv.includes("create"));
  const bodyIndex = create?.argv.indexOf("--body") ?? -1;
  expect(create?.argv[bodyIndex + 1]).toBe(`Review the OpenSpec artifacts for ${IMPLEMENT}.`);
});

test("Ship on clean unpushed worktree creates no extra commit and pushes existing commit", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);
  const manager = h.newManager();
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  await putFile(session.worktreePath, `openspec/changes/${IMPLEMENT}/tasks.md`, "- [x] Verified check\n");

  // Commit a change directly with custom message
  await recordBranchInWorktree(session.worktreePath, IMPLEMENT, "branch", `feat/${IMPLEMENT}`);
  await putFile(session.worktreePath, "src/keys.ts", "export const v = 1;\n");
  git(session.worktreePath, "add", "-A");
  git(session.worktreePath, "commit", "-m", "feat(keys): custom commit message");
  const headBefore = git(session.worktreePath, "rev-parse", "HEAD");

  // Ship
  const result = await manager.ship(session.id);
  expect(result.shipped).toBe(true);
  const headAfter = git(session.worktreePath, "rev-parse", "HEAD");
  // No extra commit made
  expect(headAfter).toBe(headBefore);

  const calls = await gh.calls();
  const prCreate = calls.find((c) => c.argv.includes("create"));
  expect(prCreate?.argv).toContain("feat(keys): custom commit message");
});

test("Ship reuses existing open pull request from cache if present", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);

  const existing = pr({ number: 42, url: "https://github.com/acme/demo-ops/pull/42", head: `feat/${IMPLEMENT}` });
  const manager = h.newManager({
    listPullRequests: async () => [existing],
  });
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  await putFile(session.worktreePath, `openspec/changes/${IMPLEMENT}/tasks.md`, "- [x] Verified check\n");
  await putFile(session.worktreePath, "src/keys.ts", "export const v = 2;\n");

  const result = await manager.ship(session.id);
  expect(result.shipped).toBe(true);
  expect(result.pullRequestNumber).toBe(42);
  expect(result.pullRequestState).toBe("existing");
  expect(result.pullRequestUrl).toBe("https://github.com/acme/demo-ops/pull/42");

  // gh pr create was NOT called
  const calls = await gh.calls();
  expect(calls.filter((c) => c.argv.includes("create"))).toHaveLength(0);
});

test("Ship reports partial completion when gh returns no valid PR URL", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);
  managers.push(h.manager);
  const session = await h.manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  await putFile(session.worktreePath, `openspec/changes/${IMPLEMENT}/notes.md`, "ready to ship\n");
  await gh.scenario({ createOutput: "not a pull request URL" });
  const result = await h.manager.ship(session.id);
  expect(result).toMatchObject({ shipped: false, submitted: true, pullRequestState: "unavailable" });
  expect(result.pullRequestUrl).toBeUndefined();
  expect(result.shipWarning).toContain("no valid pull request URL");
});

test("Ship records autoMergeAskedAt when only OpenSpec documents changed and autoMergeDocs is on", async () => {
  const h = await harness();
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
  await setupFakeRemote(h.repoPath);

  const manager = h.newManager();
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  await putFile(session.worktreePath, `openspec/changes/${IMPLEMENT}/tasks.md`, "- [x] Verified check\n");
  // Add changes ONLY under openspec/
  await putFile(session.worktreePath, `openspec/changes/${IMPLEMENT}/notes.md`, "some notes\n");

  const result = await manager.ship(session.id);
  expect(result).toMatchObject({ shipped: true, pullRequestState: "created", autoMerge: true });
  expect(result.autoMergeInstructionIncluded).toBe(true);

  const updated = manager.get(session.id) as ChangeSession;
  expect(updated.autoMergeAskedAt).toBeDefined();
});

test("Ship refused when worktree is clean with nothing to ship, or inPlace", async () => {
  const h = await harness();
  const manager = h.newManager();
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  // Discard worktree setup change so worktree is clean
  git(session.worktreePath, "checkout", "--", ".");
  git(session.worktreePath, "clean", "-fd");
  // Worktree is clean and not ahead
  await expect(manager.ship(session.id)).rejects.toMatchObject({ status: 409 });

  const plain = await harness({ git: false });
  const plainManager = plain.newManager();
  managers.push(plainManager);

  const inPlace = await plainManager.open({ repoId: plain.repoId, change: IMPLEMENT, action: "implement" });
  await expect(plainManager.ship(inPlace.id)).rejects.toMatchObject({ status: 409 });
});

// ---------------------------------------------------------------------------
// 3.3 Automatic Ship on Session Exit
// ---------------------------------------------------------------------------

test("Draft session on docs/<change> with autoMergeDocs on automatically ships when required artifacts are done and exitCode is 0", async () => {
  const h = await harness();
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
  await setupFakeRemote(h.repoPath);

  const manager = h.newManager();
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: DRAFT, action: "draft" });
  expect(session.branch).toBe(`docs/${DRAFT}`);

  // Create required artifacts (proposal.md, tasks.md, design.md, specs)
  await putFile(session.worktreePath, `openspec/changes/${DRAFT}/proposal.md`, "# Proposal\n");
  await putFile(session.worktreePath, `openspec/changes/${DRAFT}/tasks.md`, "- [ ] Task 1\n");
  await putFile(session.worktreePath, `openspec/changes/${DRAFT}/design.md`, "# Design\n");
  await putFile(session.worktreePath, `openspec/changes/${DRAFT}/specs/feature/spec.md`, "# Spec\n");

  // Attach watch to see output
  const seen = await watch(manager, session.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "agent start");

  // Agent finishes with exit 0
  manager.write(session.id, "exit\r");
  await waitFor(() => manager.get(session.id).state === "exited", "process exit");

  // Post-exit ship should have pushed and created PR
  await waitFor(async () => {
    const calls = await gh.calls();
    return calls.some((c) => c.argv.includes("create"));
  }, "draft auto-ship");
});

test("Archive session automatically ships on exit 0 once archive directory exists", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);

  const manager = h.newManager();
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: ARCHIVE, action: "archive" });
  await putFile(session.worktreePath, `openspec/changes/${ARCHIVE}/tasks.md`, "- [x] Verified check\n");

  // Move change to archive
  await putFile(session.worktreePath, `openspec/changes/archive/2026-11-01-${ARCHIVE}/proposal.md`, "# Done\n");
  await putFile(session.worktreePath, `openspec/changes/archive/2026-11-01-${ARCHIVE}/.openspec.yaml`, "schema: spec-driven\n");

  const seen = await watch(manager, session.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "agent ready");

  manager.write(session.id, "exit\r");
  await waitFor(() => manager.get(session.id).state === "exited", "exit");

  // Post-exit ship should have pushed and created PR
  await waitFor(async () => {
    const calls = await gh.calls();
    return calls.some((c) => c.argv.includes("create"));
  }, "archive auto-ship");
});

test("Fast-forward session automatically ships on exit 0 when every task is checked", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);

  const manager = h.newManager();
  managers.push(manager);

  const FAST_FORWARD = "add-health-endpoint";
  const session = await manager.open({ repoId: h.repoId, change: FAST_FORWARD, action: "fastForward" });

  // Every task is verified before automatic shipping.
  await putFile(session.worktreePath, `openspec/changes/${FAST_FORWARD}/tasks.md`, "- [x] 1.1 Done task\n- [x] 1.2 Verified check\n");

  const seen = await watch(manager, session.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "agent ready");

  manager.write(session.id, "exit\r");
  await waitFor(() => manager.get(session.id).state === "exited", "exit");

  await waitFor(async () => {
    const calls = await gh.calls();
    return calls.some((c) => c.argv.includes("create"));
  }, "fast-forward auto-ship");
});

// ---------------------------------------------------------------------------
// 3.4 Deterministic Merge
// ---------------------------------------------------------------------------

test("Merge directly executes gh pr merge --squash --match-head-commit without typing into agent", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);

  const headOid = "c0ffee0123456789abcdef0123456789abcdef01";
  const manager = h.newManager();
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  const openPr = pr({
    number: 41,
    head: session.branch as string,
    headOid,
    checks: "passing",
    mergeable: "mergeable",
  });

  const result = await manager.merge(session.id, [openPr]);
  expect(result.merged).toBe(true);
  expect(result.number).toBe(41);
  expect(result.headOid).toBe(headOid);

  // Check gh calls
  const calls = await gh.calls();
  const mergeCall = calls.find((c) => c.argv.includes("merge"));
  expect(mergeCall).toBeDefined();
  expect(mergeCall?.argv).toContain("41");
  expect(mergeCall?.argv).toContain("--repo");
  expect(mergeCall?.argv).toContain("acme/demo-ops");
  expect(mergeCall?.argv).toContain("--squash");
  expect(mergeCall?.argv).toContain("--match-head-commit");
  expect(mergeCall?.argv).toContain(headOid);
  expect(mergeCall?.argv).not.toContain("--delete-branch");
  expect(mergeCall?.argv).not.toContain("--auto");

  // Recorded on session
  const updated = manager.get(session.id) as ChangeSession;
  expect(updated.mergeAsked).toMatchObject({ pr: 41, head: headOid, by: "user" });
});

test("Merge works on exited session directly without requiring resume", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);

  const headOid = "c0ffee0123456789abcdef0123456789abcdef01";
  const manager = h.newManager();
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  manager.write(session.id, "exit\r");
  await waitFor(() => manager.get(session.id).state === "exited", "exit");

  const openPr = pr({
    number: 41,
    head: session.branch as string,
    headOid,
    checks: "passing",
    mergeable: "mergeable",
  });

  // Merge on exited session
  const result = await manager.merge(session.id, [openPr]);
  expect(result.merged).toBe(true);
  expect(result.number).toBe(41);

  const calls = await gh.calls();
  expect(calls.some((c) => c.argv.includes("merge"))).toBe(true);
});

test("requestReadyMerges automatically merges ready docs-only PR directly on server for running or exited session", async () => {
  const h = await harness();
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
  await setupFakeRemote(h.repoPath);

  const manager = h.newManager();
  managers.push(manager);

  const session = await manager.open({ repoId: h.repoId, change: ARCHIVE, action: "archive" });
  await putFile(session.worktreePath, `openspec/changes/${ARCHIVE}/tasks.md`, "- [x] Verified check\n");
  await putFile(session.worktreePath, `openspec/changes/archive/2026-11-01-${ARCHIVE}/proposal.md`, "done\n");
  git(session.worktreePath, "add", "-A");
  git(session.worktreePath, "commit", "-m", `chore: archive ${ARCHIVE}`);
  const tip = git(session.worktreePath, "rev-parse", "HEAD");

  // Mark session as eligible for autoMerge
  (session as ChangeSession).autoMergeAskedAt = new Date().toISOString();

  const openPr = pr({
    number: 88,
    head: session.branch as string,
    headOid: tip,
    checks: "passing",
    mergeable: "mergeable",
    docsOnly: true,
  });

  await manager.requestReadyMerges(h.repoId, [openPr]);

  const calls = await gh.calls();
  const mergeCall = calls.find((c) => c.argv.includes("merge"));
  expect(mergeCall).toBeDefined();
  expect(mergeCall?.argv).toContain("88");
  expect(mergeCall?.argv).toContain(tip);

  const after = manager.get(session.id) as ChangeSession;
  expect(after.mergeAsked).toMatchObject({ pr: 88, head: tip, by: "dashboard" });

  // Second invocation does not duplicate merge
  await gh.forget();
  await manager.requestReadyMerges(h.repoId, [openPr]);
  const secondCalls = await gh.calls();
  expect(secondCalls.filter((c) => c.argv.includes("merge"))).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// 4.1 Zero-token Archive
// ---------------------------------------------------------------------------

test("Zero-token Archive: Done change with complete subState and specsSynced moves change, records archive-branch and ships without agent", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);

  const manager = h.newManager();
  managers.push(manager);

  const ZERO_ARCHIVE = "bump-toolchain";
  const target = h.snapshot.repos[0].changes.find((x) => x.name === ZERO_ARCHIVE);
  if (target) target.specsSynced = true;
  const session = await manager.open({ repoId: h.repoId, change: ZERO_ARCHIVE, action: "archive" });

  // Session should be returned already exited with exitCode 0 and shipped true
  expect(session.state).toBe("exited");
  expect(session.exitCode).toBe(0);
  expect(session.shipped).toBe(true);

  // Active directory should no longer exist in worktree
  const activeExists = await Bun.file(join(session.worktreePath, `openspec/changes/${ZERO_ARCHIVE}/proposal.md`)).exists();
  expect(activeExists).toBe(false);

  // Archive directory should exist with recorded archive-branch
  const today = new Date().toISOString().slice(0, 10);
  const archivedMarker = await Bun.file(join(session.worktreePath, `openspec/changes/archive/${today}-${ZERO_ARCHIVE}/.openspec.yaml`)).text();
  expect(archivedMarker).toContain(`archive-branch: chore/archive-${ZERO_ARCHIVE}`);

  // PR was created via gh pr create
  const calls = await gh.calls();
  expect(calls.some((c) => c.argv.includes("create"))).toBe(true);
});

test("Archive falls back to starting agent process when change is not complete (validate subState)", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);

  const manager = h.newManager();
  managers.push(manager);

  // confirm-retention has subState: validate
  const session = await manager.open({ repoId: h.repoId, change: ARCHIVE, action: "archive" });
  expect(session.state).toBe("running");
  expect(session.shipped).toBeUndefined();

  const seen = await watch(manager, session.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "agent ready");
});


test("custom starts without prompt arguments or typed input and duplicate opens leave it untouched", async () => {
  const h = await harness({ agent: { prompts: {} } });
  managers.push(h.manager);
  const change = h.snapshot.repos[0].changes.find((c) => c.name === IMPLEMENT)!;
  change.blocked = true;
  const opened = await h.manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "custom" });
  const output = await watch(h.manager, opened.id);
  await waitFor(() => output.text().includes("fake-agent ready"), "custom agent ready");
  expect(output.text()).toContain("args=[]");
  expect(opened.branch).toBe(`feat/${IMPLEMENT}`);
  expect(opened.worktreePath).not.toBe(h.repoPath);
  const before = output.text();
  const again = await h.manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "custom" });
  expect(again.id).toBe(opened.id);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(output.text()).toBe(before);
  output.detach();
});

test("custom returns a running proposal session without changing its terminal", async () => {
  const h = await harness();
  managers.push(h.manager);
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
  const draft = await h.manager.open({ repoId: h.repoId, change: DRAFT, action: "draft" });
  expect(draft.branch).toBe(`docs/${DRAFT}`);
  expect((await h.manager.open({ repoId: h.repoId, change: DRAFT, action: "custom" })).id).toBe(draft.id);
});

test("models cascade by starter; fast-forward and consoles use profile/global defaults", () => {
  const config = defaultConfig();
  const agent = fakeProfile({ model: "profile", phaseModels: { draft: "draft-model", implement: "code", validate: "quick", archive: "small" } });
  config.agentSessions.defaultModel = "global";
  for (const action of ["draft", "implement", "validate", "archive"] as const) expect(resolveModel(config, agent, action)).toBe(agent.phaseModels![action]);
  expect(resolveModel(config, agent, "fastForward")).toBe("profile");
  expect(resolveModel(config, agent)).toBe("profile");
  expect(resolveModel(config, fakeProfile(), "draft")).toBe("global");
  delete config.agentSessions.defaultModel;
  expect(resolveModel(config, fakeProfile(), "draft")).toBeUndefined();
});

test("models are whole arguments; placeholders replace literally without changing prompt text", () => {
  const agent = fakeProfile({ command: ["custom", "{prompt}"], launchArgs: ["--verbose"], resumeCommand: ["custom", "resume"] });
  expect(launchCommand(agent, "ask {model}", "x $&").argv).toEqual(["custom", "--model", "x $&", "--verbose", "ask {model}"]);
  expect(launchCommand(agent, "ask").argv).toEqual(["custom", "--verbose", "ask"]);
  expect(resumeLaunch(agent, "small")).toEqual(["custom", "--model", "small", "--verbose", "resume"]);
  expect(launchWithoutPrompt(agent, "small")).toEqual(["custom", "--model", "small", "--verbose"]);
  const custom = { ...agent, command: ["custom", "-m={model}", "{prompt}"] };
  expect(launchCommand(custom, "ask", "$&").argv).toEqual(["custom", "--verbose", "-m=$&", "ask"]);
  expect(launchCommand(custom, "ask").argv).toEqual(["custom", "--verbose", "-m={model}", "ask"]);
  expect(launchCommand({ ...agent, launchArgs: ["--select={model}"] }, "ask", "small").argv).toEqual(["custom", "--select=small", "ask"]);
});

test("session start passes phase model and settings changes leave the running process alone", async () => {
  const h = await harness({ agent: { model: "profile", phaseModels: { implement: "phase" } } });
  managers.push(h.manager);
  h.config.agentSessions.defaultModel = "global";
  const session = await h.manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  const terminal = await watch(h.manager, session.id);
  await waitFor(() => terminal.text().includes("phase"), "model argument");
  expect(terminal.text()).toContain("--model");
  h.config.agentSessions.agents[0].phaseModels!.implement = "updated";
  expect(terminal.text()).not.toContain("updated");
  terminal.detach();
});

test("Fast-forward exits with awaiting tasks without automatically committing, pushing or opening a PR", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);
  const manager = h.newManager();
  managers.push(manager);
  const change = "add-health-endpoint";
  const session = await manager.open({ repoId: h.repoId, change, action: "fastForward" });
  await putFile(session.worktreePath, `openspec/changes/${change}/tasks.md`, "- [x] Built\n- [~] Verify on a real device\n");
  await putFile(session.worktreePath, `openspec/changes/${change}/notes.md`, "ready for review\n");
  const before = git(session.worktreePath, "rev-parse", "HEAD");
  const seen = await watch(manager, session.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "agent ready");
  manager.write(session.id, "exit\r");
  await waitFor(() => manager.get(session.id).state === "exited", "exit");
  await manager.shutdown();
  expect(git(session.worktreePath, "rev-parse", "HEAD")).toBe(before);
  expect((await gh.calls()).some((call) => call.argv.includes("create"))).toBe(false);
  const result = await manager.ship(session.id);
  expect(result).toMatchObject({ shipped: true, submitted: true, taskSummary: { awaiting: ["Verify on a real device"] } });
  expect(await Bun.file(join(session.worktreePath, `openspec/changes/${change}/tasks.md`)).text()).toContain("[~] Verify on a real device");
});

test("a previous docs auto-merge record does not bypass unresolved implementation or archive tasks", async () => {
  for (const action of ["implement", "archive"] as const) {
    const h = await harness();
    h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
    await setupFakeRemote(h.repoPath);
    const manager = h.newManager();
    managers.push(manager);
    const change = action === "archive" ? ARCHIVE : IMPLEMENT;
    const session = await manager.open({ repoId: h.repoId, change, action });
    await putFile(session.worktreePath, `openspec/changes/${change}/tasks.md`, "- [~] Verify on a real device\n");
    git(session.worktreePath, "add", "-A");
    git(session.worktreePath, "commit", "-q", "-m", "docs: record pending device check");
    const head = git(session.worktreePath, "rev-parse", "HEAD");
    (manager.get(session.id) as ChangeSession).autoMergeAskedAt = new Date().toISOString();
    await gh.forget();
    await manager.requestReadyMerges(h.repoId, [pr({ head: session.branch!, headOid: head })]);
    expect((manager.get(session.id) as ChangeSession).mergeAsked).toBeUndefined();
    expect((await gh.calls()).some((call) => call.argv.includes("merge"))).toBe(false);
  }
});

test("Finish tasks persists a task-only request: completing its Fast-forward tasks does not auto-ship, but explicit Ship still works", async () => {
  const h = await harness();
  await setupFakeRemote(h.repoPath);
  const manager = h.newManager();
  managers.push(manager);
  const change = "add-health-endpoint";
  const session = await manager.open({ repoId: h.repoId, change, action: "fastForward" });
  await putFile(session.worktreePath, `openspec/changes/${change}/tasks.md`, "- [ ] Finish check\n");
  const seen = await watch(manager, session.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "agent ready");
  const request = await manager.ship(session.id, { finishTasks: true });
  expect(request).toMatchObject({ shipped: false, submitted: true, autoShipSuppressed: true });
  await putFile(session.worktreePath, `openspec/changes/${change}/tasks.md`, "- [x] Verified check\n");
  const before = git(session.worktreePath, "rev-parse", "HEAD");
  manager.write(session.id, "exit\r");
  await waitFor(() => manager.get(session.id).state === "exited", "exit");
  await manager.shutdown();
  expect(git(session.worktreePath, "rev-parse", "HEAD")).toBe(before);
  expect((await gh.calls()).some((call) => call.argv.includes("create"))).toBe(false);
  const { SessionStore } = await import("../src/server/sessions/store.ts");
  const stored = (await new SessionStore().loadAll()).find((s) => s.id === session.id) as ChangeSession;
  expect(stored.autoShipSuppressed).toBe(true);
  const shipped = await manager.ship(session.id);
  expect(shipped.shipped).toBe(true);
  expect((shipped as ChangeSession).autoShipSuppressed).toBeUndefined();
});

test("Draft startup adds distinct resolved model candidates after the profile prompt", async () => {
  const h = await harness({ agent: { promptSuffixes: { draft: "Keep it concise." }, phaseModels: { draft: "reasoning", implement: "fast" } } });
  managers.push(h.manager);
  const session = await h.manager.open({ repoId: h.repoId, change: DRAFT, action: "draft" });
  const terminal = await watch(h.manager, session.id);
  await waitFor(() => terminal.text().includes("spec-control.implement-model"), "Draft model-choice guidance");
  expect(terminal.text()).toContain("Keep it concise.");
  expect(terminal.text()).toContain("reasoning for work needing deeper reasoning or fast for straightforward work");
  expect(terminal.text()).toContain("without changing any other marker fields");
  terminal.detach();
});

test("Implement uses the scanned per-change model before the phase model, and later scans affect only new sessions", async () => {
  const h = await harness({ agent: { model: "profile", phaseModels: { implement: "phase-model" } } });
  managers.push(h.manager);
  const marker = join(h.repoPath, "openspec", "changes", IMPLEMENT, ".openspec.yaml");
  await writeFile(marker, "schema: spec-driven\ncreated: 2026-11-01\nspec-control:\n  implement-model: recorded-first\n");
  h.snapshot.repos[0] = await scanRepo(h.config.repos[0]);
  const first = await h.manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  const firstTerminal = await watch(h.manager, first.id);
  await waitFor(() => firstTerminal.text().includes("recorded-first"), "recorded Implement model");
  expect(firstTerminal.text()).not.toContain("phase-model");

  await writeFile(marker, "schema: spec-driven\ncreated: 2026-11-01\nspec-control:\n  implement-model: recorded-next\n");
  h.snapshot.repos[0] = await scanRepo(h.config.repos[0]);
  expect(firstTerminal.text()).not.toContain("recorded-next");
  await h.manager.close(first.id);
  firstTerminal.detach();

  const second = await h.manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  const secondTerminal = await watch(h.manager, second.id);
  await waitFor(() => secondTerminal.text().includes("recorded-next"), "updated scanned Implement model");
  expect(secondTerminal.text()).not.toContain("phase-model");
  secondTerminal.detach();
  await h.manager.close(second.id);

  await writeFile(marker, "schema: spec-driven\ncreated: 2026-11-01\nspec-control:\n  implement-model: --dangerously-skip-permissions\n");
  h.snapshot.repos[0] = await scanRepo(h.config.repos[0]);
  const fallback = await h.manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  const fallbackTerminal = await watch(h.manager, fallback.id);
  await waitFor(() => fallbackTerminal.text().includes("phase-model"), "phase model after invalid recorded choice");
  fallbackTerminal.detach();
});
