import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFetchHandler, type AppState } from "../src/server/api.ts";
import { previewCleanup } from "../src/server/cleanup.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { SessionManager } from "../src/server/sessions/manager.ts";
import { changeSessions, projectConsoleSessions, projectConsoleToShow, type ChangeSession, type IntegrationSession, type ProjectConsoleSession, type Session } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { fakeProfile, git, harness, waitFor, watch } from "./sessionHelpers.ts";

// Real processes in pseudo-terminals; slow CI runners need more than the 5 s default.
setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: SessionManager[] = [];
const track = (m: SessionManager) => {
  managers.push(m);
  return m;
};

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

const base = { agentId: "fake", agentName: "Fake Agent", worktreePath: "/w/acme/gamma-tools", updatedAt: "2026-10-01T00:00:00Z", resumable: true };
const integration = (id: string, createdAt: string, state: Session["state"] = "exited"): IntegrationSession => ({ ...base, id, createdAt, state, integration: true, folder: "/w/acme/gamma-tools", inPlace: true });
const projectConsole = (id: string, createdAt: string, state: Session["state"] = "exited", repoId = "r1"): ProjectConsoleSession => ({ ...base, id, createdAt, state, projectConsole: true, repoId, folder: "/w/acme/gamma-tools", inPlace: true });

test("a project's console sessions are its own consoles and the setup session in its folder, a running one first", () => {
  const repo = { id: "r1", path: "/w/acme/gamma-tools" };
  const setup = integration("setup", "2026-10-01T10:00:00Z");
  const elsewhere: IntegrationSession = { ...integration("other", "2026-10-01T12:00:00Z"), folder: "/w/acme/beta-soc" };
  const otherProject = projectConsole("x", "2026-10-01T13:00:00Z", "exited", "r2");
  const change: ChangeSession = { ...base, id: "c", createdAt: "2026-10-01T14:00:00Z", state: "running", repoId: "r1", change: "audit-trail", action: "implement" };

  // Only the setup session: it is the project's console.
  const onlySetup = projectConsoleSessions([setup, elsewhere, otherProject, change], repo);
  expect(onlySetup.map((s) => s.id)).toEqual(["setup"]);
  expect(projectConsoleToShow(onlySetup)?.id).toBe("setup");

  // A newer console wins over the ended setup session.
  const newer = projectConsole("newer", "2026-10-02T10:00:00Z");
  expect(projectConsoleToShow(projectConsoleSessions([setup, newer], repo))?.id).toBe("newer");

  // A running setup session wins over a newer ended console.
  expect(projectConsoleToShow(projectConsoleSessions([integration("setup", "2026-10-01T10:00:00Z", "running"), newer], repo))?.id).toBe("setup");

  // A project console is never change work.
  expect(changeSessions([newer, change]).map((s) => s.id)).toEqual(["c"]);
});

