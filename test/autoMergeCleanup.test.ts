// A merged auto-merge pull request ends its session (auto-merge-cleanup): the record, the match, the end and the
// removal, the activity it leaves, and the refresh route that hands a completed query to the session manager.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import type { SessionActivity } from "../src/server/activity/events.ts";
import { sessionsDir } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { SessionManager } from "../src/server/sessions/manager.ts";
import { SessionStore } from "../src/server/sessions/store.ts";
import { sessionBranch } from "../src/shared/sessionBranch.ts";
import type { ChangeSession, PullRequest } from "../src/shared/types.ts";
import { describe as describeEvent } from "../src/ui/activityState.ts";
import { autoEndedText, sessionBadge, sessionsForChange } from "../src/ui/sessionState.ts";
import { ghPr, installFakeGh } from "./ghHelpers.ts";
import { useTempHome } from "./helpers.ts";
import { git, harness, waitFor, watch, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: SessionManager[] = [];

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

const CHANGE = "confirm-retention";
const BRANCH = sessionBranch("archive", CHANGE);
const exists = (path: string) => stat(path).then(() => true, () => false);

function merged(patch: Partial<PullRequest> & { number: number; mergedAt: string }): PullRequest {
  return { title: "archive", url: `https://github.com/acme/demo-ops/pull/${patch.number}`, author: "octo", head: BRANCH, base: "main", draft: false, state: "merged", isCrossRepository: false, createdAt: patch.mergedAt, review: "none", reviewRequestedFromViewer: false, checks: "passing", ...patch };
}

const later = (iso: string | undefined, ms = 1000) => new Date(Date.parse(iso as string) + ms).toISOString();

/** A project with docs auto-merge as given, and a manager whose activity reports are collected. */
async function project(autoMergeDocs = true) {
  const h = await harness({ agent: { prompts: { draft: "draft {change}", implement: "implement {change}", validate: "validate {change}", archive: "archive {change}" } } });
  h.config.repos[0].agent = { enabled: true, autoMergeDocs };
  const events: SessionActivity[] = [];
  const manager = h.newManager({ onActivity: (_session, activity) => events.push(activity) });
  managers.push(manager);
  return { h, manager, events };
}

/** An Archive session asked to enable auto-merge, with its agent up. */
async function archiveSession(manager: SessionManager, h: Harness) {
  const started = await manager.open({ repoId: h.repoId, change: CHANGE, action: "archive" });
  expect(started.autoMerge).toBe(true);
  const seen = await watch(manager, started.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  return manager.get(started.id) as ChangeSession;
}

// ---- the record (1.1, 1.2) ----

test("a session record written before the fields existed still loads", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const old = { id, repoId: "r", change: CHANGE, action: "archive", agentId: "fake", agentName: "Fake Agent", state: "exited", worktreePath: "/w/acme/x", branch: BRANCH, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", resumable: false };
  await mkdir(join(sessionsDir(), id), { recursive: true });
  await writeFile(join(sessionsDir(), id, "meta.json"), JSON.stringify(old));
  const loaded = (await new SessionStore().loadAll()).find((s) => s.id === id) as ChangeSession;
  expect(loaded).toMatchObject({ id, change: CHANGE });
  expect([loaded.autoMergeAskedAt, loaded.autoEnded]).toEqual([undefined, undefined]);
  await rm(join(sessionsDir(), id), { recursive: true });
});

test("the time is recorded and stored when Archive starts with the instruction, and not for a returned open session", async () => {
  const { h, manager } = await project();
  const s = await archiveSession(manager, h);
  expect(Date.parse(s.autoMergeAskedAt as string)).toBeGreaterThan(Date.now() - 60_000);
  const stored = (await new SessionStore().loadAll()).find((x) => x.id === s.id) as ChangeSession;
  expect(stored.autoMergeAskedAt).toBe(s.autoMergeAskedAt);
  const before = s.autoMergeAskedAt;
  await new Promise((r) => setTimeout(r, 5));
  const again = await manager.open({ repoId: h.repoId, change: CHANGE, action: "archive" });
  expect([again.id, again.autoMerge, (manager.get(s.id) as ChangeSession).autoMergeAskedAt]).toEqual([s.id, false, before]);
});

// ---- the trigger (2.1, 2.3) ----

test("merged after the ask: the agent is ended, the worktree removed, the branch kept, one event recorded", async () => {
  const { h, manager, events } = await project();
  const s = await archiveSession(manager, h);
  const refs = git(h.repoPath, "for-each-ref");
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 88, mergedAt: later(s.autoMergeAskedAt) })]);
  const after = manager.get(s.id) as ChangeSession;
  expect(after.state).toBe("exited");
  expect(after.autoEnded).toMatchObject({ pr: 88, removed: true });
  expect(after.autoEnded?.reason).toBeUndefined();
  // Ended without any Merge prompt: GitHub's own auto-merge, or a merge by hand, is handled exactly as before.
  expect(after.mergeAsked).toBeUndefined();
  expect(await exists(s.worktreePath)).toBe(false);
  expect(git(h.repoPath, "for-each-ref")).toBe(refs);
  expect(git(h.repoPath, "show-ref", "--verify", `refs/heads/${BRANCH}`)).toContain(BRANCH);
  expect(events.filter((e) => e.kind !== "session-started")).toEqual([{ kind: "session-auto-ended", pr: 88, removed: true }]);
  const stored = (await new SessionStore().loadAll()).find((x) => x.id === s.id) as ChangeSession;
  expect(stored.autoEnded).toEqual(after.autoEnded);

  // Seen again: nothing more is ended, removed or recorded.
  const updatedAt = after.updatedAt;
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 88, mergedAt: later(s.autoMergeAskedAt) })]);
  expect([manager.get(s.id).updatedAt, events.length]).toEqual([updatedAt, 2]);
});

