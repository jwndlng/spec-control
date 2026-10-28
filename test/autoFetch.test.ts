import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { AutoFetcher } from "../src/server/autoFetch.ts";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { type FetchOutcome, fetchRepository, pullRepository } from "../src/server/pull.ts";
import { AUTO_FETCH_SECONDS, type Config, type RepoConfig, type RepoSnapshot, type Snapshot } from "../src/shared/types.ts";
import { useTempHome } from "./helpers.ts";
import { hookLog, installRepoHooks } from "./hookHelpers.ts";
import { type Fixture, fixture, git, remoteCommits } from "./pullHelpers.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** A clock and timers the test advances by hand. */
function fakeTime() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimer: (run: () => void, ms: number) => {
      const id = ++next;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    pending: () => timers.size,
    /** Runs every timer that falls due within `ms`, in order, letting fetches settle between them. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      now = end;
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

const repo = (id: string, extra: Partial<RepoConfig> = {}): RepoConfig => ({ id, path: `/w/acme/${id}`, name: id, enabled: true, ...extra });
const scanned = (id: string, extra: Partial<RepoSnapshot> = {}): RepoSnapshot => ({ id, name: id, path: `/w/acme/${id}`, ok: true, scannedAt: "", isGit: true, hasRemote: true, worktrees: [], changes: [], ...extra });

function harness(repos: RepoConfig[], snapshots: RepoSnapshot[], outcome: (r: RepoConfig) => FetchOutcome = () => ({ ok: true, at: "t", moved: false })) {
  const time = fakeTime();
  const state: { config: Config; snapshot: Snapshot } = { config: { ...defaultConfig(), repos }, snapshot: { generatedAt: "", repos: snapshots } };
  const fetched: string[] = [];
  const moved: string[] = [];
  const fetcher = new AutoFetcher({
    getConfig: () => state.config,
    getSnapshot: () => state.snapshot,
    onMoved: (id) => moved.push(id),
    fetch: async (r) => {
      fetched.push(r.id);
      return outcome(r);
    },
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  return { time, state, fetched, moved, fetcher };
}

test("the offered intervals and Off are exactly what the configuration accepts", async () => {
  const { newRepoConfig, validateConfig } = await import("../src/server/config.ts");
  const valid = newRepoConfig("/w/acme/a", true);
  for (const seconds of [0, ...AUTO_FETCH_SECONDS]) {
    expect(validateConfig({ ...defaultConfig(), repos: [{ ...valid, autoFetchSeconds: seconds }] }).repos[0].autoFetchSeconds as number).toBe(seconds);
  }
  for (const seconds of [1, 45, 120, "15", null]) {
    expect(() => validateConfig({ ...defaultConfig(), repos: [{ ...valid, autoFetchSeconds: seconds }] })).toThrow();
  }
});

test("a saved autoFetchMinutes becomes the same interval in seconds", async () => {
  const { migrateConfig, newRepoConfig, validateConfig } = await import("../src/server/config.ts");
  const base = newRepoConfig("/w/acme/a", true);
  const migrate = (entry: Record<string, unknown>) => migrateConfig({ ...defaultConfig(), repos: [{ ...base, ...entry }] });
  const repoOf = (result: { config: unknown }) => (result.config as { repos: Record<string, unknown>[] }).repos[0];

  const five = migrate({ autoFetchMinutes: 5 });
  expect(five.changed).toBe(true);
  expect(repoOf(five)).toMatchObject({ autoFetchSeconds: 300 });
  expect("autoFetchMinutes" in repoOf(five)).toBe(false);
  expect(validateConfig(five.config).repos[0].autoFetchSeconds).toBe(300);
  expect(repoOf(migrate({ autoFetchMinutes: 60 })).autoFetchSeconds).toBe(3600);
  // both keys: the new one wins, the old one goes
  const both = repoOf(migrate({ autoFetchMinutes: 15, autoFetchSeconds: 0 }));
  expect(both.autoFetchSeconds).toBe(0);
  expect("autoFetchMinutes" in both).toBe(false);
  // not an old interval: left for validation to report
  expect(repoOf(migrate({ autoFetchMinutes: 7 })).autoFetchMinutes).toBe(7);
  // nothing saved: nothing to migrate, and the project is now fetched every minute
  const none = migrate({});
  expect(none.changed).toBe(false);
  expect("autoFetchSeconds" in repoOf(none)).toBe(false);
});

test("on by default: a project without a setting is fetched every minute", async () => {
  const h = harness([repo("a")], [scanned("a")]);
  h.fetcher.plan();
  expect(h.time.pending()).toBe(1);
  await h.time.advance(59 * SECOND);
  expect(h.fetched).toEqual([]);
  await h.time.advance(151 * SECOND);
  expect(h.fetched).toEqual(["a", "a", "a"]);
});

test("every 15 seconds", async () => {
  const h = harness([repo("a", { autoFetchSeconds: 15 })], [scanned("a")]);
  h.fetcher.plan();
  await h.time.advance(61 * SECOND);
  expect(h.fetched).toEqual(["a", "a", "a", "a"]);
});

test("a fetch still running when the next one falls due is not started twice", async () => {
  const releases: (() => void)[] = [];
  const fetched: string[] = [];
  const time = fakeTime();
  const fetcher = new AutoFetcher({
    getConfig: () => ({ ...defaultConfig(), repos: [repo("a", { autoFetchSeconds: 15 })] }),
    getSnapshot: () => ({ generatedAt: "", repos: [scanned("a")] }),
    onMoved: () => undefined,
    fetch: (r) => {
      fetched.push(r.id);
      return new Promise<FetchOutcome>((resolve) => releases.push(() => resolve({ ok: true, at: "t", moved: false })));
    },
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  fetcher.plan();
  await time.advance(15 * SECOND);
  expect(fetched).toEqual(["a"]);
  await time.advance(30 * SECOND); // two more turns fall due while the first fetch takes 40 seconds
  expect(fetched).toEqual(["a"]);
  expect(time.pending()).toBe(1); // the timer keeps re-arming
  releases.shift()?.();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await time.advance(15 * SECOND);
  expect(fetched).toEqual(["a", "a"]);
});

test("switched off: nothing is scheduled and nothing fetched", async () => {
  const h = harness([repo("a", { autoFetchSeconds: 0 }), repo("b", { autoFetchSeconds: 0 })], [scanned("a"), scanned("b")]);
  h.fetcher.plan();
  expect(h.time.pending()).toBe(0);
  await h.time.advance(120 * MINUTE);
  expect(h.fetched).toEqual([]);
});

test("every 15 minutes: three fetches in 46 minutes, the first one interval after the start", async () => {
  const h = harness([repo("a", { autoFetchSeconds: 900 })], [scanned("a")]);
  h.fetcher.plan();
  await h.time.advance(14 * MINUTE);
  expect(h.fetched).toEqual([]);
  await h.time.advance(32 * MINUTE);
  expect(h.fetched).toEqual(["a", "a", "a"]);
});

test("re-planning keeps an unchanged timer, so a rescan never postpones a fetch", async () => {
  const h = harness([repo("a", { autoFetchSeconds: 300 })], [scanned("a")]);
  h.fetcher.plan();
  await h.time.advance(4 * MINUTE);
  h.fetcher.plan();
  h.fetcher.plan();
  await h.time.advance(1 * MINUTE);
  expect(h.fetched).toEqual(["a"]);
});

test("changing the interval re-arms one new interval out; switching off cancels a pending fetch", async () => {
  const h = harness([repo("a", { autoFetchSeconds: 3600 })], [scanned("a")]);
  h.fetcher.plan();
  await h.time.advance(30 * MINUTE);
  h.state.config = { ...h.state.config, repos: [repo("a", { autoFetchSeconds: 300 })] };
  h.fetcher.plan();
  await h.time.advance(5 * MINUTE);
  expect(h.fetched).toEqual(["a"]);
  await h.time.advance(5 * MINUTE);
  expect(h.fetched).toEqual(["a", "a"]);

  h.state.config = { ...h.state.config, repos: [repo("a", { autoFetchSeconds: 0 })] };
  h.fetcher.plan();
  expect(h.time.pending()).toBe(0);
  await h.time.advance(60 * MINUTE);
  expect(h.fetched).toEqual(["a", "a"]);
});

test("a disabled project, a folder without git, one without a remote and one whose scan failed are skipped", async () => {
  const repos = [repo("off", { enabled: false, autoFetchSeconds: 300 }), repo("plain", { autoFetchSeconds: 300 }), repo("lonely", { autoFetchSeconds: 300 }), repo("broken", { autoFetchSeconds: 300 }), repo("ok", { autoFetchSeconds: 300 })];
  const snaps = [scanned("off"), scanned("plain", { isGit: false, hasRemote: undefined }), scanned("lonely", { hasRemote: false }), scanned("broken", { ok: false }), scanned("ok")];
  const h = harness(repos, snaps);
  h.fetcher.plan();
  await h.time.advance(5 * MINUTE);
  expect(h.fetched).toEqual(["ok"]);
  // the setting is kept for the disabled project
  expect(h.state.config.repos[0].autoFetchSeconds).toBe(300);
});

test("a project disabled between arming and firing is not fetched", async () => {
  const h = harness([repo("a", { autoFetchSeconds: 300 })], [scanned("a")]);
  h.fetcher.plan();
  h.state.config = { ...h.state.config, repos: [repo("a", { enabled: false, autoFetchSeconds: 300 })] }; // no plan() yet
  await h.time.advance(5 * MINUTE);
  expect(h.fetched).toEqual([]);
});

test("only a fetch that moved a ref asks for a rescan; outcomes are reported, a failure retried one interval later", async () => {
  let call = 0;
  const h = harness([repo("a", { autoFetchSeconds: 300 })], [scanned("a")], () => {
    call++;
    if (call === 1) return { ok: true, at: "t1", moved: false };
    if (call === 2) return { ok: false, at: "t2", moved: false, reason: "could not resolve host" };
    return { ok: true, at: "t3", moved: true };
  });
  h.fetcher.plan();
  await h.time.advance(5 * MINUTE);
  expect(h.moved).toEqual([]);
  expect(h.fetcher.outcome("a")).toEqual({ at: "t1", ok: true });
  await h.time.advance(4 * MINUTE);
  expect(h.fetched).toHaveLength(1);
  await h.time.advance(1 * MINUTE);
  expect(h.fetcher.outcome("a")).toEqual({ at: "t2", ok: false, reason: "could not resolve host" });
  expect(h.fetcher.withOutcomes(h.state.snapshot).repos[0].autoFetch).toEqual({ at: "t2", ok: false, reason: "could not resolve host" });
  await h.time.advance(5 * MINUTE);
  expect(h.moved).toEqual(["a"]);
  expect(h.fetcher.outcome("a")?.ok).toBe(true);
});

test("a successful pull clears a reported failure; a skipped fetch reports nothing", async () => {
  const h = harness([repo("a", { autoFetchSeconds: 300 })], [scanned("a")], () => ({ ok: false, at: "t", moved: false, reason: "timed out" }));
  h.fetcher.plan();
  await h.time.advance(5 * MINUTE);
  expect(h.fetcher.outcome("a")?.ok).toBe(false);
  h.fetcher.notePull({ repoId: "a", fetched: true, update: "up-to-date" });
  expect(h.fetcher.outcome("a")?.ok).toBe(true);

  const skipped = harness([repo("b", { autoFetchSeconds: 300 })], [scanned("b")], () => ({ skipped: true, ok: false, at: "t", moved: false }));
  skipped.fetcher.plan();
  await skipped.time.advance(5 * MINUTE);
  expect(skipped.fetched).toEqual(["b"]);
  expect(skipped.fetcher.outcome("b")).toBeUndefined();
  expect(skipped.time.pending()).toBe(1); // the next attempt is one interval later
});

test("many projects falling due at once are fetched a few at a time", async () => {
  const ids = ["a", "b", "c", "d", "e"];
  let running = 0;
  let most = 0;
  const releases: (() => void)[] = [];
  const time = fakeTime();
  const fetcher = new AutoFetcher({
    getConfig: () => ({ ...defaultConfig(), repos: ids.map((id) => repo(id, { autoFetchSeconds: 300 })) }),
    getSnapshot: () => ({ generatedAt: "", repos: ids.map((id) => scanned(id)) }),
    onMoved: () => undefined,
    fetch: () => {
      running++;
      most = Math.max(most, running);
      return new Promise<FetchOutcome>((resolve) =>
        releases.push(() => {
          running--;
          resolve({ ok: true, at: "t", moved: false });
        }),
      );
    },
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  fetcher.plan();
  await time.advance(5 * MINUTE);
  expect(running).toBe(3);
  while (releases.length > 0) {
    releases.shift()?.();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  expect(most).toBe(3);
  expect(running).toBe(0);
});

test("stop clears every timer", () => {
  const h = harness([repo("a", { autoFetchSeconds: 300 }), repo("b", { autoFetchSeconds: 900 })], [scanned("a"), scanned("b")]);
  h.fetcher.plan();
  expect(h.time.pending()).toBe(2);
  h.fetcher.stop();
  expect(h.time.pending()).toBe(0);
  h.fetcher.plan();
  expect(h.time.pending()).toBe(0);
});

test("nothing is fetched while setup is pending, and fetching starts once it is done", async () => {
  const { time, state, fetched, fetcher } = harness([repo("alpha-infra")], [scanned("alpha-infra")]);
  state.config = { ...state.config, setup: "pending" };
  fetcher.plan();
  expect(time.pending()).toBe(0);
  await time.advance(5 * MINUTE);
  expect(fetched).toEqual([]);
  const { setup: _, ...done } = state.config;
  state.config = done;
  fetcher.plan();
  expect(time.pending()).toBe(1);
  await time.advance(MINUTE);
  expect(fetched).toEqual(["alpha-infra"]);
  // A timer armed before setup became pending again (Run setup again never sets it, but a reset does) fetches nothing.
  state.config = { ...state.config, setup: "pending" };
  await time.advance(MINUTE);
  expect(fetched).toEqual(["alpha-infra"]);
  fetcher.stop();
});

// ---------------------------------------------------------------------------------------------------------------------
// The automatic fetch against real repositories: no hooks, and nothing pruned whatever the configuration says.
// ---------------------------------------------------------------------------------------------------------------------

describe("against a real repository", () => {
  let cleanupHome: () => Promise<void>;
  const bases: string[] = [];
  beforeAll(async () => {
    ({ cleanup: cleanupHome } = await useTempHome());
  });
  afterAll(async () => {
    for (const b of bases) await rm(b, { recursive: true, force: true });
    await cleanupHome();
  });
  const make = async (): Promise<Fixture> => {
    const f = await fixture();
    bases.push(f.base);
    return f;
  };

  test("hooks do not run: an automatic fetch moves origin/main and no hook ran", async () => {
    const f = await make();
    const log = await installRepoHooks(f.repo);
    await remoteCommits(f, 1);
    expect(await fetchRepository(newRepoConfig(f.repo, true))).toMatchObject({ ok: true, moved: true });
    expect(git(f.repo, "rev-parse", "origin/main")).toBe(git(f.other, "rev-parse", "HEAD"));
    expect(await hookLog(log)).toEqual([]);
  });

  test("prune configured: a remote-tracking ref of a deleted remote branch survives the automatic fetch and the pull", async () => {
    const f = await make();
    git(f.other, "push", "-q", "origin", "HEAD:refs/heads/feat/old-work");
    git(f.repo, "fetch", "-q", "origin");
    const ref = git(f.repo, "rev-parse", "refs/remotes/origin/feat/old-work");
    git(f.other, "push", "-q", "origin", ":refs/heads/feat/old-work");
    for (const [key, value] of [
      ["fetch.prune", "true"],
      ["fetch.pruneTags", "true"],
      ["remote.origin.prune", "true"],
    ]) {
      git(f.repo, "config", key, value);
    }
    const repo = newRepoConfig(f.repo, true);
    await remoteCommits(f, 1);
    expect(await fetchRepository(repo)).toMatchObject({ ok: true, moved: true });
    expect(git(f.repo, "rev-parse", "refs/remotes/origin/feat/old-work")).toBe(ref);
    await remoteCommits(f, 1);
    expect(await pullRepository(repo)).toMatchObject({ update: "fast-forwarded" });
    expect(git(f.repo, "rev-parse", "refs/remotes/origin/feat/old-work")).toBe(ref);
  });
});
