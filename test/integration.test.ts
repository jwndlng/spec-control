import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultAgentSessions, defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { confirmIntegration, confirmIntegrationSession, confirmPendingIntegrations, startIntegration, type IntegrationState } from "../src/server/integration.ts";
import { discoverRepos } from "../src/server/discover.ts";
import { worktreesDir } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { SessionManager } from "../src/server/sessions/manager.ts";
import type { AgentProfile, Config, IntegrationSession, RepoConfig, Snapshot } from "../src/shared/types.ts";
import { changeSessions, DEFAULT_INTEGRATE_PROMPT } from "../src/shared/types.ts";
import { SessionError } from "../src/server/sessions/manager.ts";
import { tempDir, treeFingerprint, useTempHome } from "./helpers.ts";
import { fakeProfile, git, waitFor, watch } from "./sessionHelpers.ts";

// Real processes in pseudo-terminals; slow CI runners need more than the 5 s default.
setDefaultTimeout(30_000);

const INTEGRATE = "set this project up for openspec";
const withIntegrate = (patch: Partial<AgentProfile> = {}) => fakeProfile({ prompts: { ...fakeProfile().prompts, integrate: INTEGRATE }, ...patch });

let cleanup: () => Promise<void>;
const managers: SessionManager[] = [];

interface Harness extends IntegrationState {
  sessions: SessionManager;
  /** A git repository under the scan root with no `openspec/` tree: the thing Integrate is offered for. */
  folder: string;
  root: string;
  scans: number;
}

/** A scan root holding one plain git repository, plus the session manager and the state the integration flow uses. */
async function harness(overrides: { enabled?: boolean; agent?: AgentProfile; repos?: RepoConfig[] } = {}): Promise<Harness> {
  const root = await tempDir("osd-integrate-");
  const folder = join(root, "beta-soc");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "README.md"), "# beta-soc\n");
  git(folder, "init", "-q", "-b", "main");
  git(folder, "config", "user.email", "t@example.invalid");
  git(folder, "config", "user.name", "t");
  git(folder, "config", "gc.auto", "0");
  git(folder, "config", "maintenance.auto", "false");
  git(folder, "add", "-A");
  git(folder, "commit", "-q", "-m", "init");

  const agent = overrides.agent ?? withIntegrate();
  const config: Config = {
    ...defaultConfig(),
    scanRoots: [root],
    repos: overrides.repos ?? [],
    agentSessions: { ...defaultAgentSessions(), enabled: overrides.enabled ?? true, agents: [agent], defaultAgent: agent.id },
  };
  const snapshot: Snapshot = { generatedAt: new Date().toISOString(), repos: [] };
  const h = { config, folder, root, scans: 0 } as Harness;
  h.scanner = {
    trigger: () => {
      h.scans++;
      return { started: true };
    },
  };
  h.sessions = new SessionManager({
    getConfig: () => h.config,
    getSnapshot: () => snapshot,
    typePromptDelayMs: 150,
    onIntegrationEnded: (session) => void confirmIntegrationSession(h, session),
  });
  managers.push(h.sessions);
  return h;
}

/** The status and reason a refusal carries; `SessionError.message` is not an own property, so it is read here. */
async function refusal(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
  const started = Symbol("started");
  const result = await promise.then(() => started).catch((err: SessionError) => err);
  if (result === started) throw new Error("expected the request to be refused, but it was not");
  return { status: (result as SessionError).status, message: (result as SessionError).message };
}

/** Turns the folder into an OpenSpec project, the way the user's agent would. */
async function writeMarker(folder: string): Promise<void> {
  await mkdir(join(folder, "openspec"), { recursive: true });
  await writeFile(join(folder, "openspec", "config.yaml"), "schema: spec-driven\n");
}

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

