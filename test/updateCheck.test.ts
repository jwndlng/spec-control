import { afterAll, beforeEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { defaultConfig } from "../src/server/config.ts";
import { updateCheckPath } from "../src/server/paths.ts";
import { CHECK_INTERVAL_MS, parseLatestLocation, requestLatestTag, START_DELAY_MS, UpdateChecker } from "../src/server/updateCheck.ts";
import type { Config } from "../src/shared/types.ts";
import { isNewer } from "../src/shared/versions.ts";
import { useTempHome } from "./helpers.ts";

const { cleanup } = await useTempHome();
afterAll(cleanup);
beforeEach(async () => {
  await rm(updateCheckPath(), { force: true });
});

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-10-09T08:00:00Z");
const TAG_URL = "https://github.com/jwndlng/spec-control/releases/tag/";

test("parseLatestLocation accepts only this project's release tags", () => {
  expect(parseLatestLocation(`${TAG_URL}v0.12.0`)).toBe("v0.12.0");
  expect(parseLatestLocation(`${TAG_URL}nightly`)).toBeUndefined();
  expect(parseLatestLocation(`${TAG_URL}v0.12`)).toBeUndefined();
  expect(parseLatestLocation(`${TAG_URL}v0.12.0/extra`)).toBeUndefined();
  expect(parseLatestLocation("https://example.org/jwndlng/spec-control/releases/tag/v0.12.0")).toBeUndefined();
  expect(parseLatestLocation("https://github.com/someone/else/releases/tag/v0.12.0")).toBeUndefined();
  expect(parseLatestLocation("/jwndlng/spec-control/releases/tag/v0.12.0")).toBeUndefined();
  expect(parseLatestLocation(null)).toBeUndefined();
  expect(parseLatestLocation(undefined)).toBeUndefined();
});

test("isNewer compares numerically; dev and other forms are never older", () => {
  expect(isNewer("v0.10.0", "v0.9.3")).toBe(true);
  expect(isNewer("v1.0.0", "v0.99.99")).toBe(true);
  expect(isNewer("v0.10.1", "v0.10.0")).toBe(true);
  expect(isNewer("v0.10.0", "v0.10.0")).toBe(false);
  expect(isNewer("v0.9.9", "v0.10.0")).toBe(false);
  expect(isNewer("v9.9.9", "dev")).toBe(false);
  expect(isNewer("v9.9.9", "v1.2")).toBe(false);
});

test("the request is a bare HEAD carrying only the version, and the redirect is not followed", async () => {
  const seen: { method: string; path: string; search: string; headers: Record<string, string>; body: string }[] = [];
  let location = `${TAG_URL}v0.12.0`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      seen.push({ method: req.method, path: url.pathname, search: url.search, headers: Object.fromEntries(req.headers), body: await req.text() });
      return new Response(null, { status: 302, headers: { location } });
    },
  });
  try {
    const url = `http://127.0.0.1:${server.port}/jwndlng/spec-control/releases/latest`;
    expect(await requestLatestTag("v0.11.2", url)).toBe("v0.12.0");
    expect(seen).toHaveLength(1); // not followed to github.com
    const [req] = seen;
    expect(req.method).toBe("HEAD");
    expect(req.path).toBe("/jwndlng/spec-control/releases/latest");
    expect(req.search).toBe("");
    expect(req.body).toBe("");
    expect(req.headers["user-agent"]).toBe("spec-control/v0.11.2");
    expect(req.headers.cookie).toBeUndefined();
    expect(req.headers.authorization).toBeUndefined();

    location = "https://example.org/elsewhere";
    expect(await requestLatestTag("v0.11.2", url)).toBeUndefined();
  } finally {
    server.stop(true);
  }
});

test("a non-redirect answer is no tag", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("not found", { status: 404 }) });
  try {
    expect(await requestLatestTag("v0.11.2", `http://127.0.0.1:${server.port}/`)).toBeUndefined();
  } finally {
    server.stop(true);
  }
});

