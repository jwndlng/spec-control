import { afterAll, beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig, newRepoConfig, validateConfig } from "../src/server/config.ts";
import { configPath, updateCheckPath } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { UpdateChecker } from "../src/server/updateCheck.ts";
import type { UpdateStatus } from "../src/shared/types.ts";
import { installFakeGh, type GhHarness } from "./ghHelpers.ts";
import { treeFingerprint, useTempHome } from "./helpers.ts";
import { tempGitRepo } from "./sessionHelpers.ts";

setDefaultTimeout(60_000);

let cleanupHome: () => Promise<void>;
let gh: GhHarness;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
let repo: string;
let requests = 0;
let answer: string | undefined = "v0.12.0";
let gate: Promise<void> = Promise.resolve();
/** Timers the checker holds armed, by id. */
const timers = new Set<number>();
let timerId = 0;

const send = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const status = async (res: Response) => (await res.json()) as UpdateStatus & { error?: string };

beforeAll(async () => {
  ({ cleanup: cleanupHome } = await useTempHome());
  gh = await installFakeGh({ login: "demo-user", repos: {} });
  repo = await tempGitRepo();
  state = { config: { ...defaultConfig(), repos: [newRepoConfig(repo, true)] }, scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  state.updateChecker = new UpdateChecker({
    getConfig: () => state.config,
    version: "v0.11.2",
    request: async () => {
      requests++;
      await gate;
      return answer;
    },
    // Planned checks are recorded, never run: only the endpoints start one here.
    setTimer: () => {
      timers.add(++timerId);
      return timerId;
    },
    clearTimer: (id) => void timers.delete(id as number),
  });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  state.scanner.stop();
  state.updateChecker?.stop();
  server.stop(true);
  gh.restore();
  await rm(dirname(repo), { recursive: true, force: true });
  await cleanupHome();
});

beforeEach(() => {
  state.config = { ...state.config, updateCheck: undefined };
  answer = "v0.12.0";
  gate = Promise.resolve();
});

test("GET /api/update reports without a request and writes nothing", async () => {
  const before = requests;
  const body = await status(await fetch(`${base}/api/update`));
  expect(body).toMatchObject({ enabled: true, current: "v0.11.2", available: false });
  expect(requests).toBe(before);
});

test("POST /api/update/check runs a check and answers the new status", async () => {
  const res = await send("/api/update/check", "POST");
  expect(res.status).toBe(200);
  expect(await status(res)).toMatchObject({ enabled: true, current: "v0.11.2", outcome: "ok", latest: "v0.12.0", available: true });
  expect(JSON.parse(await readFile(updateCheckPath(), "utf8")).latest).toBe("v0.12.0");
  expect(await status(await fetch(`${base}/api/update`))).toMatchObject({ latest: "v0.12.0", available: true });
});

test("Check now joins a check already running", async () => {
  let open: () => void = () => undefined;
  gate = new Promise((resolve) => (open = resolve));
  const before = requests;
  const handler = createFetchHandler({ state, indexHtml: "" });
  const check = () =>
    handler(
      new Request("http://127.0.0.1/api/update/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
  const a = check();
  const b = check();
  expect(requests).toBe(before + 1);
  open();
  expect((await a).status).toBe(200);
  expect((await b).status).toBe(200);
  expect(requests).toBe(before + 1);
});

test("Check now is refused with 409 while the check is off, and makes no request", async () => {
  state.config = { ...state.config, updateCheck: false };
  const before = requests;
  const res = await send("/api/update/check", "POST");
  expect(res.status).toBe(409);
  expect(await status(res)).toMatchObject({ enabled: false, available: false });
  expect(requests).toBe(before);
});

test("a cross-site Check now is refused by the same-origin guard", async () => {
  const before = requests;
  expect((await send("/api/update/check", "POST", undefined, { origin: "https://example.com" })).status).toBe(403);
  expect((await fetch(`${base}/api/update/check`, { method: "POST", headers: { "content-type": "text/plain" } })).status).toBe(403);
  expect(requests).toBe(before);
});

test("without a checker the endpoints report checks off", async () => {
  const bare: AppState = { config: defaultConfig(), scanner: state.scanner };
  const handler = createFetchHandler({ state: bare, indexHtml: "" });
  const read = await handler(new Request("http://127.0.0.1:4711/api/update"));
  expect(await status(read)).toMatchObject({ enabled: false, outcome: "never", available: false });
  const post = await handler(new Request("http://127.0.0.1:4711/api/update/check", { method: "POST", headers: { "content-type": "application/json" } }));
  expect(post.status).toBe(409);
});

test("updateCheck: only false is stored; true is dropped; anything else is refused", async () => {
  const saved = async (updateCheck: unknown) => send("/api/config", "PUT", { ...state.config, updateCheck });
  const off = await saved(false);
  expect(off.status).toBe(200);
  expect((await off.json()).updateCheck).toBe(false);
  expect(JSON.parse(await readFile(configPath(), "utf8")).updateCheck).toBe(false);

  const on = await saved(true);
  expect(on.status).toBe(200);
  expect("updateCheck" in (await on.json())).toBe(false);
  expect("updateCheck" in JSON.parse(await readFile(configPath(), "utf8"))).toBe(false);

  const bad = await saved("no");
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toContain("updateCheck");
  expect("updateCheck" in JSON.parse(await readFile(configPath(), "utf8"))).toBe(false);

  expect(validateConfig(defaultConfig())).toEqual(defaultConfig());
});

test("saving the setting off cancels the planned check; saving it on plans one again", async () => {
  state.updateChecker?.plan();
  expect(timers.size).toBe(1);
  await send("/api/config", "PUT", { ...state.config, updateCheck: false });
  expect(timers.size).toBe(0);
  await send("/api/config", "PUT", { ...state.config, updateCheck: true });
  expect(timers.size).toBe(1);
});

test("scans, discovery, state and settings start no check", async () => {
  const before = requests;
  await state.scanner.trigger().done;
  await fetch(`${base}/api/state`);
  await fetch(`${base}/api/config`);
  await fetch(`${base}/api/update`);
  await fetch(`${base}/api/version`);
  await send("/api/discover", "POST", { scanRoots: [dirname(repo)] });
  expect(requests).toBe(before);
});

test("a check runs no git or gh and leaves the tracked repository byte-for-byte unchanged", async () => {
  const before = await treeFingerprint(repo);
  await gh.forget();
  expect((await send("/api/update/check", "POST")).status).toBe(200);
  expect(await treeFingerprint(repo)).toBe(before);
  expect(await gh.calls()).toEqual([]);
  // Nothing in the module can start a process: it has fetch and the file system, no spawn, git or gh.
  const source = await readFile(join(import.meta.dir, "../src/server/updateCheck.ts"), "utf8");
  for (const word of ["spawn", "child_process", "runGh", "./git", "./gh"]) expect(source).not.toContain(word);
});
