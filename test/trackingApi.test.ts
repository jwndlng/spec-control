import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { assignRepoId, defaultConfig, newRepoConfig, repoId, saveConfig } from "../src/server/config.ts";
import { configPath } from "../src/server/paths.ts";
import { type Config, repoAgentEnabled } from "../src/shared/types.ts";
import type { Snapshot } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";

let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
let work: string;
let triggered = 0;

/** A workspace root: two OpenSpec projects, one git repository without OpenSpec, and a mirror below an ignore path. */
const paths = () => ({
  alpha: join(work, "acme", "alpha-infra"),
  beta: join(work, "acme", "beta-soc"),
  plain: join(work, "acme", "chat-groups"),
  mirrored: join(work, "mirror", "beta-soc"),
});

const send = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
const saved = async (): Promise<Config> => JSON.parse(await readFile(configPath(), "utf8"));

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  work = realpathSync.native(await tempDir());
  const { alpha, beta, plain, mirrored } = paths();
  for (const dir of [alpha, beta, mirrored]) {
    await mkdir(join(dir, "openspec"), { recursive: true });
    await writeFile(join(dir, "openspec", "config.yaml"), "schema: spec-driven\n");
  }
  await mkdir(join(plain, ".git"), { recursive: true });
  state = {
    config: defaultConfig(),
    scanner: {
      trigger: () => {
        triggered++;
        return { started: true, done: Promise.resolve() };
      },
      start: () => undefined,
    } as unknown as AppState["scanner"],
  };
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  server.stop(true);
  await rm(work, { recursive: true, force: true });
  await cleanup();
});
beforeEach(async () => {
  // alpha-infra is tracked, renamed and disabled; the mirror is ignored.
  const alpha = { ...newRepoConfig(paths().alpha, false), name: "Alpha" };
  state.config = await saveConfig({ ...defaultConfig(), scanRoots: [work], ignorePaths: [join(work, "mirror")], repos: [alpha] });
  triggered = 0;
});

test("tracking a candidate adds it enabled with its default name and starts a scan", async () => {
  const res = await send("/api/repos/track", { path: paths().beta });
  expect(res.status).toBe(200);
  const config: Config = await res.json();
  expect(config.repos.find((r) => r.path === paths().beta)).toEqual(newRepoConfig(paths().beta, true));
  expect(await saved()).toEqual(config);
  expect(triggered).toBe(1);
});

test("tracking a configured repository re-enables it and keeps its name", async () => {
  const res = await send("/api/repos/track", { path: paths().alpha });
  expect(res.status).toBe(200);
  expect((await saved()).repos).toEqual([{ ...newRepoConfig(paths().alpha, true), name: "Alpha" }]);
  expect(triggered).toBe(1);
});

test("change agent overrides set and clear without triggering a scan", async () => {
  const alpha = state.config.repos[0];
  state.config = { ...state.config, repos: [{ ...alpha, enabled: true, agent: { enabled: true, changeAgents: { "gone-change": "claude" } } }], agentSessions: { ...state.config.agentSessions, enabled: true } };
  (state.scanner as unknown as { snapshot: Snapshot }).snapshot = {
    generatedAt: new Date().toISOString(),
    repos: [{ id: alpha.id, changes: [{ name: "rotate-keys" }] }],
  } as unknown as Snapshot;
  const path = `/api/repos/${alpha.id}/changes/rotate-keys/agent`;
  expect((await send(path, { agentId: "missing" })).status).toBe(400);
  expect((await send(path, {})).status).toBe(400);
  expect((await send(`/api/repos/${alpha.id}/changes/bad%20name/agent`, { agentId: null })).status).toBe(400);
  expect((await send(`/api/repos/${alpha.id}/changes/old-change/agent`, { agentId: null })).status).toBe(404);
  expect((await send(path, { agentId: null }, { origin: "https://example.com" })).status).toBe(403);
  const set = await send(path, { agentId: "claude" });
  expect(set.status).toBe(200);
  expect((await set.json() as Config).repos[0].agent?.changeAgents).toEqual({ "rotate-keys": "claude" });
  const clear = await send(path, { agentId: null });
  expect(clear.status).toBe(200);
  expect("changeAgents" in ((await clear.json() as Config).repos[0].agent ?? {})).toBe(false);
  expect(triggered).toBe(0);
  state.config = { ...state.config, repos: [{ ...state.config.repos[0], agent: { enabled: false } }] };
  expect((await send(path, { agentId: null })).status).toBe(403);
});

