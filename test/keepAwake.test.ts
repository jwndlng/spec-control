// Keep awake (openspec/specs/keep-awake). No real power assertion is ever taken here: the holder runs a fake
// `caffeinate` that records its argv and stays alive until it is ended, or no process at all.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig } from "../src/server/config.ts";
import { BUSY_WINDOW_MS, type HeldProcess, isBusy, KeepAwake, type KeepAwakeDeps } from "../src/server/keepAwake.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { SessionManager } from "../src/server/sessions/manager.ts";
import type { Config, KeepAwakeStatus } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { harness, waitFor, watch } from "./sessionHelpers.ts";

// Some tests start real processes in pseudo-terminals; slow CI runners need more than the 5 s default.
setDefaultTimeout(30_000);

const MIN = 60_000;
const NOW = 1_800_000_000_000;
const PID = 4242;

let cleanup: () => Promise<void>;
let dir: string;
let fake: string;
let log: string;
const holders: KeepAwake[] = [];
const managers: SessionManager[] = [];

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  dir = await tempDir("osd-keep-awake-");
  log = join(dir, "caffeinate.log");
  fake = join(dir, "caffeinate");
  // Records "<pid> <args>" when it starts and "end <pid>" when it is ended, and otherwise waits.
  await writeFile(fake, `#!/bin/sh\necho "$$ $*" >> '${log}'\ntrap 'echo "end $$" >> '"'${log}'"'; exit 0' TERM\nwhile :; do sleep 0.05; done\n`);
  await chmod(fake, 0o755);
});
afterEach(async () => {
  for (const h of holders.splice(0)) h.stop();
  for (const m of managers.splice(0)) await m.shutdown();
  await writeFile(log, "");
});
afterAll(() => cleanup());

const lines = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean);
const starts = async () => (await lines()).filter((l) => !l.startsWith("end "));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A holder over a fake world: `busy`, `running` and the config are the test's to change. */
function holder(patch: Partial<KeepAwakeDeps> = {}) {
  const world = { busy: 0, running: false, now: NOW, reads: 0, config: defaultConfig() as Config };
  const keep = new KeepAwake({
    getConfig: () => world.config,
    busyCount: () => world.busy,
    anyRunning: () => world.running,
    readReports: async () => void world.reads++,
    command: fake,
    platform: "darwin",
    pid: PID,
    now: () => world.now,
    ...patch,
  });
  holders.push(keep);
  return { world, keep };
}

test("busy: recent output, a working report through silence; never a waiting report, silence or an ended session", () => {
  expect(isBusy({ running: true, lastOutputAt: NOW - MIN }, NOW)).toBe(true);
  expect(isBusy({ running: true, lastOutputAt: NOW - 6 * MIN }, NOW)).toBe(false);
  expect(isBusy({ running: true, lastOutputAt: NOW - BUSY_WINDOW_MS }, NOW)).toBe(true);
  expect(isBusy({ running: true }, NOW)).toBe(false);
  expect(isBusy({ running: true, lastOutputAt: NOW - 20 * MIN, current: "working" }, NOW)).toBe(true);
  expect(isBusy({ running: true, current: "working" }, NOW)).toBe(true);
  expect(isBusy({ running: true, lastOutputAt: NOW - 10_000, current: "waiting" }, NOW)).toBe(false);
  expect(isBusy({ running: false, lastOutputAt: NOW, current: "working" }, NOW)).toBe(false);
});

test("one caffeinate for two busy sessions, started with -i -w <pid> and nothing else, ended at once with the last", async () => {
  const { world, keep } = holder();
  expect(keep.available).toBe(true);
  world.busy = 2;
  world.running = true;
  keep.evaluate();
  keep.evaluate();
  await waitFor(async () => (await starts()).length === 1, "caffeinate started");
  const [pid, ...args] = (await starts())[0].split(" ");
  expect(args).toEqual(["-i", "-w", String(PID)]);
  expect(keep.status()).toEqual({ available: true, enabled: true, active: true, sessions: 2 });

  world.busy = 1; // one of them ended: still held, by the same process
  keep.evaluate();
  expect(keep.status().active).toBe(true);
  expect(await starts()).toHaveLength(1);

  world.busy = 0;
  world.running = false;
  keep.evaluate();
  expect(keep.status()).toEqual({ available: true, enabled: true, active: false, sessions: 0 });
  await waitFor(() => !alive(Number(pid)), "caffeinate ended");
});

