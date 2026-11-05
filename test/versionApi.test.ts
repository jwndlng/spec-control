import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { type AppState, createFetchHandler, startingFetchHandler } from "../src/server/api.ts";
import { defaultConfig } from "../src/server/config.ts";
import { Scanner } from "../src/server/scanner.ts";
import { VERSION } from "../src/server/version.ts";
import { useTempHome } from "./helpers.ts";

let home: string;
let cleanup: () => Promise<void>;
let state: AppState;

beforeAll(async () => {
  ({ home, cleanup } = await useTempHome());
  state = { config: defaultConfig(), scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
});
afterAll(async () => {
  state.scanner.stop();
  await cleanup();
});

test("the running server names itself and its version without changing its home", async () => {
  const before = await readdir(home);
  const res = await createFetchHandler({ state, indexHtml: "" })(new Request("http://127.0.0.1:4711/api/version"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toEqual({ name: "spec-control", version: VERSION });
  expect(await readdir(home)).toEqual(before);
});

test("a server that is still starting answers the version and 'starting' for everything else", async () => {
  const res = startingFetchHandler(new Request("http://127.0.0.1:4711/api/version"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ name: "spec-control", version: VERSION });
  const other = startingFetchHandler(new Request("http://127.0.0.1:4711/api/state"));
  expect(other.status).toBe(503);
  expect(await other.text()).toBe("Spec Control is starting");
  // Only a read answers: anything else is still "starting".
  expect(startingFetchHandler(new Request("http://127.0.0.1:4711/api/version", { method: "POST" })).status).toBe(503);
});

test("over a real socket, both handlers give the same body", async () => {
  const starting = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: startingFetchHandler });
  const running = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  try {
    const a = await (await fetch(`http://127.0.0.1:${starting.port}/api/version`)).json();
    const b = await (await fetch(`http://127.0.0.1:${running.port}/api/version`)).json();
    expect(a).toEqual(b);
  } finally {
    starting.stop(true);
    running.stop(true);
  }
});