test("tracking a folder tracked under an older spelling re-enables that entry and adds none", async () => {
  // delta-ops was tracked, then moved to moved/, leaving a link at the stored path: the same directory.
  const old = join(work, "acme", "delta-ops");
  const now = join(work, "moved", "delta-ops");
  await mkdir(join(old, "openspec"), { recursive: true });
  await writeFile(join(old, "openspec", "config.yaml"), "schema: spec-driven\n");
  const delta = { ...newRepoConfig(old, false), name: "Delta" };
  state.config = await saveConfig({ ...state.config, repos: [...state.config.repos, delta] });
  await mkdir(join(work, "moved"));
  await rename(old, now);
  await symlink(now, old);
  try {
    const res = await send("/api/repos/track", { path: now });
    expect(res.status).toBe(200);
    const repos = (await saved()).repos;
    expect(repos.filter((r) => r.name === "Delta" || r.path === now)).toEqual([{ ...delta, path: now, enabled: true }]);
    expect(repos).toHaveLength(2);
  } finally {
    await rm(old);
    await rm(join(work, "moved"), { recursive: true });
  }
});

test("a candidate whose path's id another repository holds is tracked with the next one", async () => {
  state.config = await saveConfig({ ...state.config, repos: [{ ...state.config.repos[0], id: repoId(paths().beta) }] });
  const res = await send("/api/repos/track", { path: paths().beta });
  expect(res.status).toBe(200);
  const added = (await saved()).repos.find((r) => r.path === paths().beta);
  expect(added?.id).toBe(assignRepoId(paths().beta, [repoId(paths().beta)]));
});

test("a colliding default name is disambiguated, as for any enabled candidate", async () => {
  state.config = await saveConfig({ ...state.config, ignorePaths: [], repos: [{ ...newRepoConfig(paths().beta, true) }] });
  expect((await send("/api/repos/track", { path: paths().mirrored })).status).toBe(200);
  expect((await saved()).repos.find((r) => r.path === paths().mirrored)?.name).toBe("beta-soc (mirror)");
});

test("only a path discovery offers can be tracked", async () => {
  const before = await saved();
  for (const path of [paths().plain, paths().mirrored, join(work, "nowhere"), "/"]) {
    const res = await send("/api/repos/track", { path });
    expect([path, res.status]).toEqual([path, 404]);
  }
  expect((await send("/api/repos/track", { path: "acme/beta-soc" })).status).toBe(400);
  expect((await send("/api/repos/track", "{nope")).status).toBe(400);
  expect(await saved()).toEqual(before);
  expect(triggered).toBe(0);
});

test("a repository is disabled and enabled by id, keeping its name", async () => {
  const id = repoId(paths().alpha);
  expect((await send(`/api/repos/${id}/enabled`, { enabled: true })).status).toBe(200);
  expect((await saved()).repos[0]).toMatchObject({ enabled: true, name: "Alpha" });
  expect((await send(`/api/repos/${id}/enabled`, { enabled: false })).status).toBe(200);
  expect((await saved()).repos[0]).toMatchObject({ enabled: false, name: "Alpha" });
  expect(triggered).toBe(2);
});

test("an unknown id or a non-boolean is refused and changes nothing", async () => {
  const before = await saved();
  expect((await send("/api/repos/000000000000/enabled", { enabled: true })).status).toBe(404);
  expect((await send(`/api/repos/${repoId(paths().alpha)}/enabled`, { enabled: "yes" })).status).toBe(400);
  expect(await saved()).toEqual(before);
});