/** A clock and timers the test advances by hand, starting at T0. */
function fakeTime(start = T0) {
  let now = start;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimer: (run: () => void, ms: number) => {
      const id = ++next;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    pending: () => [...timers.values()].map((t) => t.at - now),
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

/** Lets a fired check finish, including its write of the remembered file (real file I/O, hence real time). */
async function settle() {
  for (let i = 0; i < 5; i++) await Bun.sleep(2);
}

/** Wait until a fired check has finished persisting and armed its next fake timer. */
async function waitForPending(time: ReturnType<typeof fakeTime>, ms: number) {
  for (let i = 0; i < 100; i++) {
    if (time.pending().includes(ms)) return;
    await Bun.sleep(5);
  }
  throw new Error(`expected a timer due in ${ms}ms, got ${time.pending().join(", ") || "none"}`);
}

function harness(opts: { version?: string; answer?: () => string | undefined; config?: Partial<Config>; start?: number } = {}) {
  const time = fakeTime(opts.start);
  const state = { config: { ...defaultConfig(), ...opts.config } as Config };
  let requests = 0;
  const checker = new UpdateChecker({
    getConfig: () => state.config,
    version: opts.version ?? "v0.11.2",
    request: async () => {
      requests++;
      const tag = (opts.answer ?? (() => "v0.12.0"))();
      if (tag === "throw") throw new Error("offline");
      return tag;
    },
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  return { time, state, checker, requests: () => requests };
}

test("first check about a minute after start, then every 24 hours, remembered on disk", async () => {
  const h = harness();
  await h.checker.load();
  h.checker.plan();
  expect(h.checker.status()).toEqual({ enabled: true, current: "v0.11.2", outcome: "never", available: false });
  await h.time.advance(START_DELAY_MS - 1);
  expect(h.requests()).toBe(0);
  await h.time.advance(1);
  expect(h.requests()).toBe(1);
  expect(h.checker.status()).toMatchObject({ outcome: "ok", latest: "v0.12.0", available: true, checkedAt: new Date(T0 + START_DELAY_MS).toISOString() });
  expect(JSON.parse(await readFile(updateCheckPath(), "utf8"))).toEqual({ checkedAt: new Date(T0 + START_DELAY_MS).toISOString(), outcome: "ok", latest: "v0.12.0" });
  await h.time.advance(CHECK_INTERVAL_MS - 1);
  expect(h.requests()).toBe(1);
  await h.time.advance(1);
  expect(h.requests()).toBe(2);
});

test("a restart within a day does not check again and reports the remembered tag", async () => {
  await writeFile(updateCheckPath(), JSON.stringify({ checkedAt: new Date(T0 - HOUR).toISOString(), outcome: "ok", latest: "v0.12.0" }));
  const h = harness();
  await h.checker.load();
  h.checker.plan();
  expect(h.checker.status()).toMatchObject({ outcome: "ok", latest: "v0.12.0", available: true });
  await h.time.advance(CHECK_INTERVAL_MS - HOUR - 1);
  expect(h.requests()).toBe(0);
  await h.time.advance(1);
  expect(h.requests()).toBe(1);
});

test("a malformed remembered file counts as never checked", async () => {
  await writeFile(updateCheckPath(), "{not json");
  const h = harness();
  await h.checker.load();
  expect(h.checker.status().outcome).toBe("never");
});

test("a failure counts as a check, keeps the last tag learned, and is retried only after 24 hours", async () => {
  let answer = "v0.12.0";
  const h = harness({ answer: () => answer });
  h.checker.plan();
  await h.time.advance(START_DELAY_MS);
  await waitForPending(h.time, CHECK_INTERVAL_MS);
  answer = "throw";
  await h.time.advance(CHECK_INTERVAL_MS);
  await waitForPending(h.time, CHECK_INTERVAL_MS);
  expect(h.requests()).toBe(2);
  expect(h.checker.status()).toMatchObject({ outcome: "failed", latest: "v0.12.0", available: true });
  await h.time.advance(CHECK_INTERVAL_MS - 1);
  expect(h.requests()).toBe(2);
  await h.time.advance(1);
  expect(h.requests()).toBe(3);
});

test("an unexpected answer on a first check records no tag", async () => {
  const h = harness({ answer: () => undefined });
  await h.checker.check();
  expect(h.checker.status()).toMatchObject({ outcome: "failed", available: false });
  expect(h.checker.status().latest).toBeUndefined();
});

test("a remembered check in the future does not postpone the next one", async () => {
  await writeFile(updateCheckPath(), JSON.stringify({ checkedAt: new Date(T0 + 30 * CHECK_INTERVAL_MS).toISOString(), outcome: "ok", latest: "v0.11.2" }));
  const h = harness();
  await h.checker.load();
  h.checker.plan();
  await h.time.advance(START_DELAY_MS);
  expect(h.requests()).toBe(1);
});

test("two concurrent checks make one request", async () => {
  const resolvers: ((tag: string) => void)[] = [];
  const time = fakeTime();
  const checker = new UpdateChecker({
    getConfig: () => defaultConfig(),
    version: "v0.11.2",
    request: () => new Promise((resolve) => resolvers.push(resolve)),
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  const a = checker.check();
  const b = checker.check();
  await settle();
  expect(resolvers).toHaveLength(1);
  resolvers[0]("v0.12.0");
  expect(await a).toEqual(await b);
  expect((await a).latest).toBe("v0.12.0");
});

test("dev and other non-release builds never check", async () => {
  for (const version of ["dev", "1.2.3", "v1.2"]) {
    const h = harness({ version });
    h.checker.plan();
    expect(h.time.pending()).toEqual([]);
    await h.time.advance(3 * CHECK_INTERVAL_MS);
    expect(h.requests()).toBe(0);
    expect(h.checker.status()).toMatchObject({ enabled: false, current: version, available: false });
  }
});

test("turning the check off cancels the planned check; turning it on re-arms", async () => {
  const h = harness();
  h.checker.plan();
  expect(h.time.pending()).toEqual([START_DELAY_MS]);
  h.state.config = { ...h.state.config, updateCheck: false };
  h.checker.plan();
  expect(h.time.pending()).toEqual([]);
  await h.time.advance(3 * CHECK_INTERVAL_MS);
  expect(h.requests()).toBe(0);
  expect(h.checker.status()).toMatchObject({ enabled: false, available: false });

  h.state.config = { ...h.state.config, updateCheck: undefined };
  h.checker.plan();
  expect(h.time.pending()).toEqual([0]); // overdue since start: due now
  await h.time.advance(0);
  expect(h.requests()).toBe(1);
});

test("a known newer tag is not announced while the check is off", async () => {
  await writeFile(updateCheckPath(), JSON.stringify({ checkedAt: new Date(T0).toISOString(), outcome: "ok", latest: "v0.12.0" }));
  const h = harness({ config: { updateCheck: false } });
  await h.checker.load();
  expect(h.checker.status()).toMatchObject({ enabled: false, latest: "v0.12.0", available: false });
});

test("re-planning keeps a timer that is already armed for the same moment", () => {
  const h = harness();
  h.checker.plan();
  h.checker.plan();
  expect(h.time.pending()).toEqual([START_DELAY_MS]);
});

test("stop clears the timer for good", async () => {
  const h = harness();
  h.checker.plan();
  h.checker.stop();
  h.checker.plan();
  expect(h.time.pending()).toEqual([]);
});
