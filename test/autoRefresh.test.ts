import { afterEach, expect, test } from "bun:test";
import {
  AUTO_REFRESH_OPTIONS,
  AUTO_REFRESH_STORAGE_KEY,
  type AutoRefreshInterval,
  createRefreshLoop,
  intervalLabel,
  intervalMs,
  loadInterval,
  newerSnapshot,
  parseInterval,
  performRefresh,
  REFRESH_POLL_MS,
  REFRESH_POLL_TRIES,
  saveInterval,
  type TimerHandle,
} from "../src/ui/autoRefresh.ts";

// ---- The interval preference ----

test("the control offers exactly Off, 2s, 5s and 10s, in that order", () => {
  expect(AUTO_REFRESH_OPTIONS.map((o) => o.value)).toEqual(["off", "2s", "5s", "10s"]);
  expect(AUTO_REFRESH_OPTIONS.map((o) => o.label)).toEqual(["Off", "2s", "5s", "10s"]);
  expect(AUTO_REFRESH_OPTIONS.map((o) => o.ms)).toEqual([0, 2_000, 5_000, 10_000]);
});

test("parse is tolerant: anything unrecognised means off", () => {
  for (const raw of [null, undefined, "", "3s", "2", "2000", "off ", "OFF", "10", "nonsense"]) expect(parseInterval(raw)).toBe("off");
  expect(parseInterval("off")).toBe("off");
  expect(parseInterval("2s")).toBe("2s");
  expect(parseInterval("5s")).toBe("5s");
  expect(parseInterval("10s")).toBe("10s");
});

test("every option maps to its milliseconds and its label, and only off never ticks", () => {
  expect(intervalMs("off")).toBe(0);
  expect(intervalMs("2s")).toBe(2_000);
  expect(intervalMs("5s")).toBe(5_000);
  expect(intervalMs("10s")).toBe(10_000);
  expect(intervalLabel("off")).toBe("Off");
  expect(intervalLabel("10s")).toBe("10s");
});

/** A minimal localStorage, installed as the global the module reads. `throws` makes every access fail. */
function stubStorage(options: { throws?: boolean } = {}): Map<string, string> {
  const store = new Map<string, string>();
  const fail = () => {
    throw new Error("storage unavailable");
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: options.throws
      ? { getItem: fail, setItem: fail, removeItem: fail }
      : {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => void store.set(key, value),
          removeItem: (key: string) => void store.delete(key),
        },
  });
  return store;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("the choice round-trips through storage, and off removes the key", () => {
  const store = stubStorage();
  for (const interval of ["2s", "5s", "10s"] as AutoRefreshInterval[]) {
    saveInterval(interval);
    expect(store.get(AUTO_REFRESH_STORAGE_KEY)).toBe(interval);
    expect(loadInterval()).toBe(interval);
  }
  saveInterval("off");
  expect(store.has(AUTO_REFRESH_STORAGE_KEY)).toBe(false);
  expect(loadInterval()).toBe("off");
});

test("a value left by another version is ignored rather than applied", () => {
  const store = stubStorage();
  store.set(AUTO_REFRESH_STORAGE_KEY, "3s");
  expect(loadInterval()).toBe("off");
});

test("unavailable storage means off, and saving does not throw", () => {
  stubStorage({ throws: true });
  expect(loadInterval()).toBe("off");
  expect(() => saveInterval("5s")).not.toThrow();
  expect(() => saveInterval("off")).not.toThrow();
});

test("with no storage at all the module still answers off", () => {
  Reflect.deleteProperty(globalThis, "localStorage");
  expect(loadInterval()).toBe("off");
  expect(() => saveInterval("2s")).not.toThrow();
});

// ---- The refresh loop ----

/** A fake clock: nothing fires until `advance` passes the delay a timer was armed with. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fire: () => void }>();
  const calls = { setTimer: 0, clearTimer: 0 };
  return {
    now: () => now,
    pending: () => timers.size,
    calls,
    setTimer: (fire: () => void, ms: number): TimerHandle => {
      calls.setTimer++;
      const id = nextId++;
      timers.set(id, { at: now + ms, fire });
      return id;
    },
    clearTimer: (handle: TimerHandle) => {
      calls.clearTimer++;
      timers.delete(handle as number);
    },
    /** Moves time forward, firing every timer that comes due, then lets pending promises settle. */
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fire();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