test("nothing happens without an ask, with the setting off, for an earlier merge, or for another branch", async () => {
  // An Implement-like session never asked to enable auto-merge.
  {
    const { h, manager } = await project();
    const s = await manager.open({ repoId: h.repoId, change: CHANGE, action: "validate" });
    expect((manager.get(s.id) as ChangeSession).autoMergeAskedAt).toBeUndefined();
    await manager.endMergedAutoMerge(h.repoId, [merged({ number: 1, head: s.branch, mergedAt: new Date(Date.now() + 1000).toISOString() })]);
    expect(manager.get(s.id).state).toBe("running");
  }
  // Switched off since the ask; an earlier merge of the same branch; a different branch.
  const { h, manager } = await project();
  const s = await archiveSession(manager, h);
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: false };
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 2, mergedAt: later(s.autoMergeAskedAt) })]);
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 3, mergedAt: later(s.autoMergeAskedAt, -30 * 60_000) })]);
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 4, head: "feat/other", mergedAt: later(s.autoMergeAskedAt) })]);
  await manager.endMergedAutoMerge("another-repo", [merged({ number: 5, mergedAt: later(s.autoMergeAskedAt) })]);
  await manager.endMergedAutoMerge(h.repoId, [{ ...merged({ number: 6, mergedAt: later(s.autoMergeAskedAt) }), state: "open" }]);
  const after = manager.get(s.id) as ChangeSession;
  expect([after.state, after.autoEnded, await exists(s.worktreePath)]).toEqual(["running", undefined, true]);
});

test("uncommitted work: the agent is ended, the worktree kept, and the reason kept", async () => {
  const { h, manager, events } = await project();
  const s = await archiveSession(manager, h);
  await writeFile(join(s.worktreePath, "notes.md"), "left behind");
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 89, mergedAt: later(s.autoMergeAskedAt) })]);
  const after = manager.get(s.id) as ChangeSession;
  expect(after.state).toBe("exited");
  expect(after.autoEnded).toMatchObject({ pr: 89, removed: false, reason: "the worktree has uncommitted changes" });
  expect(await exists(s.worktreePath)).toBe(true);
  expect(events.filter((e) => e.kind !== "session-started")).toEqual([{ kind: "session-auto-ended", pr: 89, removed: false, reason: "the worktree has uncommitted changes" }]);
});

