import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lifecycleContentHash, lifecycleProposalScope, LifecycleCoordinator, LifecycleDeliveryMonitor, readLifecycleDelivery, upsertLifecycleDelivery, writeLifecycleDelivery, type LifecycleEvidence } from "../src/server/lifecycleDelivery.ts";
import type { ChangeSession, ChangeSnapshot, Config, LifecycleDeliveryRecord, ManagedCompletionReport, RepoSnapshot, Session, Snapshot } from "../src/shared/types.ts";
import { defaultAgentSessions, defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { git, tempGitRepo } from "./sessionHelpers.ts";

function record(id: string): LifecycleDeliveryRecord {
  return {
    version: 1, id, projectId: "repo", projectPath: "/repo", projectIncarnation: "project-v1", change: "sample",
    changeIncarnation: "change-v1", phase: "proposal", revision: 1, actionId: "action", completionRevision: 1, sessionId: "session",
    worktreePath: "/worktree", branch: "docs/sample", contentHash: "content-sha256", snapshotHash: "sha256", state: "pending", recovery: ["retry"],
    createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z", attempts: 0,
  };
}

describe("lifecycle delivery persistence", () => {
  test("atomically saves and reloads versioned checkpoint evidence", async () => {
    const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-"));
    try {
      const path = join(home, "state.json");
      await writeLifecycleDelivery([record("one")], path);
      expect(await readLifecycleDelivery(path)).toEqual([record("one")]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("serializes concurrent updates without losing records", async () => {
    const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-"));
    try {
      const path = join(home, "state.json");
      await Promise.all(Array.from({ length: 12 }, (_, i) => upsertLifecycleDelivery(record(String(i)), path)));
      expect((await readLifecycleDelivery(path)).map(({ id }) => id).sort()).toEqual(Array.from({ length: 12 }, (_, i) => String(i)).sort());
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("ignores legacy and malformed records rather than granting them delivery authority", async () => {
    const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-"));
    try {
      const path = join(home, "state.json");
      await writeFile(path, JSON.stringify({ version: 0, records: [{ id: "old" }] }));
      expect(await readLifecycleDelivery(path)).toEqual([]);
      await writeFile(path, JSON.stringify({ version: 1, records: [{ ...record("valid"), state: "future-state" }, record("current")] }));
      expect(await readLifecycleDelivery(path)).toEqual([record("current")]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("migrates blocked retries that already report merged work to terminal merged state", async () => {
    const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-"));
    try {
      const path = join(home, "state.json");
      const blocked: LifecycleDeliveryRecord = { ...record("merged-retry"), state: "blocked", blocker: "there is nothing to ship (merged)", recovery: ["retry"] };
      await writeLifecycleDelivery([blocked], path);
      const monitor = new LifecycleDeliveryMonitor({
        getConfig: () => defaultConfig(),
        getSnapshot: () => ({ repos: [], generatedAt: "2026-11-16T00:00:00.000Z" }),
        listSessions: () => [],
        completion: () => undefined,
        readReports: async () => undefined,
      }, path);
      await monitor.init();
      expect(monitor.list()).toMatchObject([{ state: "merged", recovery: [] }]);
      expect(await readLifecycleDelivery(path)).toMatchObject([{ state: "merged", recovery: [] }]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("recovers an interrupted delivery only when the session has the matching uncertain Ship operation", async () => {
    const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-"));
    try {
      const path = join(home, "state.json");
      await writeLifecycleDelivery([{ ...record("recovery"), state: "committing" }], path);
      const session: ChangeSession = {
        id: "session", repoId: "repo", change: "sample", action: "draft", agentId: "codex", agentName: "Codex",
        createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z", state: "exited", exitCode: null,
        worktreePath: "/worktree", branch: "docs/sample", resumable: true, managedActionId: "action",
        shipOperation: { operationId: "op", checkpointId: "recovery", state: "unknown", stage: "pushing", startedAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:01.000Z", committed: true, pushed: false },
      };
      const config = { ...defaultConfig(), repos: [] };
      const monitor = new LifecycleDeliveryMonitor({
        getConfig: () => config, getSnapshot: () => ({ repos: [], generatedAt: "2026-11-16T00:00:00.000Z" }), listSessions: () => [session], completion: () => undefined, readReports: async () => {},
      }, path);
      await monitor.init();
      expect(monitor.list()).toMatchObject([{ id: "recovery", state: "pending", blocker: expect.stringContaining("interrupted") }]);
      const mismatched = { ...session, shipOperation: { ...session.shipOperation!, checkpointId: "different" } };
      const blockedMonitor = new LifecycleDeliveryMonitor({
        getConfig: () => config, getSnapshot: () => ({ repos: [], generatedAt: "2026-11-16T00:00:00.000Z" }), listSessions: () => [mismatched], completion: () => undefined, readReports: async () => {},
      }, path);
      await writeLifecycleDelivery([{ ...record("recovery"), state: "committing" }], path);
      await blockedMonitor.init();
      expect(blockedMonitor.list()).toMatchObject([{ id: "recovery", state: "blocked", blocker: expect.stringContaining("without a matching persisted operation identity") }]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("lifecycle completion observation", () => {
  test("skips Git-backed observation quietly when Git is unavailable", async () => {
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = "";
      expect(await lifecycleContentHash("/missing-worktree")).toBeUndefined();
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  const evidence = (overrides: Partial<LifecycleEvidence> = {}): LifecycleEvidence => ({
    sessionId: "session", actionId: "action", action: "draft", processRunning: true, completionReported: true,
    cleanExitFallback: false, historical: false, requiredArtifactsReady: true, tasksVerified: false,
    allTasksChecked: false, archiveIdentityMatches: false, activeChangeExists: false, snapshotHash: "snapshot-a", observedAt: 1,
    ...overrides,
  });

  test("requires current completion and two identical snapshots for a live Draft", () => {
    const coordinator = new LifecycleCoordinator();
    expect(coordinator.observe(evidence({ completionReported: false }))).toMatchObject({ stable: false, reason: "awaiting completion of the current managed action" });
    expect(coordinator.observe(evidence())).toMatchObject({ stable: false, phase: "proposal" });
    expect(coordinator.observe(evidence({ observedAt: 2 }))).toMatchObject({ stable: true, phase: "proposal", snapshotHash: "snapshot-a" });
    expect(coordinator.observe(evidence({ snapshotHash: "snapshot-b" }))).toMatchObject({ stable: false, reason: "waiting for a second matching snapshot" });
  });

  test("does not bootstrap history and gates implementation and archive on their evidence", () => {
    const coordinator = new LifecycleCoordinator();
    expect(coordinator.observe(evidence({ historical: true }))).toMatchObject({ stable: false, reason: "historical work is display-only" });
    expect(coordinator.observe(evidence({ action: "implement" }))).toMatchObject({ stable: false, phase: "implementation", reason: "implementation tasks are not all verified complete" });
    expect(coordinator.observe(evidence({ action: "archive", archiveIdentityMatches: true, activeChangeExists: true }))).toMatchObject({ stable: false, phase: "archive" });
    expect(coordinator.observe(evidence({ action: "archive", archiveIdentityMatches: true, tasksVerified: false, activeChangeExists: false }))).toMatchObject({ stable: false, reason: "archived tasks are not all verified complete or explicitly accepted unresolved" });
    expect(coordinator.observe(evidence({ action: "archive", archiveIdentityMatches: true, tasksVerified: true, allTasksChecked: true, activeChangeExists: false }))).toMatchObject({ stable: false, phase: "archive" });
    expect(coordinator.observe(evidence({ action: "archive", archiveIdentityMatches: true, tasksVerified: true, allTasksChecked: true, activeChangeExists: false, observedAt: 2 }))).toMatchObject({ stable: true, phase: "archive" });
  });

  test("accepts a clean-exit fallback only after the process ends", () => {
    const coordinator = new LifecycleCoordinator();
    expect(coordinator.observe(evidence({ completionReported: false, cleanExitFallback: true }))).toMatchObject({ stable: false, reason: "awaiting completion of the current managed action" });
    expect(coordinator.observe(evidence({ completionReported: false, cleanExitFallback: true, processRunning: false }))).toMatchObject({ stable: false, phase: "proposal" });
    expect(coordinator.observe(evidence({ completionReported: false, cleanExitFallback: true, processRunning: false, observedAt: 2 }))).toMatchObject({ stable: true, phase: "proposal" });
  });

  test("an unresolved archive is withheld until the current action explicitly accepts publication", () => {
    const coordinator = new LifecycleCoordinator();
    const unresolved = evidence({ action: "archive", archiveIdentityMatches: true, activeChangeExists: false, tasksVerified: true, allTasksChecked: false });
    expect(coordinator.observe(unresolved)).toMatchObject({ stable: false, reason: "archived tasks are not all verified complete or explicitly accepted unresolved" });
    const accepted = { ...unresolved, unresolvedArchiveAccepted: true };
    expect(coordinator.observe(accepted)).toMatchObject({ stable: false, phase: "archive" });
    expect(coordinator.observe({ ...accepted, observedAt: 2 })).toMatchObject({ stable: true, phase: "archive", acceptedUnresolvedTasks: true });
  });

  test("monitor delivers once only after current completion and two stable snapshots", async () => {
    const repoPath = await tempGitRepo();
    const home = await mkdtemp(join(tmpdir(), "lifecycle-monitor-"));
    try {
      const repo = newRepoConfig(repoPath, true);
      const config = { ...defaultConfig(), repos: [repo], agentSessions: { ...defaultAgentSessions(), enabled: true } } satisfies Config;
      const session: ChangeSession = {
        id: "00000000-0000-4000-8000-000000000001", repoId: repo.id, change: "trim-log-noise", action: "draft",
        managedActionId: "12345678901234567890", state: "running", exitCode: undefined, worktreePath: repoPath,
        branch: "docs/trim-log-noise", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        agentId: "codex", agentName: "Codex", resumable: true,
      };
      const sessions: Session[] = [];
      let completion: ManagedCompletionReport | undefined;
      let delivered = 0;
      const change = {
        repoId: repo.id, name: session.change, schema: "spec-driven", artifacts: [{ id: "tasks", status: "done", required: true }],
        tasks: null, created: "2026-11-01", stage: "ready", column: "Ready",
      };
      const repoSnapshot = { id: repo.id, name: repo.name, path: repoPath, ok: true, isGit: true, changes: [change] } as RepoSnapshot;
      const snapshot: Snapshot = { generatedAt: new Date().toISOString(), repos: [repoSnapshot] };
      const path = join(home, "lifecycle.json");
      const monitor = new LifecycleDeliveryMonitor({
        getConfig: () => config,
        getSnapshot: () => snapshot,
        listSessions: () => sessions,
        completion: () => completion,
        readReports: async () => undefined,
        deliver: async () => { delivered++; return { pullRequestUrl: "https://github.com/acme/sample/pull/1", pullRequestNumber: 1 }; },
      }, path);
      sessions.push(session);
      await monitor.observe(snapshot);
      expect(monitor.list()).toHaveLength(0);
      completion = { kind: "phase-complete", actionId: "stale-action-id-123456", phase: "draft", revision: 1 };
      await monitor.observe(snapshot);
      expect(monitor.list()).toHaveLength(0);
      completion = { kind: "phase-complete", actionId: session.managedActionId!, phase: "draft", revision: 1 };
      await monitor.observe(snapshot);
      expect(delivered).toBe(0);
      expect(monitor.list()).toHaveLength(0);
      await monitor.observe(snapshot);
      expect(monitor.list()).toMatchObject([{ phase: "proposal", state: "waiting-to-merge", branch: session.branch, revision: 1 }]);
      await monitor.observe(snapshot);
      expect(delivered).toBe(1);
      expect(await readLifecycleDelivery(path)).toEqual(monitor.list());
      await writeFile(join(repoPath, "late-work.txt"), "not authorized by the completed report");
      await monitor.observe(snapshot);
      await monitor.observe(snapshot);
      expect(delivered).toBe(1);
      expect(monitor.list()).toHaveLength(1);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(dirname(repoPath), { recursive: true, force: true });
    }
  });

  test("monitor never turns sessions present at startup into historical delivery requests", async () => {
    const repoPath = await tempGitRepo();
    const home = await mkdtemp(join(tmpdir(), "lifecycle-monitor-"));
    try {
      const repo = newRepoConfig(repoPath, true);
      const config = { ...defaultConfig(), repos: [repo], agentSessions: { ...defaultAgentSessions(), enabled: true } } satisfies Config;
      const session: ChangeSession = {
        id: "00000000-0000-4000-8000-000000000002", repoId: repo.id, change: "trim-log-noise", action: "draft",
        managedActionId: "12345678901234567890", state: "exited", exitCode: 0, worktreePath: repoPath,
        branch: "docs/trim-log-noise", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        agentId: "codex", agentName: "Codex", resumable: true,
      };
      const sessions: Session[] = [session];
      const snapshot: Snapshot = { generatedAt: new Date().toISOString(), repos: [{
        id: repo.id, name: repo.name, path: repoPath, ok: true, isGit: true,
        changes: [{ repoId: repo.id, name: session.change, schema: "spec-driven", artifacts: [{ id: "tasks", status: "done", required: true }], tasks: null, created: "2026-11-01", stage: "ready", column: "Ready" }],
      } as RepoSnapshot] };
      const monitor = new LifecycleDeliveryMonitor({
        getConfig: () => config, getSnapshot: () => snapshot, listSessions: () => sessions,
        completion: () => undefined, readReports: async () => undefined,
      }, join(home, "lifecycle.json"));
      await monitor.observe(snapshot);
      await monitor.observe(snapshot);
      expect(monitor.list()).toHaveLength(0);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(dirname(repoPath), { recursive: true, force: true });
    }
  });

  test("monitor records unavailable when Ship cannot provide a usable GitHub pull-request URL", async () => {
    const repoPath = await tempGitRepo();
    const home = await mkdtemp(join(tmpdir(), "lifecycle-monitor-"));
    try {
      const repo = newRepoConfig(repoPath, true);
      const config = { ...defaultConfig(), repos: [repo], agentSessions: { ...defaultAgentSessions(), enabled: true } } satisfies Config;
      const session: ChangeSession = {
        id: "00000000-0000-4000-8000-000000000005", repoId: repo.id, change: "trim-log-noise", action: "draft",
        managedActionId: "12345678901234567890", state: "running", worktreePath: repoPath, branch: "docs/trim-log-noise",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), agentId: "codex", agentName: "Codex", resumable: true,
      };
      const sessions: Session[] = [];
      const snapshot: Snapshot = { generatedAt: new Date().toISOString(), repos: [{
        id: repo.id, name: repo.name, path: repoPath, ok: true, isGit: true,
        changes: [{ repoId: repo.id, name: session.change, schema: "spec-driven", artifacts: [{ id: "tasks", status: "done", required: true }], tasks: null, created: "2026-11-01", stage: "ready", column: "Ready" }],
      } as RepoSnapshot] };
      const monitor = new LifecycleDeliveryMonitor({
        getConfig: () => config, getSnapshot: () => snapshot, listSessions: () => sessions,
        completion: () => ({ kind: "phase-complete", actionId: session.managedActionId!, phase: "draft", revision: 1 }),
        readReports: async () => undefined, deliver: async () => ({}),
      }, join(home, "lifecycle.json"));
      sessions.push(session);
      await monitor.observe(snapshot);
      await monitor.observe(snapshot);
      expect(monitor.list()).toMatchObject([{ phase: "proposal", state: "unavailable", blocker: expect.any(String), recovery: ["retry"] }]);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(dirname(repoPath), { recursive: true, force: true });
    }
  });

  test("monitor records implementation only with all checked tasks and archive only after identity moves", async () => {
    const repoPath = await tempGitRepo();
    const home = await mkdtemp(join(tmpdir(), "lifecycle-monitor-"));
    try {
      const repo = newRepoConfig(repoPath, true);
      const config = { ...defaultConfig(), repos: [repo], agentSessions: { ...defaultAgentSessions(), enabled: true } } satisfies Config;
      const makeSession = (id: string, action: ChangeSession["action"]): ChangeSession => ({
        id, repoId: repo.id, change: "trim-log-noise", action, managedActionId: `${id}-managed-action-id`, state: "running",
        worktreePath: repoPath, branch: action === "draft" ? "docs/trim-log-noise" : "feat/trim-log-noise",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), agentId: "codex", agentName: "Codex", resumable: true,
      });
      const sessions: Session[] = [];
      let completion: ManagedCompletionReport | undefined;
      let entry: ChangeSnapshot = {
        repoId: repo.id, name: "trim-log-noise", schema: "spec-driven", artifacts: [{ id: "tasks", status: "done", required: true }],
        tasks: { done: 1, total: 1 }, created: "2026-11-01", stage: "done", column: "Done",
      };
      const snapshot: Snapshot = { generatedAt: new Date().toISOString(), repos: [{ id: repo.id, name: repo.name, path: repoPath, ok: true, isGit: true, changes: [entry] } as RepoSnapshot] };
      const monitor = new LifecycleDeliveryMonitor({
        getConfig: () => config, getSnapshot: () => snapshot, listSessions: () => sessions,
        completion: () => completion, readReports: async () => undefined,
      }, join(home, "lifecycle.json"));
      const implementing = makeSession("00000000-0000-4000-8000-000000000003", "implement");
      sessions.push(implementing);
      completion = { kind: "phase-complete", actionId: implementing.managedActionId!, phase: "implement", revision: 1 };
      await monitor.observe(snapshot);
      await monitor.observe(snapshot);
      expect(monitor.list()).toMatchObject([{ phase: "implementation", state: "pending" }]);

      sessions.splice(0, sessions.length);
      const archiving = makeSession("00000000-0000-4000-8000-000000000004", "archive");
      sessions.push(archiving);
      completion = { kind: "phase-complete", actionId: archiving.managedActionId!, phase: "archive", revision: 1 };
      entry = { ...entry, stage: "archived", column: "Archived", archived: "2026-11-16" };
      (snapshot.repos[0] as RepoSnapshot).changes = [entry];
      const active = join(repoPath, "openspec/changes/trim-log-noise");
      const archived = join(repoPath, "openspec/changes/archive/2026-11-16-trim-log-noise");
      await rm(active, { recursive: true, force: true });
      await mkdir(archived, { recursive: true });
      await monitor.observe(snapshot);
      await monitor.observe(snapshot);
      expect(monitor.list()).toMatchObject([{ phase: "implementation" }, { phase: "archive", state: "pending" }]);

      const unresolved = makeSession("00000000-0000-4000-8000-000000000005", "archive");
      unresolved.unresolvedArchiveAcceptedActionId = undefined;
      sessions.splice(0, sessions.length, unresolved);
      completion = { kind: "phase-complete", actionId: unresolved.managedActionId!, phase: "archive", revision: 1 };
      entry = { ...entry, tasks: { done: 1, total: 2 } };
      (snapshot.repos[0] as RepoSnapshot).changes = [entry];
      await writeFile(join(archived, "tasks.md"), "- [x] verified\n- [ ] unresolved\n");
      await monitor.observe(snapshot);
      await monitor.observe(snapshot);
      expect(monitor.list()).toHaveLength(2);

      unresolved.unresolvedArchiveAcceptedActionId = unresolved.managedActionId;
      await monitor.observe(snapshot);
      await monitor.observe(snapshot);
      expect(monitor.list()).toMatchObject([{ phase: "implementation" }, { phase: "archive", state: "pending" }, { phase: "archive", acceptedUnresolvedTasks: true }]);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(dirname(repoPath), { recursive: true, force: true });
    }
  });
});

describe("proposal delivery scope", () => {
  test("allows only the proposal's own change files, including committed work and rename sources", async () => {
    const repoPath = await tempGitRepo();
    const home = await mkdtemp(join(tmpdir(), "lifecycle-scope-"));
    try {
      const base = git(repoPath, "rev-parse", "HEAD");
      await mkdir(join(repoPath, "openspec/changes/trim-log-noise"), { recursive: true });
      await writeFile(join(repoPath, "openspec/changes/trim-log-noise/proposal.md"), "# proposal\n");
      expect(await lifecycleProposalScope(repoPath, base, "trim-log-noise")).toMatchObject({ allowed: true });
      await writeFile(join(repoPath, "src-app.ts"), "export {};\n");
      expect(await lifecycleProposalScope(repoPath, base, "trim-log-noise")).toMatchObject({ allowed: false, paths: ["openspec/changes/trim-log-noise/proposal.md", "src-app.ts"] });
      await rm(join(repoPath, "src-app.ts"));
      git(repoPath, "add", "openspec/changes/trim-log-noise/proposal.md");
      git(repoPath, "commit", "-m", "proposal");
      expect(await lifecycleProposalScope(repoPath, base, "trim-log-noise")).toMatchObject({ allowed: true, paths: ["openspec/changes/trim-log-noise/proposal.md"] });
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(dirname(repoPath), { recursive: true, force: true });
    }
  });
});