test("an ignore path is stored canonically, once, and leaves configured repositories alone", async () => {
  const res = await send("/api/ignore-paths", { path: `${join(work, "acme")}/` });
  expect(res.status).toBe(200);
  expect((await saved()).ignorePaths).toEqual([join(work, "mirror"), join(work, "acme")]);
  expect((await send("/api/ignore-paths", { path: join(work, "acme") })).status).toBe(200);
  const config = await saved();
  expect(config.ignorePaths).toEqual([join(work, "mirror"), join(work, "acme")]);
  expect(config.repos.map((r) => r.path)).toEqual([paths().alpha]);
  expect(triggered).toBe(0);
});

test("a relative ignore path is refused", async () => {
  const before = await saved();
  expect((await send("/api/ignore-paths", { path: "mirror" })).status).toBe(400);
  expect((await send("/api/ignore-paths", {})).status).toBe(400);
  expect(await saved()).toEqual(before);
});

test("a track and a disable arriving together both persist", async () => {
  state.config = await saveConfig({ ...state.config, repos: [{ ...newRepoConfig(paths().alpha, true), name: "Alpha" }] });
  const [track, disable] = await Promise.all([
    send("/api/repos/track", { path: paths().beta }),
    send(`/api/repos/${repoId(paths().alpha)}/enabled`, { enabled: false }),
  ]);
  expect([track.status, disable.status]).toEqual([200, 200]);
  const config = await saved();
  expect(config.repos.map((r) => [r.path, r.enabled])).toEqual([
    [paths().alpha, false],
    [paths().beta, true],
  ]);
  expect(state.config).toEqual(config);
});

test("the tracking routes are refused cross-site and change nothing", async () => {
  const before = await saved();
  const routes: [string, unknown][] = [
    ["/api/repos/track", { path: paths().beta }],
    [`/api/repos/${repoId(paths().alpha)}/enabled`, { enabled: true }],
    ["/api/ignore-paths", { path: join(work, "acme") }],
  ];
  for (const [path, body] of routes) {
    expect((await send(path, body, { origin: "https://example.com" })).status).toBe(403);
    expect((await fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "text/plain" } })).status).toBe(403);
  }
  expect(await saved()).toEqual(before);
  expect(triggered).toBe(0);
});

// Per-repository settings on the overview: name, agent sessions, labels, forget (dashboard-api, per-repository settings).
const alphaId = () => repoId(paths().alpha);
const alphaEntry = async () => (await saved()).repos.find((r) => r.id === alphaId());

test("a rename trims the name and keeps everything else, without a scan", async () => {
  state.config = await saveConfig({ ...state.config, repos: [{ ...newRepoConfig(paths().alpha, true), name: "Alpha", agent: { enabled: false } }] });
  const res = await send(`/api/repos/${alphaId()}/name`, { name: "  Beta SOC " });
  expect(res.status).toBe(200);
  expect(await alphaEntry()).toEqual({ ...newRepoConfig(paths().alpha, true), name: "Beta SOC", agent: { enabled: false } });
  expect(triggered).toBe(0);
});

test("a blank or missing name is refused and changes nothing", async () => {
  const before = await saved();
  for (const body of [{ name: "   " }, { name: 3 }, {}]) expect((await send(`/api/repos/${alphaId()}/name`, body)).status).toBe(400);
  expect(await saved()).toEqual(before);
});

test("agent sessions are switched off for one repository, which then counts as excluded", async () => {
  const res = await send(`/api/repos/${alphaId()}/agent`, { enabled: false });
  expect(res.status).toBe(200);
  const repo = await alphaEntry();
  expect(repo?.agent).toEqual({ enabled: false });
  expect(repoAgentEnabled({ ...repo!, enabled: true })).toBe(false);
  expect(triggered).toBe(0);
});

test("an agent is selected and cleared, keeping the on/off setting", async () => {
  const second = { id: "my-agent", name: "My agent", command: ["my-agent-cli", "{prompt}"], prompts: {} };
  state.config = await saveConfig({ ...state.config, agentSessions: { ...state.config.agentSessions, agents: [...state.config.agentSessions.agents, second] } });
  expect((await send(`/api/repos/${alphaId()}/agent`, { agentId: "my-agent" })).status).toBe(200);
  expect((await alphaEntry())?.agent).toEqual({ enabled: true, agentId: "my-agent" });
  expect((await send(`/api/repos/${alphaId()}/agent`, { agentId: null })).status).toBe(200);
  expect((await alphaEntry())?.agent).toEqual({ enabled: true });
});