test("opens in place in the main checkout without a prompt, once, and never as change work", async () => {
  const reported: unknown[] = [];
  const h = await harness();
  const manager = track(h.newManager({ onActivity: (_s, what) => reported.push(what) }));
  const head = git(h.repoPath, "rev-parse", "HEAD");
  const branch = git(h.repoPath, "rev-parse", "--abbrev-ref", "HEAD");
  const index = await readFile(join(h.repoPath, ".git", "index"));

  const { session, created } = await manager.openProjectConsole(h.repoId);
  expect(created).toBe(true);
  expect(session).toMatchObject({ projectConsole: true, repoId: h.repoId, folder: h.repoPath, worktreePath: h.repoPath, inPlace: true, state: "running" });
  expect(session.branch).toBeUndefined();
  expect(session.change).toBeUndefined();

  const view = await watch(manager, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  expect(view.text()).toContain("args=[]");
  expect(view.text()).toContain(`cwd=${h.repoPath}`);

  // One per project: a second open attaches.
  expect(await manager.openProjectConsole(h.repoId)).toEqual({ session, created: false });

  // Change-only requests are refused; it is in no change view.
  await expect(manager.ship(session.id)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("project's console") });
  await expect(manager.resolveConflicts(session.id)).rejects.toMatchObject({ status: 409 });
  await expect(manager.prompt(session.id, { action: "implement" })).rejects.toMatchObject({ status: 409 });
  await expect(manager.worktreeStatus(session.id)).rejects.toMatchObject({ status: 409 });
  expect(await manager.worktrees()).toEqual([]);
  expect(manager.hasOpenSession(h.repoId, "cache-api-calls")).toBe(false);

  // A change session still gets its own worktree and branch next to it.
  const change = (await manager.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" })) as ChangeSession;
  expect(change.worktreePath).not.toBe(h.repoPath);
  expect(change.branch).toBe("feat/cache-api-calls");

  const closed = await manager.close(session.id, { removeWorktree: true });
  expect(closed.session.state).toBe("exited");
  expect(closed.worktree).toBeUndefined();
  expect(reported.filter((r) => (r as { kind: string }).kind !== "session-started")).toEqual([]);
  expect(reported).toHaveLength(1); // only the change session's start

  // The dashboard left the main checkout alone.
  expect(git(h.repoPath, "rev-parse", "HEAD")).toBe(head);
  expect(git(h.repoPath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
  expect(git(h.repoPath, "status", "--porcelain")).toBe("");
  expect(await readFile(join(h.repoPath, ".git", "index"))).toEqual(index);
  view.detach();
});

test("project command permissions reach project-console start and resume, but not main or integration consoles", async () => {
  const h = await harness({ agent: { id: "claude" } });
  h.config.agentSessions.defaultAgent = "claude";
  h.config.repos[0]!.agent = { enabled: true, permissionProfile: "less-friction", allowedCommands: ["bun run lint"] };
  const manager = track(h.manager);
  const { session } = await manager.openProjectConsole(h.repoId);
  const view = await watch(manager, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "project console start");
  expect(view.text()).toContain("Bash(bun run lint)");
  expect(view.text()).toContain("Bash(bun run lint *)");
  await manager.close(session.id);
  await manager.resume(session.id);
  const resumed = await watch(manager, session.id);
  await waitFor(() => resumed.text().split("fake-agent ready").length > 1 && resumed.text().includes("--resumed"), "project console resume");
  const resumedOutput = resumed.text().slice(resumed.text().lastIndexOf("fake-agent ready"));
  expect(resumedOutput).toContain("Bash(bun run lint)");
  resumed.detach();
  view.detach();

  const plain = await harness({ agent: { id: "claude" }, git: false });
  plain.config.agentSessions.defaultAgent = "claude";
  plain.config.repos[0]!.agent = { enabled: true, permissionProfile: "less-friction", allowedCommands: ["bun run test"] };
  const plainManager = track(plain.manager);
  const plainSession = await plainManager.openProjectConsole(plain.repoId);
  const plainView = await watch(plainManager, plainSession.session.id);
  await waitFor(() => plainView.text().includes("fake-agent ready"), "non-git project console start");
  expect(plainView.text()).toContain("Bash(bun run test)");
  plainView.detach();
});

test("custom project commands stay out of main and integration consoles", async () => {
  const h = await harness({ agent: { id: "claude" } });
  h.config.agentSessions.defaultAgent = "claude";
  h.config.repos[0]!.agent = { enabled: true, permissionProfile: "less-friction", allowedCommands: ["bun run lint"] };
  const manager = track(h.manager);
  const main = await manager.openConsole();
  const mainView = await watch(manager, main.session.id);
  await waitFor(() => mainView.text().includes("fake-agent ready"), "main console start");
  expect(mainView.text()).not.toContain("Bash(bun run lint)");
  await manager.close(main.session.id);
  const setup = await manager.openIntegration(h.repoPath);
  const setupView = await watch(manager, setup.session.id);
  await waitFor(() => setupView.text().includes("fake-agent ready"), "integration start");
  expect(setupView.text()).not.toContain("Bash(bun run lint)");
  mainView.detach();
  setupView.detach();
});

test("resumes in the same folder and starts a new console after the previous one ended", async () => {
  const h = await harness();
  const manager = track(h.manager);
  const { session } = await manager.openProjectConsole(h.repoId);
  await manager.close(session.id);
  const resumed = await manager.resume(session.id);
  expect(resumed.state).toBe("running");
  const view = await watch(manager, session.id);
  await waitFor(() => view.text().includes('args=["--resumed"]'), "resume command");
  expect(view.text()).toContain(`cwd=${h.repoPath}`);
  view.detach();

  await manager.close(session.id);
  const next = await manager.openProjectConsole(h.repoId);
  expect(next.created).toBe(true);
  expect(next.session.id).not.toBe(session.id);
  expect(manager.get(session.id).state).toBe("exited");
  // Resuming the ended one now would make two agents run in the folder.
  await expect(manager.resume(session.id)).rejects.toMatchObject({ status: 409 });
});

test("adopts the setup session running in the project's folder instead of starting another agent", async () => {
  const h = await harness();
  const manager = track(h.manager);
  const { session: setup } = await manager.openIntegration(h.repoPath);
  const opened = await manager.openProjectConsole(h.repoId);
  expect(opened).toEqual({ session: setup, created: false });
  expect(manager.list()).toHaveLength(1);

  // Once it has ended, a new console starts; the setup record stays.
  await manager.close(setup.id);
  const next = await manager.openProjectConsole(h.repoId);
  expect(next.created).toBe(true);
  expect(next.session.projectConsole).toBe(true);
  expect(manager.get(setup.id).state).toBe("exited");
});

test("refusals: sessions off, project excluded, unknown, disabled, folder gone, agent missing", async () => {
  const off = await harness({ enabled: false });
  await expect(track(off.manager).openProjectConsole(off.repoId)).rejects.toMatchObject({ status: 403 });

  const excluded = await harness({ repoOff: true });
  await expect(track(excluded.manager).openProjectConsole(excluded.repoId)).rejects.toMatchObject({ status: 403 });

  const missing = await harness({ agent: { command: ["no-such-agent-osd", "{prompt}"] } });
  await expect(track(missing.manager).openProjectConsole(missing.repoId)).rejects.toMatchObject({ status: 503 });

  const h = await harness();
  const manager = track(h.manager);
  await expect(manager.openProjectConsole("nope")).rejects.toMatchObject({ status: 404 });
  h.config.repos[0].enabled = false;
  await expect(manager.openProjectConsole(h.repoId)).rejects.toMatchObject({ status: 409 });
  h.config.repos[0].enabled = true;
  await rm(h.repoPath, { recursive: true, force: true });
  await expect(manager.openProjectConsole(h.repoId)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("does not exist") });
  expect(manager.list()).toEqual([]);
});

test("not refused for a failed scan, and the project's own agent is used", async () => {
  const h = await harness();
  h.config.agentSessions.agents.push(fakeProfile({ id: "mine", name: "My Agent", command: [h.config.agentSessions.agents[0].command[0], "--task={prompt}", "--color"] }));
  h.config.repos[0].agent = { enabled: true, agentId: "mine" };
  h.snapshot.repos[0] = { ...h.snapshot.repos[0], ok: false, error: "broken" };
  const manager = track(h.manager);
  const { session } = await manager.openProjectConsole(h.repoId);
  expect(session.agentId).toBe("mine");
  const view = await watch(manager, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  expect(view.text()).toContain('args=["--color"]');
  view.detach();
});

test("a folder without git keeps one agent: the console and an in-place change session refuse each other", async () => {
  const h = await harness({ git: false });
  const manager = track(h.manager);
  const change = (await manager.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" })) as ChangeSession;
  expect(change.inPlace).toBe(true);
  await expect(manager.openProjectConsole(h.repoId)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("cache-api-calls") });
  await manager.close(change.id);

  const { session } = await manager.openProjectConsole(h.repoId);
  expect(session.worktreePath).toBe(h.repoPath);
  await expect(manager.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("project's console") });
  await expect(manager.resume(change.id)).rejects.toMatchObject({ status: 409 });
});

test("no git command runs for the project console, and stopping the dashboard ends it", async () => {
  const bin = await tempDir("osd-fake-git-");
  const log = join(bin, "calls.log");
  await writeFile(join(bin, "git"), `#!/bin/sh\necho "$@" >> "${log}"\nexit 1\n`);
  await chmod(join(bin, "git"), 0o755);
  const h = await harness();
  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  try {
    const manager = h.manager;
    const { session } = await manager.openProjectConsole(h.repoId);
    await manager.close(session.id);
    await manager.resume(session.id);
    await manager.shutdown();
    expect(manager.get(session.id)).toMatchObject({ state: "exited", error: expect.stringContaining("dashboard was stopped") });
  } finally {
    process.env.PATH = previous;
  }
  expect(existsSync(log) ? await readFile(log, "utf8") : "").toBe("");
  await rm(bin, { recursive: true, force: true });
});

test("cleanup's preview of the repository is the same while the project console runs", async () => {
  const h = await harness();
  const manager = track(h.manager);
  const before = await previewCleanup(h.config.repos[0], await manager.runningWorktreePaths());
  await manager.openProjectConsole(h.repoId);
  expect(await previewCleanup(h.config.repos[0], await manager.runningWorktreePaths())).toEqual(before);
});

test("a project console record survives a restart as ended", async () => {
  const h = await harness();
  const { session } = await track(h.manager).openProjectConsole(h.repoId);
  const second = track(h.newManager());
  await second.init();
  expect(second.get(session.id)).toMatchObject({ projectConsole: true, repoId: h.repoId, worktreePath: h.repoPath, state: "exited" });
});

// ---- the API ----

test("the project console endpoint behaves as the dashboard-api spec says", async () => {
  const h = await harness();
  const state: AppState = { config: h.config, scanner: undefined as unknown as Scanner, sessions: h.manager };
  state.scanner = new Scanner(() => state.config, { persist: false });
  track(h.manager);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "<title>stub</title>" }) });
  const url = `http://127.0.0.1:${server.port}`;
  const send = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
  try {
    const route = `/api/repos/${encodeURIComponent(h.repoId)}/console`;
    expect((await send(route, undefined, { origin: "http://evil.example" })).status).toBe(403);
    expect((await send("/api/repos/nope/console")).status).toBe(404);
    expect(h.manager.list()).toEqual([]);

    const opened = await send(route);
    expect(opened.status).toBe(201);
    const session = (await opened.json()) as ProjectConsoleSession;
    expect(session).toMatchObject({ projectConsole: true, repoId: h.repoId, inPlace: true, worktreePath: h.repoPath });
    expect(session.branch).toBeUndefined();

    const again = await send(route);
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(session.id);

    const listed = await (await fetch(`${url}/api/sessions`)).json();
    expect(listed.sessions).toHaveLength(1);
    expect(listed.sessions[0]).toMatchObject({ id: session.id, projectConsole: true, repoId: h.repoId });
    for (const key of ["change", "action", "branch"]) expect(listed.sessions[0][key]).toBeUndefined();
    expect(listed.worktrees).toEqual([]);

    for (const sub of ["ship", "resolve-conflicts", "prompt"]) expect((await send(`/api/sessions/${session.id}/${sub}`, { action: "implement" })).status).toBe(409);
    expect((await fetch(`${url}/api/sessions/${session.id}/worktree`)).status).toBe(409);
    expect((await send(`/api/sessions/${session.id}/close`, { removeWorktree: true })).status).toBe(200);

    h.config.repos[0].agent = { enabled: false };
    expect((await send(route)).status).toBe(403);
  } finally {
    state.scanner.stop();
    server.stop(true);
  }
});
