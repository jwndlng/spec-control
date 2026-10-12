import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { canonicalPath, dashboardHome } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { GithubClone, GithubRepoList } from "../src/shared/types.ts";
import { ghRepo, installFakeGh, type GhHarness } from "./ghHelpers.ts";
import { redirectGithub, type GithubRedirect } from "./githubHelpers.ts";
import { tempDir, treeFingerprint, useTempHome } from "./helpers.ts";
import { git } from "./sessionHelpers.ts";

setDefaultTimeout(60_000);

let cleanupHome: () => Promise<void>;
let gh: GhHarness;
let github: GithubRedirect;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
/** The workspace root clones go into; it also holds the tracked `demo-ops`. */
let root: string;
let demoOps: string;
/** Every git invocation, as `cwd|args`, through a shim first on PATH that then runs the real git. */
let gitLog: string;
let shimDir: string;
let realPath: string | undefined;

const SCENARIO = {
  login: "jdoe",
  owners: {
    jdoe: [ghRepo({ nameWithOwner: "jdoe/alpha-infra", pushedAt: "2026-09-01T10:00:00Z" }), ghRepo({ nameWithOwner: "jdoe/demo-ops", pushedAt: "2026-10-01T10:00:00Z" })],
  },
};

const post = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as GithubRepoList & GithubClone & { error?: string; clones?: GithubClone[] } };
};
const clones = async () => ((await (await fetch(`${base}/api/github/clones`)).json()) as { clones: GithubClone[] }).clones;
const gitCalls = async () => (await readFile(gitLog, "utf8")).split("\n").filter(Boolean);
const forgetGit = () => writeFile(gitLog, "");
const settled = (id: string) => state.githubClones?.settled(id) ?? Promise.resolve();