test("auto-merge of docs-only pull requests is switched on and off, and off removes the key", async () => {
  expect((await send(`/api/repos/${alphaId()}/agent`, { autoMergeDocs: true })).status).toBe(200);
  expect((await alphaEntry())?.agent).toEqual({ enabled: true, autoMergeDocs: true });
  expect((await send(`/api/repos/${alphaId()}/agent`, { autoMergeDocs: false })).status).toBe(200);
  expect((await alphaEntry())?.agent).toEqual({ enabled: true });
  expect(triggered).toBe(0);
});

test("an unknown agent, a wrong type or an empty agent body is refused", async () => {
  const before = await saved();
  for (const body of [{ agentId: "nope" }, { enabled: "no" }, { agentId: 3 }, { autoMergeDocs: "yes" }, {}]) expect((await send(`/api/repos/${alphaId()}/agent`, body)).status).toBe(400);
  expect(await saved()).toEqual(before);
});

test("labels are replaced per list, and an empty list removes the key", async () => {
  state.config = await saveConfig({ ...state.config, repos: [{ ...newRepoConfig(paths().alpha, true), name: "Alpha", hiddenLabels: ["docker"] }] });
  expect((await send(`/api/repos/${alphaId()}/labels`, { labels: ["client"] })).status).toBe(200);
  expect(await alphaEntry()).toMatchObject({ labels: ["client"], hiddenLabels: ["docker"] });
  expect((await send(`/api/repos/${alphaId()}/labels`, { labels: [] })).status).toBe(200);
  const repo = await alphaEntry();
  expect(repo && "labels" in repo).toBe(false);
  expect(repo?.hiddenLabels).toEqual(["docker"]);
  expect(triggered).toBe(0);
});

test("labels that break the rules are refused naming the label", async () => {
  const before = await saved();
  const res = await send(`/api/repos/${alphaId()}/labels`, { labels: ["Infra", "infra"] });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("infra");
  for (const body of [{}, { labels: "client" }, { hiddenLabels: [1] }]) expect((await send(`/api/repos/${alphaId()}/labels`, body)).status).toBe(400);
  expect(await saved()).toEqual(before);
});

test("the pull request title convention is set and cleared, keeping everything else, without a scan", async () => {
  state.config = await saveConfig({ ...state.config, repos: [{ ...newRepoConfig(paths().alpha, true), name: "Alpha", agent: { enabled: false }, labels: ["client"] }] });
  expect((await send(`/api/repos/${alphaId()}/pr-title-convention`, { convention: "conventional-commits" })).status).toBe(200);
  expect(await alphaEntry()).toMatchObject({ name: "Alpha", enabled: true, agent: { enabled: false }, labels: ["client"], prTitleConvention: "conventional-commits" });
  expect(state.config.repos[0].prTitleConvention).toBe("conventional-commits");
  expect((await send(`/api/repos/${alphaId()}/pr-title-convention`, { convention: null })).status).toBe(200);
  const repo = await alphaEntry();
  expect(repo && "prTitleConvention" in repo).toBe(false);
  expect(repo).toMatchObject({ name: "Alpha", agent: { enabled: false }, labels: ["client"] });
  expect(triggered).toBe(0);
});

test("an unknown convention or a body without one is refused", async () => {
  const before = await saved();
  for (const body of [{ convention: "angular" }, { convention: true }, {}]) expect((await send(`/api/repos/${alphaId()}/pr-title-convention`, body)).status).toBe(400);
  expect(await saved()).toEqual(before);
});