test("ended by the user with the worktree kept: only the removal happens; with the worktree gone too, nothing", async () => {
  const { h, manager, events } = await project();
  const s = await archiveSession(manager, h);
  await manager.close(s.id);
  expect(await exists(s.worktreePath)).toBe(true);
  const ended = events.length;
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 90, mergedAt: later(s.autoMergeAskedAt) })]);
  expect((manager.get(s.id) as ChangeSession).autoEnded).toMatchObject({ pr: 90, removed: true });
  expect(await exists(s.worktreePath)).toBe(false);
  expect(events.slice(ended)).toEqual([{ kind: "session-auto-ended", pr: 90, removed: true }]);

  // A second archive session ended and removed by the user leaves nothing to do.
  const { h: h2, manager: m2, events: e2 } = await project();
  const t = await archiveSession(m2, h2);
  await m2.close(t.id, { removeWorktree: true });
  const count = e2.length;
  await m2.endMergedAutoMerge(h2.repoId, [merged({ number: 91, mergedAt: later(t.autoMergeAskedAt) })]);
  expect([(m2.get(t.id) as ChangeSession).autoEnded, e2.length]).toEqual([undefined, count]);
});

test("two queries settling at once end the session once", async () => {
  const { h, manager, events } = await project();
  const s = await archiveSession(manager, h);
  const list = [merged({ number: 92, mergedAt: later(s.autoMergeAskedAt) })];
  await Promise.all([manager.endMergedAutoMerge(h.repoId, list), manager.endMergedAutoMerge(h.repoId, list)]);
  expect(events.filter((e) => e.kind === "session-auto-ended")).toHaveLength(1);
  expect(events.filter((e) => e.kind === "session-ended")).toHaveLength(0);
});

// ---- the refresh route (2.2) ----

test("a refresh that shows the merged pull request ends the session; the only gh calls are pr list and api user", async () => {
  const { h, manager } = await project();
  git(h.repoPath, "remote", "add", "origin", "https://github.com/acme/demo-ops.git");
  const s = await archiveSession(manager, h);
  const gh = await installFakeGh({
    login: "demo-user",
    repos: { "acme/demo-ops": { open: [], closed: [ghPr({ number: 88, headRefName: BRANCH, isCrossRepository: false, state: "MERGED", mergedAt: later(s.autoMergeAskedAt), closedAt: later(s.autoMergeAskedAt) })] } },
  });
  const state: AppState = { config: h.config, scanner: undefined as unknown as Scanner, sessions: manager };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/pull-requests/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) });
    expect(res.status).toBe(200);
    await waitFor(() => (manager.get(s.id) as ChangeSession).autoEnded !== undefined, "the automatic end");
    expect((manager.get(s.id) as ChangeSession).autoEnded).toMatchObject({ pr: 88, removed: true });
    expect(await exists(s.worktreePath)).toBe(false);
    const calls = await gh.calls();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.argv.slice(0, 2).join(" ")).toMatch(/^(pr list|api user)$/);
    for (const call of calls) expect(call.cwd.startsWith(dirname(h.repoPath))).toBe(false);
  } finally {
    state.scanner.stop();
    server.stop(true);
    gh.restore();
  }
});

// ---- the whole flow with a Merge prompt (agent-merges-docs-prs 4.3) ----