test("switching the setting off ends it; the busy sessions are still counted", async () => {
  const { world, keep } = holder();
  world.busy = 1;
  world.running = true;
  keep.evaluate();
  await waitFor(async () => (await starts()).length === 1, "caffeinate started");
  const pid = Number((await starts())[0].split(" ")[0]);
  world.config = { ...world.config, keepAwake: false };
  keep.evaluate();
  expect(keep.status()).toEqual({ available: true, enabled: false, active: false, sessions: 1 });
  await waitFor(() => !alive(pid), "caffeinate ended");
});

test("unavailable off macOS or without an executable caffeinate: nothing is ever started", async () => {
  for (const patch of [{ platform: "linux" as const }, { command: join(dir, "missing") }, { command: log }]) {
    const spawned: string[][] = [];
    const { world, keep } = holder({ ...patch, spawn: (argv) => {
        spawned.push(argv);
        return { kill() {}, exited: new Promise(() => {}) };
      }, });
    world.busy = 1;
    world.running = true;
    keep.evaluate();
    expect(keep.available).toBe(false);
    expect(keep.status()).toEqual({ available: false, enabled: true, active: false, sessions: 1 });
    expect(keep.timerArmed).toBe(false);
    expect(spawned).toEqual([]);
  }
});

test("a caffeinate that dies on its own is started again at most once a minute", async () => {
  let exit: () => void = () => {};
  const spawned: string[][] = [];
  const spawn = (argv: string[]): HeldProcess => {
    spawned.push(argv);
    return { kill() {}, exited: new Promise<void>((resolve) => (exit = resolve)) };
  };
  const { world, keep } = holder({ spawn });
  world.busy = 1;
  world.running = true;
  keep.evaluate();
  expect(spawned).toHaveLength(1);
  exit();
  await waitFor(() => !keep.status().active, "the death noticed");
  world.now += 30_000;
  keep.evaluate();
  expect(spawned).toHaveLength(1);
  world.now += 30_000;
  keep.evaluate();
  expect(spawned).toHaveLength(2);
  expect(keep.status().active).toBe(true);

  // Released on purpose and needed again: no wait.
  world.busy = 0;
  keep.evaluate();
  world.busy = 1;
  keep.evaluate();
  expect(spawned).toHaveLength(3);
});

test("the periodic evaluation exists only while a session runs, the setting is on and it is available; it reads reports first", async () => {
  const { world, keep } = holder({ intervalMs: 30, spawn: () => ({ kill() {}, exited: new Promise(() => {}) }) });
  keep.evaluate();
  expect(keep.timerArmed).toBe(false);
  world.running = true;
  keep.evaluate();
  expect(keep.timerArmed).toBe(true);
  world.busy = 1; // noticed by the timer alone
  await waitFor(() => keep.status().active, "the timer's evaluation");
  expect(world.reads).toBeGreaterThan(0);
  world.config = { ...world.config, keepAwake: false };
  keep.evaluate();
  expect(keep.timerArmed).toBe(false);
  world.config = { ...world.config, keepAwake: undefined };
  keep.evaluate();
  expect(keep.timerArmed).toBe(true);
  world.running = false;
  world.busy = 0;
  keep.evaluate();
  expect(keep.timerArmed).toBe(false);
});

test("stopped, it ends caffeinate and starts nothing again", async () => {
  const { world, keep } = holder();
  world.busy = 1;
  world.running = true;
  keep.evaluate();
  await waitFor(async () => (await starts()).length === 1, "caffeinate started");
  const pid = Number((await starts())[0].split(" ")[0]);
  keep.stop();
  expect(keep.timerArmed).toBe(false);
  keep.evaluate();
  expect(keep.status().active).toBe(false);
  await waitFor(() => !alive(pid), "caffeinate ended");
  expect(await starts()).toHaveLength(1);
});