test("auto fetch is set, switched off and reset to the default, keeping everything else, re-planning without a scan or a fetch", async () => {
  let planned = 0;
  state.autoFetcher = { plan: () => void planned++ } as unknown as AppState["autoFetcher"];
  try {
    state.config = await saveConfig({ ...state.config, repos: [{ ...newRepoConfig(paths().alpha, true), name: "Alpha", agent: { enabled: false }, labels: ["client"], prTitleConvention: "conventional-commits" }] });
    expect((await send(`/api/repos/${alphaId()}/auto-fetch`, { seconds: 15 })).status).toBe(200);
    expect(await alphaEntry()).toMatchObject({ name: "Alpha", enabled: true, agent: { enabled: false }, labels: ["client"], prTitleConvention: "conventional-commits", autoFetchSeconds: 15 });
    expect(state.config.repos[0].autoFetchSeconds).toBe(15);
    expect((await send(`/api/repos/${alphaId()}/auto-fetch`, { seconds: 0 })).status).toBe(200);
    expect(await alphaEntry()).toMatchObject({ autoFetchSeconds: 0 });
    expect((await send(`/api/repos/${alphaId()}/auto-fetch`, { seconds: 60 })).status).toBe(200);
    const repo = await alphaEntry();
    expect(repo && "autoFetchSeconds" in repo).toBe(false);
    expect(repo).toMatchObject({ name: "Alpha", prTitleConvention: "conventional-commits" });
    expect(triggered).toBe(0);
    expect(planned).toBe(3);
  } finally {
    state.autoFetcher = undefined;
  }
});

test("an unsupported auto-fetch interval or a body without one is refused", async () => {
  const before = await saved();
  for (const body of [{ seconds: 1 }, { seconds: 45 }, { seconds: "15" }, { seconds: null }, { seconds: true }, { minutes: 15 }, {}]) expect((await send(`/api/repos/${alphaId()}/auto-fetch`, body)).status).toBe(400);
  expect(await saved()).toEqual(before);
});

test("a label colour is stored under the label in lower case, and Auto removes it and then the key", async () => {
  const res = await send("/api/labels/color", { label: " Client ", hue: 290 });
  expect(res.status).toBe(200);
  expect((await res.json()).labelColors).toEqual({ client: 290 });
  expect((await saved()).labelColors).toEqual({ client: 290 });
  expect(state.config.labelColors).toEqual({ client: 290 });
  expect((await send("/api/labels/color", { label: "go", hue: 27 })).status).toBe(200);
  expect((await send("/api/labels/color", { label: "GO", hue: null })).status).toBe(200);
  expect((await saved()).labelColors).toEqual({ client: 290 });
  expect((await send("/api/labels/color", { label: "client", hue: null })).status).toBe(200);
  expect("labelColors" in (await saved())).toBe(false);
  // Auto for a label without a colour changes nothing and is not an error.
  expect((await send("/api/labels/color", { label: "client", hue: null })).status).toBe(200);
  expect(triggered).toBe(0);
});

test("an invalid hue, an invalid label or a missing field is refused and changes nothing", async () => {
  const before = await saved();
  const bodies = [{ label: "client", hue: 12.5 }, { label: "client", hue: 360 }, { label: "client", hue: -1 }, { label: "client", hue: "290" }, { label: "client" }, { hue: 290 }, { label: 3, hue: 290 }, { label: "  ", hue: 290 }, { label: "x".repeat(33), hue: 290 }];
  for (const body of bodies) expect((await send("/api/labels/color", body)).status).toBe(400);
  const comma = await send("/api/labels/color", { label: "a,b", hue: 290 });
  expect(comma.status).toBe(400);
  expect((await comma.json()).error).toContain("a,b");
  expect(await saved()).toEqual(before);
});

test("more than 200 label colours are refused", async () => {
  state.config = await saveConfig({ ...state.config, labelColors: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`l${i}`, 27])) });
  const before = await saved();
  expect((await send("/api/labels/color", { label: "one-too-many", hue: 27 })).status).toBe(400);
  expect((await send("/api/labels/color", { label: "l0", hue: 39 })).status).toBe(200);
  expect((await saved()).labelColors?.l0).toBe(39);
  expect(Object.keys((await saved()).labelColors ?? {})).toHaveLength(Object.keys(before.labelColors ?? {}).length);
  state.config = await saveConfig({ ...state.config, labelColors: undefined });
});