test("Archive, then a ready docs-only #88 is handed to the agent, then #88 merged ends the session and keeps the branch", async () => {
  const { h, manager, events } = await project();
  git(h.repoPath, "remote", "add", "origin", "https://github.com/acme/demo-ops.git");
  const s = await archiveSession(manager, h);
  const seen = await watch(manager, s.id);
  // The agent archives and commits under openspec/, then pushes and opens #88 (all of which is the agent's doing).
  await mkdir(join(s.worktreePath, "openspec", "changes", CHANGE), { recursive: true });
  await writeFile(join(s.worktreePath, "openspec", "changes", CHANGE, "notes.md"), "archived\n");
  git(s.worktreePath, "add", "-A");
  git(s.worktreePath, "commit", "-q", "-m", "archive");
  const head = git(s.worktreePath, "rev-parse", "HEAD");
  const files = { files: [{ path: `openspec/changes/${CHANGE}/notes.md` }], changedFiles: 1 };
  const open88 = ghPr({ number: 88, headRefName: BRANCH, isCrossRepository: false, headRefOid: head, statusCheckRollup: [{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }], ...files });
  const gh = await installFakeGh({ login: "demo-user", repos: { "acme/demo-ops": { open: [open88], closed: [] } } });
  const state: AppState = { config: h.config, scanner: undefined as unknown as Scanner, sessions: manager };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  const post = (path: string, body: unknown = {}, headers: Record<string, string> = { "content-type": "application/json" }) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    expect((await post("/api/pull-requests/refresh", { force: true })).status).toBe(200);
    await waitFor(() => (manager.get(s.id) as ChangeSession).mergeAsked?.submitted === true, "the Merge prompt");
    expect((manager.get(s.id) as ChangeSession).mergeAsked).toMatchObject({ pr: 88, head, by: "dashboard" });
    await waitFor(() => seen.text().includes(`#88 and its head commit is ${head}.`), "the prompt in the terminal");
    expect(events.filter((e) => e.kind === "session-merge")).toEqual([{ kind: "session-merge", pr: 88, by: "dashboard", submitted: true }]);

    // The Merge action's route is under the same-origin guard and takes the pull request from the server's list.
    expect((await post(`/api/sessions/${s.id}/merge`, {}, { "content-type": "text/plain" })).status).toBe(403);
    const manual = await post(`/api/sessions/${s.id}/merge`, { pr: 1, head: "0".repeat(40) });
    expect(manual.status).toBe(200);
    expect(((await manual.json()) as ChangeSession).mergeAsked).toMatchObject({ pr: 88, head, by: "user" });

    // The agent merged it; the user's checkout has the work (squash or not, the content is in the base).
    git(h.repoPath, "merge", "-q", "--ff-only", BRANCH);
    await gh.scenario({ login: "demo-user", repos: { "acme/demo-ops": { open: [], closed: [{ ...open88, state: "MERGED", mergedAt: new Date(Date.now() + 1000).toISOString(), closedAt: new Date(Date.now() + 1000).toISOString() }] } } });
    expect((await post("/api/pull-requests/refresh", { force: true })).status).toBe(200);
    await waitFor(() => (manager.get(s.id) as ChangeSession).autoEnded !== undefined, "the automatic end");
    expect((manager.get(s.id) as ChangeSession).autoEnded).toMatchObject({ pr: 88, removed: true });
    expect(await exists(s.worktreePath)).toBe(false);
    expect(git(h.repoPath, "show-ref", "--verify", `refs/heads/${BRANCH}`)).toContain(BRANCH);
    for (const call of await gh.calls()) expect(call.argv.slice(0, 2).join(" ")).toMatch(/^(pr list|api user)$/);
  } finally {
    state.scanner.stop();
    server.stop(true);
    gh.restore();
  }
});

// ---- the wording (3.1) ----

test("the panel, the card and the feed say why the session ended and what became of its worktree", () => {
  const removed = { pr: 88, at: "2026-10-06T10:00:00.000Z", removed: true };
  const kept = { pr: 88, at: "2026-10-06T10:00:00.000Z", removed: false, reason: "the worktree has uncommitted changes" };
  expect(autoEndedText(removed)).toBe("Ended because #88 merged; worktree removed");
  expect(autoEndedText(kept)).toBe("Ended because #88 merged; worktree kept: the worktree has uncommitted changes");

  const session: ChangeSession = { id: "s1", repoId: "r", change: CHANGE, action: "archive", agentId: "fake", agentName: "Fake Agent", state: "exited", exitCode: 143, worktreePath: "/w/acme/x", branch: BRANCH, createdAt: "2026-10-06T09:00:00.000Z", updatedAt: "2026-10-06T10:00:00.000Z", resumable: false };
  // An ordinary clean end is not shown on the card; an automatic one is, with its own words instead of a failure.
  expect(sessionsForChange([{ ...session, exitCode: 0 }], "r", CHANGE)).toEqual([]);
  expect(sessionsForChange([{ ...session, exitCode: 0, autoEnded: removed }], "r", CHANGE)).toHaveLength(1);
  expect(sessionBadge({ ...session, autoEnded: removed })).toMatchObject({ label: "ended · #88 merged", tone: "success", title: autoEndedText(removed) });
  expect(sessionBadge({ ...session, autoEnded: kept })).toMatchObject({ tone: "warning", title: autoEndedText(kept) });

  const event = { v: 1 as const, id: "e", at: removed.at, detectedAt: removed.at, repoId: "r", repoName: "demo-ops", change: CHANGE };
  expect(describeEvent({ ...event, kind: "session-auto-ended", pr: 88, removed: true })).toBe("session ended because #88 merged · worktree removed");
  expect(describeEvent({ ...event, kind: "session-auto-ended", pr: 88, removed: false, reason: kept.reason })).toBe("session ended because #88 merged · worktree kept: the worktree has uncommitted changes");
});