/** A real session of the fake agent, past its banner. */
async function running(h: Awaited<ReturnType<typeof harness>>, manager: SessionManager) {
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const view = await watch(manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent banner");
  return { s, view };
}

async function report(manager: SessionManager, view: { text: () => string }, id: string, word: string): Promise<void> {
  const before = view.text().split(`you said: report ${word}`).length;
  manager.write(id, `report ${word}\r`);
  await waitFor(() => view.text().split(`you said: report ${word}`).length > before, `the agent reported ${word}`);
}

test("the manager counts busy sessions of every kind from output times and reports, and says when one starts or ends", async () => {
  const h = await harness();
  let changed = 0;
  const manager = h.newManager({ echoWindowMs: 50, onRunningChanged: () => void changed++ });
  managers.push(manager);
  expect(manager.anyRunning()).toBe(false);
  const { s, view } = await running(h, manager);
  expect(changed).toBe(1);
  expect(manager.anyRunning()).toBe(true);
  const now = Date.now();
  expect(manager.busyCount(now)).toBe(1);
  expect(manager.busyCount(now + 6 * MIN)).toBe(0);

  await report(manager, view, s.id, "working");
  await manager.readReports();
  expect(manager.busyCount(Date.now() + 20 * MIN)).toBe(1);

  await report(manager, view, s.id, "waiting");
  await manager.readReports();
  expect(manager.busyCount(Date.now())).toBe(0); // although it printed just now

  // The main console counts like any session.
  const { session: console } = await manager.openConsole();
  const consoleView = await watch(manager, console.id);
  await waitFor(() => consoleView.text().includes("fake-agent ready"), "console banner");
  expect(changed).toBe(2);
  expect(manager.busyCount(Date.now())).toBe(1);

  await manager.close(s.id);
  expect(changed).toBe(3);
  await manager.close(console.id);
  expect(changed).toBe(4);
  expect(manager.busyCount(Date.now())).toBe(0);
  expect(manager.anyRunning()).toBe(false);
});

test("GET /api/sessions reports keep-awake, evaluated with that request's reports; saving it off releases at once", async () => {
  const h = await harness();
  const manager = h.newManager();
  managers.push(manager);
  const spawned: string[][] = [];
  const killed: string[][] = [];
  const state: AppState = { config: h.config, scanner: new Scanner(() => state.config, { persist: false }, h.snapshot), sessions: manager };
  state.keepAwake = new KeepAwake({
    getConfig: () => state.config,
    busyCount: (now) => manager.busyCount(now),
    anyRunning: () => manager.anyRunning(),
    readReports: () => manager.readReports(),
    command: fake,
    platform: "darwin",
    spawn: (argv) => {
      spawned.push(argv);
      return { kill: () => void killed.push(argv), exited: new Promise(() => {}) };
    },
  });
  holders.push(state.keepAwake);
  const handler = createFetchHandler({ state, indexHtml: "" });
  const keepAwake = async () => ((await (await handler(new Request("http://127.0.0.1:4711/api/sessions"))).json()) as { keepAwake: KeepAwakeStatus }).keepAwake;

  expect(await keepAwake()).toEqual({ available: true, enabled: true, active: false, sessions: 0 });
  await running(h, manager);
  expect(await keepAwake()).toEqual({ available: true, enabled: true, active: true, sessions: 1 });
  expect(spawned).toHaveLength(1);

  const saved = await handler(
    new Request("http://127.0.0.1:4711/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:4711" },
      body: JSON.stringify({ ...state.config, keepAwake: false }),
    }),
  );
  expect(saved.status).toBe(200);
  expect(state.config.keepAwake).toBe(false);
  expect(killed).toHaveLength(1); // by the save itself, before anyone asks again
  expect(await keepAwake()).toEqual({ available: true, enabled: false, active: false, sessions: 1 });
  expect(spawned).toHaveLength(1);
  state.scanner.stop();
});