test("the Fast-forward warning is switched off and on at once, and nothing else changes", async () => {
  const before = await saved();
  expect(before.agentSessions.confirmFastForward).toBeUndefined();
  const off = await send("/api/agent-sessions/fast-forward-warning", { show: false });
  expect(off.status).toBe(200);
  expect((await off.json()).agentSessions.confirmFastForward).toBe(false);
  expect(await saved()).toEqual({ ...before, agentSessions: { ...before.agentSessions, confirmFastForward: false } });
  expect(state.config.agentSessions.confirmFastForward).toBe(false);
  for (const body of [{ show: "no" }, {}, { show: null }, { show: 0 }]) expect((await send("/api/agent-sessions/fast-forward-warning", body)).status).toBe(400);
  expect((await saved()).agentSessions.confirmFastForward).toBe(false);
  expect((await send("/api/agent-sessions/fast-forward-warning", { show: true })).status).toBe(200);
  expect((await saved()).agentSessions.confirmFastForward).toBe(true);
  expect(triggered).toBe(0);
  state.config = await saveConfig({ ...state.config, agentSessions: before.agentSessions });
});

test("a disabled repository is forgotten and offered by discovery again; an enabled one is refused", async () => {
  expect((await send(`/api/repos/${alphaId()}/forget`, {})).status).toBe(200);
  expect((await saved()).repos).toEqual([]);
  expect(triggered).toBe(0);
  const found = await (await send("/api/discover", {})).json();
  expect(found.candidates.map((c: { path: string }) => c.path)).toContain(paths().alpha);

  state.config = await saveConfig({ ...state.config, repos: [newRepoConfig(paths().alpha, true)] });
  expect((await send(`/api/repos/${alphaId()}/forget`, {})).status).toBe(409);
  expect((await saved()).repos).toHaveLength(1);
});

test("the settings routes refuse an unknown repository", async () => {
  const before = await saved();
  const id = "0123456789ab";
  const routes: [string, unknown][] = [
    [`/api/repos/${id}/name`, { name: "x" }],
    [`/api/repos/${id}/agent`, { enabled: false }],
    [`/api/repos/${id}/labels`, { labels: ["x"] }],
    [`/api/repos/${id}/pr-title-convention`, { convention: "conventional-commits" }],
    [`/api/repos/${id}/auto-fetch`, { seconds: 15 }],
    [`/api/repos/${id}/forget`, {}],
  ];
  for (const [path, body] of routes) expect((await send(path, body)).status).toBe(404);
  expect(await saved()).toEqual(before);
});

test("a rename and an agent switch for two repositories arriving together both persist", async () => {
  const beta = newRepoConfig(paths().beta, true);
  state.config = await saveConfig({ ...state.config, repos: [{ ...newRepoConfig(paths().alpha, true), name: "Alpha" }, beta] });
  const [rename, agent] = await Promise.all([send(`/api/repos/${alphaId()}/name`, { name: "Renamed" }), send(`/api/repos/${beta.id}/agent`, { enabled: false })]);
  expect([rename.status, agent.status]).toEqual([200, 200]);
  const config = await saved();
  expect(config.repos.map((r) => [r.name, r.agent?.enabled ?? true])).toEqual([
    ["Renamed", true],
    ["beta-soc", false],
  ]);
  expect(state.config).toEqual(config);
});

test("the settings routes are refused cross-site and change nothing", async () => {
  const before = await saved();
  const routes: [string, unknown][] = [
    [`/api/repos/${alphaId()}/name`, { name: "x" }],
    [`/api/repos/${alphaId()}/agent`, { enabled: false }],
    [`/api/repos/${alphaId()}/labels`, { labels: ["x"] }],
    [`/api/repos/${alphaId()}/pr-title-convention`, { convention: "conventional-commits" }],
    [`/api/repos/${alphaId()}/auto-fetch`, { minutes: 15 }],
    [`/api/repos/${alphaId()}/forget`, {}],
    ["/api/labels/color", { label: "client", hue: 290 }],
    ["/api/agent-sessions/fast-forward-warning", { show: false }],
  ];
  for (const [path, body] of routes) {
    expect((await send(path, body, { origin: "https://example.com" })).status).toBe(403);
    expect((await fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "text/plain" } })).status).toBe(403);
  }
  expect(await saved()).toEqual(before);
});