beforeAll(async () => {
  ({ cleanup: cleanupHome } = await useTempHome());
  await mkdir(dashboardHome(), { recursive: true });
  gh = await installFakeGh(SCENARIO);
  github = await redirectGithub();
  await github.repo("acme/beta-soc", { openspec: true });
  await github.repo("acme/chat-groups", { openspec: false });

  const realGit = Bun.which("git");
  shimDir = await tempDir("osd-git-shim-");
  gitLog = join(shimDir, "calls.log");
  await writeFile(gitLog, "");
  await writeFile(join(shimDir, "git"), `#!/bin/sh\nprintf '%s|%s\\n' "$(pwd -P)" "$*" >> ${JSON.stringify(gitLog)}\nexec ${JSON.stringify(realGit)} "$@"\n`, { mode: 0o755 });
  realPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${process.env.PATH}`;

  root = await tempDir("osd-gh-root-");
  demoOps = join(root, "demo-ops");
  await mkdir(join(demoOps, "openspec"), { recursive: true });
  await writeFile(join(demoOps, "openspec", "config.yaml"), "schema: spec-driven\n");
  git(demoOps, "init", "-q", "-b", "main");
  git(demoOps, "remote", "add", "origin", "git@github.com:jdoe/demo-ops.git");
  state = { config: { ...defaultConfig(), scanRoots: [root], repos: [{ ...newRepoConfig(demoOps, true), name: "demo-ops" }] }, scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  state.scanner.stop();
  process.env.PATH = realPath;
  github.restore();
  gh.restore();
  await rm(root, { recursive: true, force: true });
  await cleanupHome();
});

// ---- the listing ----

test("POST /api/github/repos lists the signed-in account's repositories and marks the ones already added", async () => {
  await gh.forget();
  const { status, body } = await post("/api/github/repos", {});
  expect(status).toBe(200);
  expect(body.status).toBe("ok");
  expect(body.owner).toBe("jdoe");
  expect(body.repos.map((r) => [r.repo, r.added])).toEqual([
    ["jdoe/demo-ops", true],
    ["jdoe/alpha-infra", false],
  ]);
  const calls = await gh.calls();
  expect(calls.map((c) => `${c.argv[0]} ${c.argv[1]}`)).toEqual(["api user", "repo list"]);
  for (const call of calls) expect(call.cwd.startsWith(root)).toBe(false);
});

test("an invalid owner is refused with 400 and starts no gh", async () => {
  await gh.forget();
  expect((await post("/api/github/repos", { owner: "acme/../x" })).status).toBe(400);
  expect((await post("/api/github/repos", { owner: 42 })).status).toBe(400);
  expect(await gh.calls()).toEqual([]);
});

test("without gh the listing is unavailable and starts no process", async () => {
  await gh.forget();
  process.env.PATH = shimDir;
  try {
    const { body } = await post("/api/github/repos", {});
    expect(body.status).toBe("unavailable");
    expect(body.reason).toContain("install gh");
  } finally {
    process.env.PATH = `${shimDir}:${realPath}`;
  }
  expect(await gh.calls()).toEqual([]);
});

test("listing touches no file in a tracked repository, the workspace root or the home", async () => {
  const before = await Promise.all([root, dashboardHome()].map(treeFingerprint));
  await gh.forget();
  await forgetGit();
  await post("/api/github/repos", {});
  await post("/api/github/repos", { owner: "acme" });
  expect(await Promise.all([root, dashboardHome()].map(treeFingerprint))).toEqual(before);
  for (const call of await gh.calls()) expect(["api user", "repo list"]).toContain(`${call.argv[0]} ${call.argv[1]}`);
  // Only the read-only origin lookup of the "already added" marks, never a clone.
  for (const call of await gitCalls()) expect(call).toContain("config --get remote.origin.url");
});

// ---- cloning ----

test("cloning an OpenSpec repository answers 202 and then tracks it", async () => {
  const { status, body } = await post("/api/github/clone", { repo: "acme/beta-soc", root, name: "beta-soc" });
  expect(status).toBe(202);
  expect(body.state).toBe("cloning");
  expect(body.path).toBe(join(root, "beta-soc"));
  await settled(body.id);
  expect((await clones()).find((c) => c.id === body.id)?.state).toBe("tracked");
  expect(state.config.repos.find((r) => r.path === join(root, "beta-soc"))).toMatchObject({ name: "beta-soc", enabled: true });
  const config = (await (await fetch(`${base}/api/config`)).json()) as typeof state.config;
  expect(config.repos.some((r) => r.path === join(root, "beta-soc") && r.enabled)).toBe(true);
});

test("a clone without OpenSpec is listed by discovery as integratable once it finished", async () => {
  const { body } = await post("/api/github/clone", { repo: "acme/chat-groups", root, name: "chat-groups" });
  await settled(body.id);
  expect((await clones()).find((c) => c.id === body.id)?.state).toBe("integratable");
  expect(state.config.repos.some((r) => r.path === join(root, "chat-groups"))).toBe(false);
  const discovered = (await (await fetch(`${base}/api/discover`, { method: "POST", headers: { "content-type": "application/json" } })).json()) as { integratable: { path: string }[] };
  expect(discovered.integratable.map((r) => r.path)).toContain(join(root, "chat-groups"));
});

test("a failed clone is listed as failed and leaves no folder; it can be dismissed but not while running", async () => {
  const { status, body } = await post("/api/github/clone", { repo: "acme/missing-repo", root, name: "missing-repo" });
  expect(status).toBe(202);
  await settled(body.id);
  const failed = (await clones()).find((c) => c.id === body.id);
  expect(failed?.state).toBe("failed");
  expect(failed?.reason).toBeTruthy();
  expect(existsSync(join(root, "missing-repo"))).toBe(false);
  const dismissed = await post("/api/github/clones/dismiss", { id: body.id });
  expect(dismissed.status).toBe(200);
  expect(dismissed.body.clones?.some((c) => c.id === body.id)).toBe(false);
  expect((await post("/api/github/clones/dismiss", { id: body.id })).status).toBe(404);

  const slow = await post("/api/github/clone", { repo: github.slowRepo, root, name: "slow-repo" });
  expect((await post("/api/github/clones/dismiss", { id: slow.body.id })).status).toBe(409);
  // Its "remote" gives up after a few seconds; nothing later should see it still running.
  await settled(slow.body.id);
});

test("cancel answers the cancelled entry, 409 once finished and 404 when unknown; the list carries progress", async () => {
  const slow = await post("/api/github/clone", { repo: github.slowRepo, root, name: "slow-cancel" });
  expect(slow.status).toBe(202);
  const listed = (await clones()).find((c) => c.id === slow.body.id);
  expect(listed?.state).toBe("cloning");
  expect(listed?.progress?.phase).toBe("connecting");
  expect(listed?.progress?.updatedAt).toBeDefined();
  const cancelled = await post("/api/github/clones/cancel", { id: slow.body.id });
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.state).toBe("cancelled");
  expect(existsSync(join(root, "slow-cancel"))).toBe(false);
  expect((await post("/api/github/clones/cancel", { id: slow.body.id })).status).toBe(409);
  expect((await post("/api/github/clones/cancel", { id: "clone-404" })).status).toBe(404);
  // A cancelled clone is dismissed like a failed one.
  expect((await post("/api/github/clones/dismiss", { id: slow.body.id })).status).toBe(200);

  const tracked = (await clones()).find((c) => c.state === "tracked");
  expect(tracked).toBeDefined();
  const before = await treeFingerprint(tracked?.path ?? "");
  expect((await post("/api/github/clones/cancel", { id: tracked?.id })).status).toBe(409);
  expect(await treeFingerprint(tracked?.path ?? "")).toBe(before);
});

test("refusals answer 400, 404 and 409 and create nothing and start no process", async () => {
  await mkdir(join(root, "taken"));
  const before = await readdir(root);
  await forgetGit();
  expect((await post("/api/github/clone", { repo: "https://example.test/acme/beta-soc", root, name: "beta-soc" })).status).toBe(400);
  expect((await post("/api/github/clone", { repo: "acme/../../etc", root, name: "etc" })).status).toBe(400);
  expect((await post("/api/github/clone", { repo: "acme/beta-soc", root, name: "../escape" })).status).toBe(400);
  expect((await post("/api/github/clone", { repo: "acme/beta-soc", root: "/w/other", name: "beta-soc" })).status).toBe(404);
  const exists = await post("/api/github/clone", { repo: "acme/beta-soc", root, name: "taken" });
  expect(exists.status).toBe(409);
  expect(exists.body.error).toContain("already exists");
  expect((await post("/api/github/clone", { repo: "acme/beta-soc", root: demoOps, name: "x" })).status).toBe(404);
  expect(await readdir(root)).toEqual(before);
  expect(await gitCalls()).toEqual([]);
});

test("without git a clone is refused with 503", async () => {
  process.env.PATH = "/nonexistent";
  try {
    expect((await post("/api/github/clone", { repo: "acme/beta-soc", root, name: "no-git" })).status).toBe(503);
  } finally {
    process.env.PATH = `${shimDir}:${realPath}`;
  }
  expect(existsSync(join(root, "no-git"))).toBe(false);
});

test("cross-site requests are refused with 403 and start nothing", async () => {
  await gh.forget();
  await forgetGit();
  const foreign = { origin: "http://evil.example.test" };
  expect((await post("/api/github/clone", { repo: "acme/beta-soc", root, name: "evil" }, foreign)).status).toBe(403);
  expect((await post("/api/github/repos", {}, foreign)).status).toBe(403);
  expect((await post("/api/github/clones/dismiss", { id: "clone-1" }, foreign)).status).toBe(403);
  expect(existsSync(join(root, "evil"))).toBe(false);
  expect(await gh.calls()).toEqual([]);
  expect(await gitCalls()).toEqual([]);
  // A cross-site cancel leaves a running clone running.
  const slow = await post("/api/github/clone", { repo: github.slowRepo, root, name: "slow-foreign" });
  expect((await post("/api/github/clones/cancel", { id: slow.body.id }, foreign)).status).toBe(403);
  expect((await clones()).find((c) => c.id === slow.body.id)?.state).toBe("cloning");
  expect(existsSync(join(root, "slow-foreign"))).toBe(true);
  await post("/api/github/clones/cancel", { id: slow.body.id });
});

// ---- no side effects (5.2) ----

test("a scan, discovery, the state and the clone list start no clone and no gh", async () => {
  await gh.forget();
  await forgetGit();
  await state.scanner.trigger().done;
  await fetch(`${base}/api/state`);
  await fetch(`${base}/api/github/clones`);
  await fetch(`${base}/api/discover`, { method: "POST", headers: { "content-type": "application/json" } });
  expect(await gh.calls()).toEqual([]);
  for (const call of await gitCalls()) expect(call).not.toMatch(/\bclone\b/);
});

test("a clone changes nothing outside its target folder and runs one git clone from the dashboard home", async () => {
  const outside = [demoOps, join(root, "beta-soc")];
  const before = await Promise.all(outside.map(treeFingerprint));
  const entriesBefore = await readdir(root);
  await forgetGit();
  const { body } = await post("/api/github/clone", { repo: "acme/chat-groups", root, name: "chat-groups-2" });
  await settled(body.id);
  expect(await Promise.all(outside.map(treeFingerprint))).toEqual(before);
  expect((await readdir(root)).sort()).toEqual([...entriesBefore, "chat-groups-2"].sort());
  const clonesRun = (await gitCalls()).filter((call) => / clone /.test(call));
  expect(clonesRun).toHaveLength(1);
  expect(clonesRun[0].split("|")[0]).toBe(canonicalPath(dashboardHome()));
  expect(clonesRun[0]).toContain("https://github.com/acme/chat-groups.git");
});