test("Integrate is refused, without starting anything, for every reason it can be unavailable", async () => {
  const off = await harness({ enabled: false });
  await expect(startIntegration(off, { path: off.folder })).rejects.toMatchObject({ status: 403, message: "agent sessions are disabled" });

  const missing = await harness({ agent: withIntegrate({ command: [join(await tempDir("osd-gone-"), "no-such-agent"), "{prompt}"] }) });
  expect(await refusal(startIntegration(missing, { path: missing.folder }))).toMatchObject({ status: 503 });

  const h = await harness();
  const outside = await tempDir("osd-outside-");
  const plain = join(h.root, "notes");
  await mkdir(plain, { recursive: true }); // a directory, but not a git repository
  await writeMarker(join(h.root, "already"));
  git(join(h.root, "already"), "init", "-q", "-b", "main"); // a git repository that already uses OpenSpec: a candidate, not this
  for (const path of [plain, outside, join(h.root, "already"), "relative/path", "", 42, undefined]) {
    await expect(startIntegration(h, { path })).rejects.toMatchObject({ status: 404 });
  }
  const tracked = await harness({ repos: [newRepoConfig((await harness()).folder, true)] });
  await expect(startIntegration(tracked, { path: tracked.config.repos[0].path })).rejects.toMatchObject({ status: 404 });

  for (const each of [off, missing, h, tracked]) expect(each.sessions.list()).toEqual([]);
});

