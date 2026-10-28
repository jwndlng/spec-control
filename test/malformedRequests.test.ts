import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig, newRepoConfig, saveConfig } from "../src/server/config.ts";
import { dashboardHome } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { FIXTURES, treeFingerprint, useTempHome } from "./helpers.ts";

let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
const demoOps = join(FIXTURES, "demo-ops");

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  await mkdir(dashboardHome(), { recursive: true });
  state = { config: { ...defaultConfig(), repos: [newRepoConfig(demoOps, true)] }, scanner: undefined as unknown as Scanner };
  await saveConfig(state.config);
  state.scanner = new Scanner(() => state.config, { persist: false });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "<title>stub</title>" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  state.scanner.stop();
  server.stop(true);
  await cleanup();
});

/** Every route that takes a repository id (and a change name) from its path; `%E0` does not percent-decode. */
const ROUTES: [string, string][] = [
  ["POST", "/api/repos/%E0/enabled"],
  ...["name", "agent", "labels", "pr-title-convention", "auto-fetch", "forget"].map((s): [string, string] => ["POST", `/api/repos/%E0/${s}`]),
  ["POST", "/api/repos/%E0/pull"],
  ["GET", "/api/repos/%E0/cleanup"],
  ["POST", "/api/repos/%E0/cleanup"],
  ["GET", "/api/repos/%E0/branches/delete"],
  ["POST", "/api/repos/%E0/branches/delete"],
  ["POST", "/api/repos/%E0/console"],
  ["POST", "/api/repos/%E0/issues"],
  ["POST", "/api/repos/%E0/changes"],
  ...["%E0/changes/rotate-keys", "ID/changes/%E0"].flatMap((p): [string, string][] => [
    ["GET", `/api/repos/${p}/stale-cleanup`],
    ["POST", `/api/repos/${p}/stale-cleanup`],
    ["GET", `/api/repos/${p}/dismiss`],
    ["POST", `/api/repos/${p}/dismiss`],
    ["GET", `/api/repos/${p}/artifacts`],
    ["GET", `/api/repos/${p}/file?path=proposal.md`],
  ]),
];

test("an undecodable path segment is answered 400 on every parameterised route and changes nothing", async () => {
  const id = state.config.repos[0].id;
  const config = JSON.stringify(state.config);
  const home = await treeFingerprint(dashboardHome());
  const repo = await treeFingerprint(demoOps);
  for (const [method, path] of ROUTES) {
    const res = await fetch(`${base}${path.replace("ID", id)}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify({ name: "x", enabled: false, seconds: 0 }) : undefined,
    });
    expect([method, path, res.status]).toEqual([method, path, 400]);
    expect(((await res.json()) as { error?: string }).error).toBeString();
  }
  expect(JSON.stringify(state.config)).toBe(config);
  expect(state.scanner.scanning).toBe(false);
  expect(await treeFingerprint(dashboardHome())).toBe(home);
  expect(await treeFingerprint(demoOps)).toBe(repo);
});
