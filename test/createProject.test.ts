import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultAgentSessions, defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { createProject, CreateProjectError } from "../src/server/createProject.ts";
import { discoverRepos } from "../src/server/discover.ts";
import { confirmIntegration, type IntegrationState } from "../src/server/integration.ts";
import { dashboardHome } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { SessionManager } from "../src/server/sessions/manager.ts";
import type { AgentProfile, Config, CreateProjectResponse, RepoConfig, Snapshot } from "../src/shared/types.ts";
import { changeSessions, DEFAULT_INTEGRATE_PROMPT, isProjectName, newProjectUnavailable } from "../src/shared/types.ts";
import { fakeMac, tempDir, treeFingerprint, useTempHome } from "./helpers.ts";
import { fakeProfile, git, waitFor, watch } from "./sessionHelpers.ts";

// Real processes in pseudo-terminals; slow CI runners need more than the 5 s default.
setDefaultTimeout(30_000);

const INTEGRATE = "set this project up for openspec";
const withIntegrate = (patch: Partial<AgentProfile> = {}) => fakeProfile({ prompts: { ...fakeProfile().prompts, integrate: INTEGRATE }, ...patch });

let cleanup: () => Promise<void>;
const managers: SessionManager[] = [];

interface Harness extends IntegrationState {
  sessions: SessionManager;
  /** The workspace root new projects are created in. */
  root: string;
  scans: number;
}

async function harness(overrides: { enabled?: boolean; agent?: AgentProfile; repos?: RepoConfig[]; scanRoots?: string[]; ignorePaths?: string[] } = {}): Promise<Harness> {
  const root = await tempDir("osd-workspace-");
  const agent = overrides.agent ?? withIntegrate();
  const config: Config = {
    ...defaultConfig(),
    scanRoots: overrides.scanRoots ?? [root],
    ignorePaths: overrides.ignorePaths ?? [],
    repos: overrides.repos ?? [],
    agentSessions: { ...defaultAgentSessions(), enabled: overrides.enabled ?? true, agents: [agent], defaultAgent: agent.id },
  };
  const snapshot: Snapshot = { generatedAt: new Date().toISOString(), repos: [] };
  const h = { config, root, scans: 0 } as Harness;
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
    onIntegrationEnded: (session) => void confirmIntegration(h, session.folder),
  });
  managers.push(h.sessions);
  return h;
}

/** A plain git repository with one commit, for the "tracked repository" cases. */
async function gitRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "# demo-ops\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
  const result = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (!(result instanceof CreateProjectError)) throw new Error(`expected a CreateProjectError, got ${String(result)}`);
  return { status: result.status, message: result.message };
}

/** A directory holding a `git` that records its working directory and arguments, then runs `body`. */
async function gitShim(body: string): Promise<{ dir: string; log: string }> {
  const dir = await tempDir("osd-git-shim-");
  const log = join(dir, "calls.log");
  await writeFile(join(dir, "git"), `#!/bin/sh\nprintf '%s|%s\\n' "$(pwd -P)" "$*" >> ${JSON.stringify(log)}\n${body}\n`, { mode: 0o755 });
  return { dir, log };
}

async function withPath<T>(prefix: string, run: () => Promise<T>): Promise<T> {
  const realPath = process.env.PATH;
  process.env.PATH = `${prefix}:${realPath}`;
  try {
    return await run();
  } finally {
    process.env.PATH = realPath;
  }
}

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

// ---- shared rules ----

test("a project name is one plain path segment", () => {
  for (const ok of ["gamma-tools", "Gamma_Tools.2", "x", "9lives", "a".repeat(100)]) expect(isProjectName(ok)).toBe(true);
  for (const bad of ["", ".", "..", "../gamma", "sub/gamma", "sub\\gamma", ".hidden", "-flag", "_x", "gamma.git", "Gamma.GIT", "a b", "a".repeat(101), "ümlaut"]) {
    expect(isProjectName(bad)).toBe(false);
  }
});