test("an agent without an Integrate prompt of its own integrates with the default one", async () => {
  const h = await harness({ agent: fakeProfile() }); // the stock fake profile carries no `integrate` prompt
  const { session, created } = await startIntegration(h, { path: h.folder });
  expect(created).toBe(true);
  const view = await watch(h.sessions, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  expect(view.text()).toContain(`args=${JSON.stringify([DEFAULT_INTEGRATE_PROMPT])}`);
  view.detach();
});

test("Integrate's additional instructions are appended to its prompt, as one argument", async () => {
  const h = await harness({ agent: withIntegrate({ promptSuffixes: { integrate: "  Ask me which tools first.\n  Then stop.  " } }) });
  const { session } = await startIntegration(h, { path: h.folder });
  const view = await watch(h.sessions, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  // Composed, collapsed to one line, and still exactly one argument.
  expect(view.text()).toContain(`args=${JSON.stringify([`${INTEGRATE} Ask me which tools first. Then stop.`])}`);
});

test("Integrate runs the agent in the repository folder: no worktree, no branch, and not change work", async () => {
  const h = await harness();
  const { session, created } = await startIntegration(h, { path: h.folder });
  expect(created).toBe(true);
  expect(session).toMatchObject({ integration: true, inPlace: true, folder: h.folder, worktreePath: h.folder, state: "running", agentId: "fake" });
  expect(session.branch).toBeUndefined();
  expect(session.repoId).toBeUndefined();
  expect(existsSync(worktreesDir())).toBe(false); // nothing was created under the dashboard home

  const view = await watch(h.sessions, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  expect(view.text()).toContain(`args=${JSON.stringify([INTEGRATE])}`); // the prompt is one whole argument
  expect(view.text()).toContain(`cwd=${h.folder}`);

  // One per folder: activating Integrate again returns the running session.
  const again = await startIntegration(h, { path: h.folder });
  expect(again).toEqual({ session, created: false });
  expect(h.sessions.list()).toHaveLength(1);

  // It belongs to no change, so nothing about changes applies to it.
  expect(changeSessions(h.sessions.list())).toEqual([]);
  expect(await h.sessions.worktrees()).toEqual([]);
  await expect(h.sessions.ship(session.id)).rejects.toMatchObject({ status: 409 });
  await expect(h.sessions.prompt(session.id, { action: "implement" })).rejects.toMatchObject({ status: 409 });
  await expect(h.sessions.worktreeStatus(session.id)).rejects.toMatchObject({ status: 409 });

  const closed = await h.sessions.close(session.id, { removeWorktree: true });
  expect(closed.session.state).toBe("exited");
  expect(closed.worktree).toBeUndefined(); // there is no worktree to remove
  expect(existsSync(h.folder)).toBe(true);
  view.detach();
});

test("an integration session never reaches the activity log", async () => {
  const reported: unknown[] = [];
  const h = await harness();
  h.sessions = new SessionManager({ getConfig: () => h.config, getSnapshot: () => ({ generatedAt: new Date().toISOString(), repos: [] }), typePromptDelayMs: 150, onActivity: (_s, what) => reported.push(what) });
  managers.push(h.sessions);
  const { session } = await startIntegration(h, { path: h.folder });
  await h.sessions.close(session.id);
  expect(reported).toEqual([]);
});

test("the dashboard runs no git command for the session and leaves the repository byte for byte as it was", async () => {
  const h = await harness();
  const before = await treeFingerprint(h.folder);
  const branch = git(h.folder, "rev-parse", "--abbrev-ref", "HEAD");

  // A `git` earlier on PATH than the real one, recording every invocation the dashboard makes while the session runs.
  const shim = await tempDir("osd-git-shim-");
  const log = join(shim, "calls.log");
  await writeFile(join(shim, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(Bun.which("git"))} "$@"\n`, { mode: 0o755 });
  const realPath = process.env.PATH;
  process.env.PATH = `${shim}:${realPath}`;
  try {
    const { session } = await startIntegration(h, { path: h.folder });
    const view = await watch(h.sessions, session.id);
    await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
    await h.sessions.close(session.id, { removeWorktree: true });
    view.detach();
  } finally {
    process.env.PATH = realPath;
  }

  expect(existsSync(log)).toBe(false); // not one git call, for eligibility, the worktree that is not made, or the close
  expect(await treeFingerprint(h.folder)).toBe(before);
  expect(git(h.folder, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
  expect(existsSync(worktreesDir())).toBe(false);
});

test("the marker decides: with it the repository is tracked and scanned, without it nothing changes", async () => {
  const h = await harness();
  expect(await confirmIntegration(h, h.folder)).toBe(false);
  expect(h.config.repos).toEqual([]);
  expect(h.scans).toBe(0);

  await writeMarker(h.folder);
  expect(await confirmIntegration(h, h.folder)).toBe(true);
  expect(h.config.repos).toHaveLength(1);
  expect(h.config.repos[0]).toMatchObject({ path: h.folder, name: "beta-soc", enabled: true });
  expect(h.scans).toBe(1);

  // Already tracked: nothing is added a second time and no further scan is started.
  expect(await confirmIntegration(h, h.folder)).toBe(false);
  expect(h.config.repos).toHaveLength(1);
  expect(h.scans).toBe(1);
});

test("an integrated repository whose name is taken is disambiguated by its parent directory", async () => {
  const h = await harness({ repos: [{ ...newRepoConfig("/w/acme/beta-soc", true), name: "beta-soc" }] });
  await writeMarker(h.folder);
  expect(await confirmIntegration(h, h.folder)).toBe(true);
  expect(h.config.repos[1].name).toBe(`beta-soc (${h.root.split("/").at(-1)})`);
});

test("the folder is re-checked when the session ends, and again on every discovery run while the session runs", async () => {
  const ended = await harness();
  const { session } = await startIntegration(ended, { path: ended.folder });
  await writeMarker(ended.folder); // the agent did its job
  await ended.sessions.close(session.id);
  await waitFor(() => ended.config.repos.length === 1, "the repository to be tracked");
  expect(ended.config.repos[0]).toMatchObject({ path: ended.folder, enabled: true });
  expect(ended.scans).toBe(1);

  // Still running, marker already written: the next discovery notices it.
  const running = await harness();
  const started = await startIntegration(running, { path: running.folder });
  await writeMarker(running.folder);
  expect(running.config.repos).toEqual([]);
  await confirmPendingIntegrations(running);
  expect(running.config.repos).toHaveLength(1);
  expect(running.scans).toBe(1);
  expect((started.session as IntegrationSession).state).toBe("running");
  // It is no longer offered for integration, and starting it again is refused.
  await expect(startIntegration(running, { path: running.folder })).rejects.toMatchObject({ status: 404 });
});

/** What the user's Forget leaves: the repository list without the folder. */
function forget(h: Harness): void {
  h.config = { ...h.config, repos: h.config.repos.filter((r) => r.path !== h.folder) };
}

async function candidatePaths(h: Harness): Promise<string[]> {
  return (await discoverRepos(h.config.repos, h.config.scanRoots)).candidates.map((c) => c.path);
}

test("a session's confirmation is recorded once and survives a restart of the session manager", async () => {
  const h = await harness();
  const { session } = await startIntegration(h, { path: h.folder });
  await confirmPendingIntegrations(h);
  expect((h.sessions.get(session.id) as IntegrationSession).confirmedAt).toBeUndefined(); // no marker yet

  await writeMarker(h.folder);
  await confirmPendingIntegrations(h);
  const confirmedAt = (h.sessions.get(session.id) as IntegrationSession).confirmedAt;
  expect(confirmedAt).toBeString();
  expect(await h.sessions.recordIntegrationConfirmed(session.id)).toBe(false);

  await h.sessions.shutdown();
  const restarted = new SessionManager({ getConfig: () => h.config, getSnapshot: () => ({ generatedAt: "", repos: [] }) });
  managers.push(restarted);
  await restarted.init();
  expect((restarted.get(session.id) as IntegrationSession).confirmedAt).toBe(confirmedAt);
});

test("a forgotten integrated project stays forgotten", async () => {
  const h = await harness();
  const { session } = await startIntegration(h, { path: h.folder });
  await writeMarker(h.folder);
  await h.sessions.close(session.id);
  await waitFor(() => h.config.repos.length === 1, "the repository to be tracked");
  await waitFor(() => (h.sessions.get(session.id) as IntegrationSession).confirmedAt !== undefined, "the confirmation to be recorded");

  forget(h);
  await confirmPendingIntegrations(h);
  expect(await confirmIntegrationSession(h, h.sessions.get(session.id) as IntegrationSession)).toBe(false);
  expect(h.config.repos).toEqual([]);
  expect(await candidatePaths(h)).toContain(h.folder);
  expect(h.scans).toBe(1);
});

test("forgetting while the setup agent still runs", async () => {
  const h = await harness();
  const { session } = await startIntegration(h, { path: h.folder });
  await writeMarker(h.folder);
  await confirmPendingIntegrations(h);
  expect(h.config.repos).toHaveLength(1);

  forget(h);
  await confirmPendingIntegrations(h);
  expect(h.sessions.get(session.id).state).toBe("running");
  expect(h.config.repos).toEqual([]);
  expect(await candidatePaths(h)).toContain(h.folder);
  // Nor does the session's end bring it back.
  await h.sessions.close(session.id);
  await waitFor(() => h.sessions.get(session.id).state === "exited", "the agent to end");
  await confirmPendingIntegrations(h);
  expect(h.config.repos).toEqual([]);
});

test("a marker written after the session ended without it leaves the folder an ordinary candidate", async () => {
  const h = await harness();
  const { session } = await startIntegration(h, { path: h.folder });
  await h.sessions.close(session.id);
  await waitFor(() => h.sessions.get(session.id).state === "exited", "the agent to end");
  await writeMarker(h.folder);
  await confirmPendingIntegrations(h);
  expect(h.config.repos).toEqual([]);
  expect(await candidatePaths(h)).toContain(h.folder);
});

test("an agent that exits without the marker leaves the folder integratable and nothing in the config", async () => {
  const h = await harness();
  const { session } = await startIntegration(h, { path: h.folder });
  const view = await watch(h.sessions, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  h.sessions.write(session.id, "crash\r"); // the fake agent exits with code 3
  await waitFor(() => h.sessions.get(session.id).state === "exited", "the agent to end");
  expect(h.sessions.get(session.id).exitCode).toBe(3);
  expect(h.config.repos).toEqual([]);
  expect(h.scans).toBe(0);
  // Still on offer: a second attempt is allowed because the first one is no longer running.
  const retry = await startIntegration(h, { path: h.folder });
  expect(retry.created).toBe(true);
  view.detach();
});

// ---- the API ----

test("the integration endpoints and the integratable list behave as the dashboard-api spec says", async () => {
  const h = await harness();
  const state: AppState = { config: h.config, scanner: undefined as unknown as Scanner, sessions: h.sessions };
  state.scanner = new Scanner(() => state.config, { persist: false });
  // `state` is what the routes mutate; the manager and the harness must see the same config object.
  Object.defineProperty(h, "config", { get: () => state.config, set: (c: Config) => (state.config = c) });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "<title>stub</title>" }) });
  const base = `http://127.0.0.1:${server.port}`;
  const send = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
  try {
    const discovered = await (await send("/api/discover")).json();
    expect(discovered.integratable).toEqual([{ id: newRepoConfig(h.folder).id, path: h.folder, name: "beta-soc" }]);
    expect(discovered.candidates).toEqual([]);

    // Cross-site: refused before anything is started.
    const foreign = await send("/api/integrations", { path: h.folder }, { origin: "http://evil.example" });
    expect(foreign.status).toBe(403);
    expect(state.sessions?.list()).toEqual([]);

    const bad = await send("/api/integrations", { path: join(h.root, "nope") });
    expect(bad.status).toBe(404);

    const opened = await send("/api/integrations", { path: h.folder });
    expect(opened.status).toBe(201);
    const session = (await opened.json()) as IntegrationSession;
    expect(session).toMatchObject({ integration: true, inPlace: true, folder: h.folder });

    const again = await send("/api/integrations", { path: h.folder });
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(session.id);

    // Listed as a session, marked as an integration, with no repository, change, action or branch.
    const listed = await (await fetch(`${base}/api/sessions`)).json();
    expect(listed.sessions).toHaveLength(1);
    expect(listed.sessions[0]).toMatchObject({ id: session.id, integration: true });
    for (const key of ["repoId", "change", "action", "branch"]) expect(listed.sessions[0][key]).toBeUndefined();
    expect(listed.worktrees).toEqual([]);

    // Change-only routes are refused.
    for (const sub of ["ship", "prompt"]) expect((await send(`/api/sessions/${session.id}/${sub}`, { action: "implement" })).status).toBe(409);
    expect((await fetch(`${base}/api/sessions/${session.id}/worktree`)).status).toBe(409);

    // The marker appears; ending the session tracks the repository and the next discovery no longer offers it.
    await writeMarker(h.folder);
    expect((await send(`/api/sessions/${session.id}/close`, { removeWorktree: true })).status).toBe(200);
    await waitFor(() => state.config.repos.length === 1, "the repository to be tracked");
    expect((await (await fetch(`${base}/api/config`)).json()).repos[0]).toMatchObject({ path: h.folder, enabled: true });
    const after = await (await send("/api/discover")).json();
    expect(after.integratable).toEqual([]);
    expect(after.candidates).toEqual([]); // it is tracked now, so it is not a candidate either
  } finally {
    state.scanner.stop();
    server.stop(true);
  }
});

test("feature off: the endpoint refuses with 403 and starts nothing", async () => {
  const h = await harness({ enabled: false });
  const state: AppState = { config: h.config, scanner: undefined as unknown as Scanner, sessions: h.sessions };
  state.scanner = new Scanner(() => state.config, { persist: false });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "<title>stub</title>" }) });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/integrations`, { method: "POST", body: JSON.stringify({ path: h.folder }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(403);
    expect(h.sessions.list()).toEqual([]);
  } finally {
    state.scanner.stop();
    server.stop(true);
  }
});

// ---- Integrate never shares a folder (harden-session-lifecycle D7) ----

test("Integrate is refused while the console runs in the folder or below it, and the folder stays integratable", async () => {
  const h = await harness();
  const notes = join(h.folder, "notes");
  await mkdir(notes);
  for (const [folder, reason] of [
    [h.folder, "the main console is running in this folder"],
    [notes, `the main console is running in ${notes}, inside this folder`],
  ] as const) {
    h.config.agentSessions.consoleDir = folder;
    const { session } = await h.sessions.openConsole();
    const refused = await refusal(h.sessions.openIntegration(h.folder));
    expect(refused.status).toBe(409);
    expect(refused.message).toContain(reason);
    expect(h.sessions.list().filter((s) => s.integration)).toHaveLength(0);
    await h.sessions.close(session.id);
  }
  expect(h.config.repos).toEqual([]);
  // With the console ended, Integrate starts.
  expect((await h.sessions.openIntegration(h.folder)).created).toBe(true);
});