// ---- harden-session-lifecycle (2.2, 2.3) ----

test("a merged pull request of an ended session whose worktree a running session reuses: the worktree is kept, the agent untouched", async () => {
  const { h, manager, events } = await project();
  const first = await archiveSession(manager, h);
  await manager.close(first.id); // ended, worktree kept
  const mergedAt = later(first.autoMergeAskedAt, 10);
  await new Promise((r) => setTimeout(r, 50)); // so the second session's own ask is later than that merge
  const second = await archiveSession(manager, h);
  expect([second.id === first.id, await realpath(second.worktreePath)]).toEqual([false, await realpath(first.worktreePath)]);
  const seen = await watch(manager, second.id);
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 93, mergedAt })]);
  expect((manager.get(first.id) as ChangeSession).autoEnded).toMatchObject({ pr: 93, removed: false, reason: "a session is running in this worktree" });
  expect(manager.get(second.id).state).toBe("running");
  expect(await exists(second.worktreePath)).toBe(true);
  expect(seen.ended()).toBe(false);
  expect(events.filter((e) => e.kind === "session-auto-ended")).toEqual([{ kind: "session-auto-ended", pr: 93, removed: false, reason: "a session is running in this worktree" }]);
  // Seen again: nothing more.
  const count = events.length;
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 93, mergedAt })]);
  expect([events.length, manager.get(second.id).state]).toEqual([count, "running"]);

  // The end dialog of the first session says the same, and removes nothing.
  const closed = await manager.close(first.id, { removeWorktree: true });
  expect(closed.worktree).toEqual({ removable: false, reason: "a session is running in this worktree" });
  expect([await exists(second.worktreePath), manager.get(second.id).state]).toEqual([true, "running"]);
});

test("a merged pull request from a fork, of unknown origin, or into another base ends nothing (D6)", async () => {
  const { h, manager } = await project();
  const s = await archiveSession(manager, h);
  const at = later(s.autoMergeAskedAt);
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 94, mergedAt: at, isCrossRepository: true })]);
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 95, mergedAt: at, isCrossRepository: undefined })]);
  await manager.endMergedAutoMerge(h.repoId, [merged({ number: 96, mergedAt: at, base: "release-1" })]);
  const after = manager.get(s.id) as ChangeSession;
  expect([after.state, after.autoEnded, await exists(s.worktreePath)]).toEqual(["running", undefined, true]);
});

test("through the refresh route, a fork's merged pull request with the session's branch name ends nothing", async () => {
  const { h, manager } = await project();
  git(h.repoPath, "remote", "add", "origin", "https://github.com/acme/demo-ops.git");
  const s = await archiveSession(manager, h);
  const at = later(s.autoMergeAskedAt);
  const fork = ghPr({ number: 97, headRefName: BRANCH, isCrossRepository: true, state: "MERGED", mergedAt: at, closedAt: at });
  const elsewhere = ghPr({ number: 98, headRefName: BRANCH, isCrossRepository: false, baseRefName: "release-1", state: "MERGED", mergedAt: at, closedAt: at });
  const gh = await installFakeGh({ login: "demo-user", repos: { "acme/demo-ops": { open: [], closed: [fork, elsewhere] } } });
  const state: AppState = { config: h.config, scanner: undefined as unknown as Scanner, sessions: manager };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/pull-requests/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) });
    expect(res.status).toBe(200);
    await waitFor(async () => (await gh.calls()).some((c) => c.argv[0] === "pr"), "the query");
    await new Promise((r) => setTimeout(r, 500));
    const after = manager.get(s.id) as ChangeSession;
    expect([after.state, after.autoEnded, await exists(s.worktreePath)]).toEqual(["running", undefined, true]);
  } finally {
    state.scanner.stop();
    server.stop(true);
    gh.restore();
  }
});