test("New project says why it is unavailable", () => {
  const agent = withIntegrate();
  const on: Config = { ...defaultConfig(), scanRoots: ["/w/acme"], agentSessions: { ...defaultAgentSessions(), enabled: true, agents: [agent], defaultAgent: agent.id } };
  const found = [{ id: agent.id, name: agent.name, available: true }];
  expect(newProjectUnavailable(on, found)).toBeUndefined();
  expect(newProjectUnavailable({ ...on, scanRoots: [] }, found)).toBe("add a workspace root in Settings first");
  expect(newProjectUnavailable({ ...on, agentSessions: { ...on.agentSessions, enabled: false } }, found)).toBe("agent sessions are disabled");
  const noPrompt = fakeProfile();
  expect(newProjectUnavailable({ ...on, agentSessions: { ...on.agentSessions, agents: [noPrompt] } }, found)).toBeUndefined(); // the default prompt applies
  expect(newProjectUnavailable(on, [{ ...found[0], available: false }])).toMatch(/was not found/);
});

// ---- the server ----

test("creating a project makes one folder holding only an empty git repository and starts the agent in it", async () => {
  const h = await harness();
  const before = structuredClone(h.config);
  const { path, session } = await createProject(h, { root: h.root, name: "gamma-tools" });
  expect(path).toBe(join(h.root, "gamma-tools"));
  expect(await readdir(h.root)).toEqual(["gamma-tools"]);
  expect(await readdir(path)).toEqual([".git"]);
  expect(Bun.spawnSync(["git", "rev-parse", "--verify", "HEAD"], { cwd: path }).exitCode).not.toBe(0); // no commits
  expect(git(path, "remote")).toBe(""); // no remote
  expect(h.config).toEqual(before); // tracking waits for the marker

  expect(session).toMatchObject({ integration: true, inPlace: true, folder: path, worktreePath: path, state: "running" });
  expect(session.branch).toBeUndefined();
  expect(changeSessions(h.sessions.list())).toEqual([]);
  const view = await watch(h.sessions, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  expect(view.text()).toContain(`cwd=${path}`);
  expect(view.text()).toContain(`args=${JSON.stringify([INTEGRATE])}`);
  view.detach();
});

test("an agent without an Integrate prompt of its own still sets up a new project, with the default prompt", async () => {
  const h = await harness({ agent: fakeProfile() }); // the stock fake profile carries no `integrate` prompt
  const { path, session } = await createProject(h, { root: h.root, name: "gamma-tools" });
  expect(session).toMatchObject({ integration: true, folder: path, state: "running" });
  const view = await watch(h.sessions, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  expect(view.text()).toContain(`args=${JSON.stringify([DEFAULT_INTEGRATE_PROMPT])}`);
  view.detach();
});

test("every refusal leaves the workspace root as it was and starts nothing", async () => {
  const cases: { h: Harness; input: Record<string, unknown>; status: number; message?: RegExp }[] = [];
  const add = (h: Harness, input: Record<string, unknown>, status: number, message?: RegExp) => cases.push({ h, input, status, message });

  const off = await harness({ enabled: false });
  add(off, { root: off.root, name: "gamma" }, 403, /agent sessions are disabled/);
  const missing = await harness({ agent: withIntegrate({ command: [join(await tempDir("osd-gone-"), "no-such-agent"), "{prompt}"] }) });
  add(missing, { root: missing.root, name: "gamma" }, 503, /was not found/);

  const h = await harness();
  for (const name of ["", "../gamma", "sub/gamma", ".", "..", "gamma.git", 42, undefined]) add(h, { root: h.root, name }, 400);
  add(h, { root: await tempDir("osd-elsewhere-"), name: "gamma" }, 404, /not one of the configured workspace roots/);
  add(h, { root: "relative/root", name: "gamma" }, 404);
  add(h, { name: "gamma" }, 404);

  const gone = await harness();
  gone.config = { ...gone.config, scanRoots: [join(gone.root, "deleted")] };
  add(gone, { root: join(gone.root, "deleted"), name: "gamma" }, 404, /does not exist/);

  const taken = await harness();
  await mkdir(join(taken.root, "a-dir"));
  await writeFile(join(taken.root, "a-file"), "x");
  await symlink(join(taken.root, "nowhere"), join(taken.root, "a-link")); // dangling, still taken
  for (const name of ["a-dir", "a-file", "a-link"]) add(taken, { root: taken.root, name }, 409, /already exists/);

  // A workspace root that lies inside a tracked repository.
  const outer = await tempDir("osd-tracked-");
  const repo = await gitRepo(join(outer, "demo-ops"));
  await mkdir(join(repo, "packages"));
  const insideRepo = await harness({ scanRoots: [join(repo, "packages")], repos: [{ ...newRepoConfig(repo, true), name: "demo-ops" }] });
  add(insideRepo, { root: join(repo, "packages"), name: "gamma" }, 409, /tracked repository demo-ops/);

  const ignoredRoot = await tempDir("osd-ignored-");
  const ignored = await harness({ scanRoots: [ignoredRoot], ignorePaths: [join(ignoredRoot, "scratch")] });
  add(ignored, { root: ignoredRoot, name: "scratch" }, 409, /ignore path/);

  const home = await harness({ scanRoots: [dashboardHome()] });
  add(home, { root: dashboardHome(), name: "gamma" }, 409, /dashboard's own folder/);

  for (const { h: each, input, status, message } of cases) {
    const root = typeof input.root === "string" && existsSync(input.root) ? input.root : each.root;
    const before = await treeFingerprint(root);
    const got = await refusal(createProject(each, input));
    expect({ input, status: got.status }).toEqual({ input, status });
    if (message) expect(got.message).toMatch(message);
    expect(await treeFingerprint(root)).toBe(before);
    expect(each.sessions.list()).toEqual([]);
  }
});

test("without git nothing is created", async () => {
  const h = await harness();
  // An empty PATH: no git anywhere. The fake agent is named by absolute path, so it is still found.
  const realPath = process.env.PATH;
  process.env.PATH = await tempDir("osd-empty-path-");
  try {
    expect(await refusal(createProject(h, { root: h.root, name: "gamma" }))).toEqual({ status: 503, message: "git was not found on this machine" });
  } finally {
    process.env.PATH = realPath;
  }
  expect(await readdir(h.root)).toEqual([]);
  expect(h.sessions.list()).toEqual([]);
});

test("on a Mac without the developer tools nothing is created and the placeholder never runs", async () => {
  const h = await harness();
  const mac = await fakeMac();
  const realPath = process.env.PATH;
  process.env.PATH = mac.usrBin;
  try {
    expect(await refusal(createProject(h, { root: h.root, name: "gamma" }))).toEqual({ status: 503, message: "git was not found on this machine" });
  } finally {
    process.env.PATH = realPath;
    mac.restore();
  }
  expect(await readdir(h.root)).toEqual([]);
  expect(h.sessions.list()).toEqual([]);
  expect(await mac.placeholderRuns()).toEqual([]);
});

test("two concurrent requests for the same name: one succeeds, the other is refused, one agent starts", async () => {
  const h = await harness();
  const results = await Promise.allSettled([createProject(h, { root: h.root, name: "gamma" }), createProject(h, { root: h.root, name: "gamma" })]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect(rejected[0].reason).toMatchObject({ status: 409 });
  expect(h.sessions.list()).toHaveLength(1);
});

test("a failing git init is reported with the folder's path; the folder stays and no agent starts", async () => {
  const h = await harness();
  const shim = await gitShim(`echo "fatal: cannot write here" >&2\nexit 128`);
  const got = await withPath(shim.dir, () => refusal(createProject(h, { root: h.root, name: "gamma" })));
  expect(got.status).toBe(500);
  expect(got.message).toContain(join(h.root, "gamma"));
  expect(got.message).toContain("cannot write here");
  expect(existsSync(join(h.root, "gamma"))).toBe(true);
  expect(h.sessions.list()).toEqual([]);
});

test("the only git command is init, in the new folder, and tracked repositories are byte for byte unchanged", async () => {
  const h = await harness();
  const tracked = await gitRepo(join(h.root, "demo-ops"));
  h.config = { ...h.config, repos: [{ ...newRepoConfig(tracked, true), name: "demo-ops" }] };
  const before = await treeFingerprint(tracked);
  const shim = await gitShim(`exec ${JSON.stringify(Bun.which("git"))} "$@"`);
  const { path, session } = await withPath(shim.dir, () => createProject(h, { root: h.root, name: "gamma" }));
  await h.sessions.close(session.id);
  expect((await readFile(shim.log, "utf8")).trim().split("\n")).toEqual([`${path}|init --quiet`]);
  expect(await readdir(path)).toEqual([".git"]);
  expect(await treeFingerprint(tracked)).toBe(before);
});

test("the marker decides: set up by the agent it is tracked; stopped early it stays integratable", async () => {
  const done = await harness();
  const created = await createProject(done, { root: done.root, name: "gamma" });
  await writeMarker(created.path); // what the agent's `openspec init` leaves behind
  await done.sessions.close(created.session.id);
  await waitFor(() => done.config.repos.length === 1, "the project to be tracked");
  expect(done.config.repos[0]).toMatchObject({ path: created.path, name: "gamma", enabled: true });
  expect(done.scans).toBe(1);

  const early = await harness();
  const started = await createProject(early, { root: early.root, name: "delta" });
  await early.sessions.close(started.session.id);
  expect(early.config.repos).toEqual([]);
  expect(early.scans).toBe(0);
  const { integratable } = await discoverRepos(early.config.repos, early.config.scanRoots, early.config.ignorePaths);
  expect(integratable.map((r) => r.path)).toEqual([started.path]);
});

// ---- the API ----

test("POST /api/projects creates the project, and a cross-site request creates nothing", async () => {
  const h = await harness();
  const state: AppState = { config: h.config, scanner: undefined as unknown as Scanner, sessions: h.sessions };
  state.scanner = new Scanner(() => state.config, { persist: false });
  Object.defineProperty(h, "config", { get: () => state.config, set: (c: Config) => (state.config = c) });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "<title>stub</title>" }) });
  const send = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${server.port}/api/projects`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
  try {
    const foreign = await send({ root: h.root, name: "gamma" }, { origin: "http://evil.example" });
    expect(foreign.status).toBe(403);
    expect(await readdir(h.root)).toEqual([]);
    expect(h.sessions.list()).toEqual([]);

    const bad = await send({ root: h.root, name: "../gamma" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/folder name/);

    const res = await send({ root: h.root, name: "gamma" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateProjectResponse;
    expect(body.path).toBe(join(h.root, "gamma"));
    expect(body.session).toMatchObject({ integration: true, inPlace: true, folder: body.path, state: "running" });

    const again = await send({ root: h.root, name: "gamma" });
    expect(again.status).toBe(409);
    expect(h.sessions.list()).toHaveLength(1);
  } finally {
    state.scanner.stop();
    server.stop(true);
  }
});

test("POST /api/projects with agent sessions off is refused and creates nothing", async () => {
  const h = await harness({ enabled: false });
  const state: AppState = { config: h.config, scanner: new Scanner(() => h.config, { persist: false }), sessions: h.sessions };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "<title>stub</title>" }) });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/projects`, { method: "POST", body: JSON.stringify({ root: h.root, name: "gamma" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(403);
    expect(await readdir(h.root)).toEqual([]);
  } finally {
    state.scanner.stop();
    server.stop(true);
  }
});