/** A `run` that records its calls and only resolves when the test says so. */
function controllableRun() {
  const resolvers: (() => void)[] = [];
  let calls = 0;
  return {
    calls: () => calls,
    run: () => {
      calls++;
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    /** Resolves the oldest outstanding call and lets its continuation run. */
    async finishOne() {
      resolvers.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test("the first tick comes one interval after start, and the chain continues", async () => {
  const clock = fakeClock();
  const work = controllableRun();
  const loop = createRefreshLoop({ intervalMs: 2_000, run: work.run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  loop.start();

  await clock.advance(1_999);
  expect(work.calls()).toBe(0);
  await clock.advance(1);
  expect(work.calls()).toBe(1);
  expect(loop.isRefreshing()).toBe(true);

  await work.finishOne();
  expect(loop.isRefreshing()).toBe(false);
  await clock.advance(2_000);
  expect(work.calls()).toBe(2);
  loop.stop();
});

test("a refresh slower than the interval starts no second one, and the next delay runs from its completion", async () => {
  const clock = fakeClock();
  const work = controllableRun();
  const loop = createRefreshLoop({ intervalMs: 2_000, run: work.run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  loop.start();

  await clock.advance(2_000);
  expect(work.calls()).toBe(1);
  // Six seconds of refresh: three intervals' worth, and still exactly one call.
  await clock.advance(6_000);
  expect(work.calls()).toBe(1);
  expect(clock.pending()).toBe(0);

  await work.finishOne();
  // The next one is two seconds from the completion, not from when it was due.
  await clock.advance(1_999);
  expect(work.calls()).toBe(1);
  await clock.advance(1);
  expect(work.calls()).toBe(2);
  loop.stop();
});

test("a tick due while the user's own refresh is in flight is dropped, not queued", async () => {
  const clock = fakeClock();
  // app.tsx's shared refresh: one guard, whether the button or the loop asks. A call while busy returns at once.
  let busy = false;
  let started = 0;
  let release: (() => void) | undefined;
  const refresh = () => {
    if (busy) return Promise.resolve();
    busy = true;
    started++;
    return new Promise<void>((resolve) => {
      release = () => {
        busy = false;
        resolve();
      };
    });
  };
  const loop = createRefreshLoop({ intervalMs: 2_000, run: refresh, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  loop.start();

  // The user clicks Refresh one second in, while the loop's first tick is still armed.
  await clock.advance(1_000);
  void refresh();
  expect(started).toBe(1);

  // The tick comes due during that refresh: it asks, is turned away, and re-arms rather than queueing.
  await clock.advance(1_000);
  expect(started).toBe(1);
  expect(clock.pending()).toBe(1);

  release?.();
  await Promise.resolve();
  await Promise.resolve();

  // Only now does the loop scan again — one refresh at a time, never a backlog.
  await clock.advance(2_000);
  expect(started).toBe(2);
  release?.();
  loop.stop();
});

test("a rejected refresh clears the guard and the chain carries on", async () => {
  const clock = fakeClock();
  let calls = 0;
  const loop = createRefreshLoop({
    intervalMs: 2_000,
    run: () => {
      calls++;
      return Promise.reject(new Error("scan failed"));
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  loop.start();

  await clock.advance(2_000);
  expect(calls).toBe(1);
  expect(loop.isRefreshing()).toBe(false);
  await clock.advance(2_000);
  expect(calls).toBe(2);
  loop.stop();
});

test("stop cancels the pending tick and nothing arrives afterwards", async () => {
  const clock = fakeClock();
  const work = controllableRun();
  const loop = createRefreshLoop({ intervalMs: 2_000, run: work.run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  loop.start();
  expect(clock.pending()).toBe(1);

  loop.stop();
  expect(clock.pending()).toBe(0);
  await clock.advance(60_000);
  expect(work.calls()).toBe(0);
});

test("stopping during a refresh lets it finish without re-arming", async () => {
  const clock = fakeClock();
  const work = controllableRun();
  const loop = createRefreshLoop({ intervalMs: 2_000, run: work.run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  loop.start();
  await clock.advance(2_000);
  expect(work.calls()).toBe(1);

  loop.stop();
  await work.finishOne();
  expect(clock.pending()).toBe(0);
  await clock.advance(60_000);
  expect(work.calls()).toBe(1);
});

test("pause holds the chain and resume refreshes once straight away", async () => {
  const clock = fakeClock();
  const work = controllableRun();
  const loop = createRefreshLoop({ intervalMs: 2_000, run: work.run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  loop.start();

  loop.pause();
  expect(clock.pending()).toBe(0);
  await clock.advance(10 * 60_000);
  expect(work.calls()).toBe(0);

  loop.resume();
  expect(work.calls()).toBe(1); // immediately, without waiting an interval
  await work.finishOne();
  await clock.advance(2_000);
  expect(work.calls()).toBe(2);
  loop.stop();
});

test("resuming while a refresh is in flight does not start a second one", async () => {
  const clock = fakeClock();
  const work = controllableRun();
  const loop = createRefreshLoop({ intervalMs: 2_000, run: work.run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  loop.start();
  await clock.advance(2_000);
  expect(work.calls()).toBe(1);

  loop.pause();
  loop.resume();
  expect(work.calls()).toBe(1);
  await work.finishOne();
  await clock.advance(2_000);
  expect(work.calls()).toBe(2);
  loop.stop();
});

test("pause, resume, start and stop are safe to repeat", async () => {
  const clock = fakeClock();
  const work = controllableRun();
  const loop = createRefreshLoop({ intervalMs: 2_000, run: work.run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  loop.resume(); // never started
  loop.pause();
  expect(work.calls()).toBe(0);

  loop.start();
  loop.start(); // no second chain
  expect(clock.pending()).toBe(1);
  loop.pause();
  loop.pause();
  expect(clock.pending()).toBe(0);
  loop.resume();
  loop.resume();
  expect(work.calls()).toBe(1);
  await work.finishOne();

  loop.stop();
  loop.stop();
  await clock.advance(60_000);
  expect(work.calls()).toBe(1);
});

test("the loop calls nothing but run and the injected timers, so no timer path can pull", async () => {
  const clock = fakeClock();
  const work = controllableRun();
  const loop = createRefreshLoop({ intervalMs: 2_000, run: work.run, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  loop.start();
  for (let i = 0; i < 5; i++) {
    await clock.advance(2_000);
    await work.finishOne();
  }
  loop.pause();
  loop.resume();
  await work.finishOne();
  loop.stop();

  // Every refresh went through `run`; the loop reached no API, no snapshot and no pull.
  expect(work.calls()).toBe(6);
  expect(clock.calls.setTimer).toBeGreaterThan(0);
  expect(clock.pending()).toBe(0);
});

// ---- One refresh ----

/**
 * A stand-in for the UI's API object that records every call. `pull` and the rest are present and throw, so a refresh
 * that reached for anything but the scan and the snapshot would fail the test loudly rather than quietly work.
 */
function stubApi(snapshots: { generatedAt: string }[], options: { started?: boolean; scanFails?: string } = {}) {
  const calls: string[] = [];
  let index = 0;
  const forbidden = (name: string) => () => {
    calls.push(name);
    throw new Error(`a refresh must not call ${name}`);
  };
  return {
    calls,
    api: {
      scan: async () => {
        calls.push("scan");
        if (options.scanFails) throw new Error(options.scanFails);
        return { started: options.started ?? true };
      },
      state: async () => {
        calls.push("state");
        const next = snapshots[Math.min(index, snapshots.length - 1)];
        index++;
        return next;
      },
      pull: forbidden("pull"),
      pullAll: forbidden("pullAll"),
      saveConfig: forbidden("saveConfig"),
      createChange: forbidden("createChange"),
      dismissChange: forbidden("dismissChange"),
      cleanup: forbidden("cleanup"),
    },
  };
}

const immediate = () => Promise.resolve();

test("a refresh scans, waits for the snapshot that scan produced, and reports success", async () => {
  const taken: { generatedAt: string }[] = [];
  const errors: (string | null)[] = [];
  const { api, calls } = stubApi([{ generatedAt: "t0" }, { generatedAt: "t0" }, { generatedAt: "t1" }]);

  await performRefresh({ api, before: "t0", waitForScan: true, delay: immediate, onSnapshot: (s) => taken.push(s), onError: (e) => errors.push(e) });

  expect(taken).toEqual([{ generatedAt: "t1" }]);
  expect(errors).toEqual([null]);
  // It stopped looking as soon as the snapshot changed, and reached nothing but scan and state.
  expect(calls).toEqual(["scan", "state", "state", "state"]);
});

test("an unchanged snapshot is not taken, so the view does not churn", async () => {
  const taken: { generatedAt: string }[] = [];
  const { api } = stubApi([{ generatedAt: "t0" }]);
  await performRefresh({ api, before: "t0", waitForScan: false, delay: immediate, onSnapshot: (s) => taken.push(s), onError: () => {} });
  expect(taken).toEqual([]);
});

test("an automatic tick does not hold the wait open for a scan it did not start", async () => {
  const { api, calls } = stubApi([{ generatedAt: "t0" }], { started: false });
  await performRefresh({ api, before: "t0", waitForScan: false, delay: immediate, onSnapshot: () => {}, onError: () => {} });
  // One look, not forty: a scan someone else is running is reason to re-arm, not to wait.
  expect(calls).toEqual(["scan", "state"]);
});

test("the button keeps waiting even when its scan was not the one that started", async () => {
  const taken: { generatedAt: string }[] = [];
  const { api, calls } = stubApi([{ generatedAt: "t0" }, { generatedAt: "t1" }], { started: false });
  await performRefresh({ api, before: "t0", waitForScan: true, delay: immediate, onSnapshot: (s) => taken.push(s), onError: () => {} });
  expect(taken).toEqual([{ generatedAt: "t1" }]);
  expect(calls).toEqual(["scan", "state", "state"]);
});

test("a wait that never sees a new snapshot gives up after a bounded number of looks", async () => {
  const taken: { generatedAt: string }[] = [];
  const errors: (string | null)[] = [];
  let waited = 0;
  const { api, calls } = stubApi([{ generatedAt: "t0" }]);

  await performRefresh({
    api,
    before: "t0",
    waitForScan: true,
    delay: async (ms) => {
      waited += ms;
    },
    onSnapshot: (s) => taken.push(s),
    onError: (e) => errors.push(e),
  });

  expect(taken).toEqual([]);
  expect(calls.filter((c) => c === "state")).toHaveLength(REFRESH_POLL_TRIES);
  expect(waited).toBe(REFRESH_POLL_TRIES * REFRESH_POLL_MS);
  // Giving up is not an error: the API answered every time.
  expect(errors).toEqual([null]);
});

test("a failed scan is reported and nothing is taken", async () => {
  const taken: { generatedAt: string }[] = [];
  const errors: (string | null)[] = [];
  const { api } = stubApi([{ generatedAt: "t1" }], { scanFails: "scan refused" });
  await performRefresh({ api, before: "t0", waitForScan: true, delay: immediate, onSnapshot: (s) => taken.push(s), onError: (e) => errors.push(e) });
  expect(taken).toEqual([]);
  expect(errors).toEqual(["scan refused"]);
});

test("a successful refresh clears an error a previous one left in the header", async () => {
  const errors: (string | null)[] = [];
  const failing = stubApi([{ generatedAt: "t0" }], { scanFails: "connection refused" });
  await performRefresh({ api: failing.api, before: "t0", waitForScan: false, delay: immediate, onSnapshot: () => {}, onError: (e) => errors.push(e) });
  const working = stubApi([{ generatedAt: "t1" }]);
  await performRefresh({ api: working.api, before: "t0", waitForScan: false, delay: immediate, onSnapshot: () => {}, onError: (e) => errors.push(e) });
  expect(errors).toEqual(["connection refused", null]);
});

test("auto-refresh drives many refreshes and never contacts a remote", async () => {
  const clock = fakeClock();
  const seen: string[] = [];
  let n = 0;
  const { api, calls } = stubApi([{ generatedAt: "t0" }]);
  const loop = createRefreshLoop({
    intervalMs: 2_000,
    run: () =>
      performRefresh({
        api: { scan: api.scan, state: async () => ({ generatedAt: `t${++n}` }) },
        before: seen.at(-1),
        waitForScan: false,
        delay: immediate,
        onSnapshot: (s) => seen.push(s.generatedAt),
        onError: () => {},
      }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  loop.start();
  for (let i = 0; i < 10; i++) await clock.advance(2_000);
  loop.stop();

  expect(seen).toHaveLength(10);
  // Ten refreshes, and `pull` was never among the calls: the timer cannot reach a remote.
  expect(calls.filter((c) => c === "scan")).toHaveLength(10);
  expect(calls).not.toContain("pull");
  expect(calls).not.toContain("pullAll");
});

// ---- Snapshots only move forward ----

test("a slow poll after Refresh: the older snapshot is discarded, the refreshed one stays", () => {
  const beforeRefresh = "2026-10-28T09:00:00.000Z";
  const refreshed = "2026-10-28T09:00:04.000Z";
  let shown: string | undefined;
  const take = (next: string) => {
    if (newerSnapshot(shown, next)) shown = next;
  };
  take(beforeRefresh); // initial load
  take(refreshed); // the refresh's new scan
  take(beforeRefresh); // the poll that was in flight answers late
  expect(shown).toBe(refreshed);
});

test("same snapshot again is taken, and anything is taken when nothing is shown", () => {
  expect(newerSnapshot("2026-10-28T09:00:00.000Z", "2026-10-28T09:00:00.000Z")).toBe(true);
  expect(newerSnapshot(undefined, "2026-10-28T09:00:00.000Z")).toBe(true);
  expect(newerSnapshot("2026-10-28T09:00:01.000Z", "2026-10-28T09:00:00.999Z")).toBe(false);
});
