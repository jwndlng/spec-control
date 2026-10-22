import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { BranchDeletePreview, BranchDeleteResult, RepoConfig } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { git, tempGitRepo } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
let active: RepoConfig;
let plain: RepoConfig;
let dirty: string;

const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const route = (repo: RepoConfig) => `/api/repos/${repo.id}/branches/delete`;
const previewOf = async (path: string) => (await send("GET", `${route(active)}?path=${encodeURIComponent(path)}`)).body as BranchDeletePreview;

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  const activePath = await tempGitRepo();
  dirty = join(await realpath(await tempDir("osd-wt-")), "spike");
  git(activePath, "worktree", "add", "-q", "-b", "spike/old-idea", dirty, "main");
  await writeFile(join(dirty, "idea.txt"), "half-done");
  active = newRepoConfig(activePath, true);
  const plainRoot = join(await tempDir("osd-plain-"), "plain-notes");
  await mkdir(join(plainRoot, "openspec", "changes"), { recursive: true });
  plain = newRepoConfig(plainRoot, true);
  // No session manager: agent sessions are disabled, and deleting must work regardless.
  state = { config: { ...defaultConfig(), repos: [active, plain] }, scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  state.scanner.stop();
  server.stop(true);
  await cleanup();
});

test("unknown repositories are 404, non-git ones 409, a missing path 400", async () => {
  expect((await send("GET", "/api/repos/nope/branches/delete?path=/x")).status).toBe(404);
  expect((await send("GET", `${route(plain)}?path=/x`)).status).toBe(409);
  expect((await send("GET", route(active))).status).toBe(400);
});

test("malformed bodies are 400", async () => {
  const ok = { path: dirty, branch: "spike/old-idea", commit: "a".repeat(40), statusDigest: "b".repeat(64) };
  expect((await send("POST", route(active), "{not json")).status).toBe(400);
  expect((await send("POST", route(active), { ...ok, branch: "--all" })).status).toBe(400);
  expect((await send("POST", route(active), { ...ok, commit: "HEAD" })).status).toBe(400);
  expect((await send("POST", route(active), { ...ok, statusDigest: "x" })).status).toBe(400);
  expect((await send("POST", route(active), { ...ok, path: 3 })).status).toBe(400);
});

test("a foreign origin is refused and nothing is deleted", async () => {
  const p = await previewOf(dirty);
  const res = await send("POST", route(active), { path: dirty, branch: p.branch, commit: p.commit, statusDigest: p.statusDigest }, { origin: "https://example.com" });
  expect(res.status).toBe(403);
  expect(existsSync(dirty)).toBe(true);
});

test("preview, then delete, with agent sessions disabled", async () => {
  const p = await previewOf(dirty);
  expect(p).toMatchObject({ branch: "spike/old-idea", uncommitted: ["idea.txt"], uncommittedCount: 1, managed: false });
  expect(p.refused).toBeUndefined();
  const res = await send("POST", route(active), { path: dirty, branch: p.branch, commit: p.commit, statusDigest: p.statusDigest });
  expect(res.status).toBe(200);
  const result = res.body as BranchDeleteResult;
  expect(result).toMatchObject({ outcome: "deleted", branch: "spike/old-idea", commit: p.commit, backedUp: 1 });
  expect(existsSync(dirty)).toBe(false);
  expect(git(active.path, "branch", "--list", "spike/old-idea")).toBe("");
});
