import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BackgroundCleanups, INTERRUPTED_REASON } from "../src/server/sessions/backgroundCleanup.ts";
import { createFetchHandler, type AppState } from "../src/server/api.ts";
import { Scanner } from "../src/server/scanner.ts";
import { SessionError, type SessionManager } from "../src/server/sessions/manager.ts";
import { SessionStore } from "../src/server/sessions/store.ts";
import type { ChangeSession } from "../src/shared/types.ts";
import { useTempHome } from "./helpers.ts";
import { git, harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: SessionManager[] = [];
const track = <T extends { manager: SessionManager }>(h: T): T => {
  managers.push(h.manager);
  return h;
};

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

test("BackgroundCleanups unit: records pending, updates to done on completion", async () => {
  const saved: ChangeSession[] = [];
  const cleanups = new BackgroundCleanups(async (s) => {
    saved.push(JSON.parse(JSON.stringify(s)));
  });
  const session: ChangeSession = {
    id: "test-session-1",
    agentId: "fake",
    agentName: "Fake Agent",
    state: "exited",
    worktreePath: "/tmp/wt1",
    resumable: false,
    repoId: "repo-1",
    change: "change-1",
    action: "implement",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let resolveRun!: (outcome: { state: "done"; worktreeRemoved: boolean }) => void;
  const runPromise = new Promise<{ state: "done"; worktreeRemoved: boolean }>((r) => {
    resolveRun = r;
  });

  const pending = await cleanups.start(session, "worktree", () => runPromise);
  expect(pending.state).toBe("pending");
  expect(cleanups.isRunning(session.id)).toBe(true);
  expect(saved[0]?.cleanup?.state).toBe("pending");

  // Attempting to start another while running throws
  await expect(cleanups.start(session, "worktree", async () => ({ state: "done" }))).rejects.toThrow("already running");

  resolveRun({ state: "done", worktreeRemoved: true });
  await cleanups.settled(session.id);
  expect(cleanups.isRunning(session.id)).toBe(false);
  expect(session.cleanup?.state).toBe("done");
  expect(session.cleanup?.worktreeRemoved).toBe(true);
  expect(saved.at(-1)?.cleanup?.state).toBe("done");
});

test("BackgroundCleanups unit: records failed when task throws or returns failure", async () => {
  const cleanups = new BackgroundCleanups(async () => {});
  const session: ChangeSession = {
    id: "test-session-2",
    agentId: "fake",
    agentName: "Fake Agent",
    state: "exited",
    worktreePath: "/tmp/wt2",
    resumable: false,
    repoId: "repo-1",
    change: "change-2",
    action: "implement",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await cleanups.start(session, "worktree", async () => {
    throw new Error("disk failure");
  });
  await cleanups.settled(session.id);
  expect(session.cleanup?.state).toBe("failed");
  expect(session.cleanup?.reason).toBe("disk failure");
});

test("BackgroundCleanups unit: markInterrupted marks pending operations", () => {
  const session: ChangeSession = {
    id: "test-session-3",
    agentId: "fake",
    agentName: "Fake Agent",
    state: "exited",
    worktreePath: "/tmp/wt3",
    resumable: false,
    repoId: "repo-1",
    change: "change-3",
    action: "implement",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cleanup: { kind: "worktree", state: "pending", startedAt: "2026-10-30T12:00:00Z" },
  };

  expect(BackgroundCleanups.markInterrupted(session)).toBe(true);
  expect(session.cleanup?.state).toBe("interrupted");
  expect(session.cleanup?.reason).toBe(INTERRUPTED_REASON);
  // Calling it again on already interrupted returns false
  expect(BackgroundCleanups.markInterrupted(session)).toBe(false);
});

test("lifecycle: closeInBackground ends session first, then executes removal", async () => {
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(s.state).toBe("running");

  // Merge the branch into main so the worktree is safely removable
  git(s.worktreePath, "commit", "-q", "-am", "prep");
  git(h.repoPath, "merge", "--no-ff", "-m", "merge upgrade-runtime", s.branch!);

  const { session, cleanup } = await h.manager.closeInBackground(s.id);
  // Session must be ended
  expect(session.state).not.toBe("running");
  expect(h.manager.get(s.id).state).not.toBe("running");
  expect(cleanup.state).toBe("pending");

  // Await background cleanup settlement
  await h.manager.cleanupSettled(s.id);
  const after = h.manager.get(s.id) as ChangeSession;
  expect(after.cleanup?.state).toBe("done");
  expect(after.cleanup?.worktreeRemoved).toBe(true);
  expect(existsSync(s.worktreePath)).toBe(false);
});

test("lifecycle: staleCleanupInBackground refuses if session is still running", async () => {
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(s.state).toBe("running");

  await expect(h.manager.staleCleanupInBackground(s.id, async () => ({ repoId: h.repoId, name: "upgrade-runtime", items: [] }))).rejects.toThrow(SessionError);

  await h.manager.close(s.id);
  const { cleanup } = await h.manager.staleCleanupInBackground(s.id, async () => ({
    repoId: h.repoId,
    name: "upgrade-runtime",
    items: [{ kind: "worktree", id: s.worktreePath, outcome: "removed" }],
  }));
  expect(cleanup.state).toBe("pending");
  await h.manager.cleanupSettled(s.id);

  const after = h.manager.get(s.id) as ChangeSession;
  expect(after.cleanup?.state).toBe("done");
  expect(after.cleanup?.worktreeRemoved).toBe(true);
});

test("lifecycle: background cleanup preserves rechecks and reports failure when worktree is dirty", async () => {
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });

  // Add uncommitted file to the worktree
  await writeFile(join(s.worktreePath, "uncommitted.txt"), "hello");

  const { cleanup } = await h.manager.closeInBackground(s.id);
  expect(cleanup.state).toBe("pending");
  await h.manager.cleanupSettled(s.id);

  const after = h.manager.get(s.id) as ChangeSession;
  expect(after.cleanup?.state).toBe("failed");
  expect(after.cleanup?.worktreeRemoved).toBe(false);
  expect(after.cleanup?.reason).toContain("uncommitted");
  expect(existsSync(s.worktreePath)).toBe(true);
});

test("lifecycle: interrupted cleanup across restart is reported and can be safely retried", async () => {
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  await h.manager.close(s.id);

  // Manually store pending state as if process died mid-cleanup
  const store = new SessionStore();
  const session = h.manager.get(s.id) as ChangeSession;
  session.cleanup = { kind: "worktree", state: "pending", startedAt: new Date().toISOString() };
  await store.saveMeta(session);

  // Restart manager
  const again = h.newManager();
  managers.push(again);
  await again.init();

  const loaded = again.get(s.id) as ChangeSession;
  expect(loaded.cleanup?.state).toBe("interrupted");
  expect(loaded.cleanup?.reason).toBe(INTERRUPTED_REASON);

  // Now retry cleanup safely
  git(s.worktreePath, "commit", "-q", "-am", "prep");
  git(h.repoPath, "merge", "--no-ff", "-m", "merge upgrade-runtime", s.branch!);
  const retried = await again.closeInBackground(s.id);
  expect(retried.cleanup.state).toBe("pending");
  await again.cleanupSettled(s.id);

  const final = again.get(s.id) as ChangeSession;
  expect(final.cleanup?.state).toBe("done");
  expect(final.cleanup?.worktreeRemoved).toBe(true);
  expect(existsSync(s.worktreePath)).toBe(false);
});

test("API: close with background flag returns 202 and pending cleanup", async () => {
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });

  const state: AppState = { config: h.config, scanner: undefined as unknown as Scanner, sessions: h.manager };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;

  const handler = createFetchHandler({ state, indexHtml: "" });

  // Merge so removal will succeed once executed
  git(s.worktreePath, "commit", "-q", "-am", "prep");
  git(h.repoPath, "merge", "--no-ff", "-m", "merge upgrade-runtime", s.branch!);

  const req = new Request(`http://127.0.0.1/api/sessions/${s.id}/close`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ removeWorktree: true, background: true }),
  });
  const res = await handler(req);
  expect(res.status).toBe(202);
  const body = (await res.json()) as { session: ChangeSession; cleanup: { state: string; kind: string } };
  expect(body.cleanup.state).toBe("pending");
  expect(body.cleanup.kind).toBe("worktree");

  await h.manager.cleanupSettled(s.id);
  const after = h.manager.get(s.id) as ChangeSession;
  expect(after.cleanup?.state).toBe("done");
  expect(after.cleanup?.worktreeRemoved).toBe(true);

  state.scanner.stop();
});
