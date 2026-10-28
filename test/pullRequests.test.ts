import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pullRequestsCachePath } from "../src/server/paths.ts";
import { githubRepoFromRemote, parseMergeable, parsePullRequest, PullRequests, type RepoTarget, summarizeChecks } from "../src/server/pullRequests.ts";
import type { PullRequest } from "../src/shared/types.ts";
import { checkRun, ghPr, installFakeGh, statusContext, type GhHarness } from "./ghHelpers.ts";
import { gitIn, tempDir, useTempHome } from "./helpers.ts";

// Spawning the fake gh in a real process is fast, but CI runners are not; the 5 s default is too tight for the
// tests that start several at once.
setDefaultTimeout(30_000);

let gh: GhHarness;
let cleanupHome: () => Promise<void>;
const dirs: string[] = [];

beforeAll(async () => {
  ({ cleanup: cleanupHome } = await useTempHome());
  gh = await installFakeGh({ login: "demo-user", repos: { "acme/alpha-infra": { open: [ghPr({ number: 7 })], closed: [] } } });
});

afterAll(async () => {
  gh.restore();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  await cleanupHome();
});

/** A real git repository with the given `origin`, so the store's own remote lookup is exercised. */
async function repoAt(name: string, origin?: string): Promise<string> {
  const dir = join(await tempDir("osd-pr-"), name);
  dirs.push(dir);
  await mkdir(dir, { recursive: true });
  await gitIn(dir, "init", "-q", "-b", "main");
  if (origin) await gitIn(dir, "remote", "add", "origin", origin);
  return dir;
}

/** A tracked folder that is not a git repository at all. */
async function plainDir(): Promise<string> {
  const dir = join(await tempDir("osd-pr-plain-"), "notes");
  dirs.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

const ALPHA = "https://github.com/acme/alpha-infra.git";
const BETA = "git@github.com:acme/beta-soc.git";
const newStore = (patch: { now?: () => number; timeoutMs?: number } = {}) => new PullRequests({ timeoutMs: 2000, ...patch });

// ---- the fake gh itself (1.2) ----

const run = async (...args: string[]) => {
  const proc = Bun.spawn(["gh", ...args], { cwd: process.env.SPEC_CONTROL_HOME, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: process.env });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
};

test("the fake gh answers pr list and api user from the scenario, and records how it was called", async () => {
  await gh.scenario({ login: "demo-user", repos: { "acme/alpha-infra": { open: [ghPr({ number: 7 })], closed: [] } } });
  await gh.forget();
  const list = await run("pr", "list", "--repo", "acme/alpha-infra", "--state", "open", "--limit", "101", "--json", "number,title");
  expect(list.code).toBe(0);
  expect(JSON.parse(list.out)).toMatchObject([{ number: 7, title: "change 7" }]);

  const user = await run("api", "user", "--jq", ".login");
  expect(user.code).toBe(0);
  expect(user.out.trim()).toBe("demo-user");

  const calls = await gh.calls();
  expect(calls.map((c) => c.argv.slice(0, 2))).toEqual([
    ["pr", "list"],
    ["api", "user"],
  ]);
  expect(calls[0].cwd).toBe(await realpath(process.env.SPEC_CONTROL_HOME as string));
});

test("the fake gh can play not signed in, a non-zero exit and an unknown repository", async () => {
  await gh.scenario({ mode: "not-logged-in" });
  const denied = await run("pr", "list", "--repo", "acme/alpha-infra", "--limit", "101");
  expect(denied.code).toBe(1);
  expect(denied.err).toContain("gh auth login");

  await gh.scenario({ mode: "fail", stderr: "HTTP 502", exitCode: 3 });
  const failed = await run("pr", "list", "--repo", "acme/alpha-infra", "--limit", "101");
  expect(failed.code).toBe(3);
  expect(failed.err).toContain("HTTP 502");

  await gh.scenario({ repos: {} });
  const empty = await run("pr", "list", "--repo", "acme/unknown", "--limit", "101");
  expect(JSON.parse(empty.out)).toEqual([]);
});

test("the fake gh hangs on request, so the runner's timeout can be exercised", async () => {
  await gh.scenario({ mode: "hang" });
  const proc = Bun.spawn(["gh", "pr", "list", "--repo", "acme/alpha-infra"], { stdout: "pipe", stderr: "ignore", stdin: "ignore", env: process.env });
  const finished = await Promise.race([proc.exited.then(() => "exited"), new Promise((r) => setTimeout(() => r("still running"), 400))]);
  expect(finished).toBe("still running");
  proc.kill();
});

test("the fake gh refuses any other subcommand", async () => {
  await gh.scenario({});
  const other = await run("pr", "merge", "7");
  expect(other.code).toBe(64);
  expect(other.err).toContain("unexpected invocation");
});

// ---- remotes (2.1) ----

test("only github.com remotes become owner/name, in every URL form", () => {
  expect(githubRepoFromRemote("https://github.com/acme/alpha-infra.git")).toBe("acme/alpha-infra");
  expect(githubRepoFromRemote("https://github.com/acme/alpha-infra")).toBe("acme/alpha-infra");
  expect(githubRepoFromRemote("git@github.com:acme/beta-soc.git")).toBe("acme/beta-soc");
  expect(githubRepoFromRemote("ssh://git@github.com:22/acme/beta-soc.git")).toBe("acme/beta-soc");
  expect(githubRepoFromRemote("https://GitHub.com/acme/beta-soc")).toBe("acme/beta-soc");
  expect(githubRepoFromRemote("git@gitlab.example.test:acme/alpha-infra.git")).toBeUndefined();
  expect(githubRepoFromRemote("https://github.example.test/acme/alpha-infra")).toBeUndefined();
  expect(githubRepoFromRemote("/w/acme/alpha-infra")).toBeUndefined();
  expect(githubRepoFromRemote(undefined)).toBeUndefined();
});

test("a repository without an origin, on another host, or without git is unavailable and starts no gh", async () => {
  await gh.scenario({ login: "demo-user" });
  await gh.forget();
  const targets: RepoTarget[] = [
    { id: "no-origin", path: await repoAt("no-origin"), isGit: true },
    { id: "gitlab", path: await repoAt("gitlab", "git@gitlab.example.test:acme/alpha-infra.git"), isGit: true },
    { id: "plain", path: await plainDir(), isGit: false },
  ];
  const answer = await newStore().refresh(targets, { force: true });
  expect(answer.repos).toEqual([
    { repoId: "no-origin", status: "unavailable", reason: "not on GitHub", pullRequests: [] },
    { repoId: "gitlab", status: "unavailable", reason: "not on GitHub", pullRequests: [] },
    { repoId: "plain", status: "unavailable", reason: "not a git repository", pullRequests: [] },
  ]);
  expect(await gh.calls()).toEqual([]);
});

// ---- parsing (2.3) ----

test("checks are summarised from statusCheckRollup: failing beats pending beats passing", () => {
  expect(summarizeChecks([])).toBe("none");
  expect(summarizeChecks(undefined)).toBe("none");
  expect(summarizeChecks([checkRun("COMPLETED", "SUCCESS"), checkRun("COMPLETED", "SKIPPED")])).toBe("passing");
  expect(summarizeChecks([checkRun("COMPLETED", "SUCCESS"), checkRun("COMPLETED", "FAILURE")])).toBe("failing");
  expect(summarizeChecks([checkRun("COMPLETED", "TIMED_OUT")])).toBe("failing");
  expect(summarizeChecks([checkRun("IN_PROGRESS", ""), checkRun("COMPLETED", "SUCCESS")])).toBe("pending");
  // A failing check outweighs one that is still running.
  expect(summarizeChecks([checkRun("IN_PROGRESS", ""), checkRun("COMPLETED", "FAILURE")])).toBe("failing");
  expect(summarizeChecks([statusContext("SUCCESS")])).toBe("passing");
  expect(summarizeChecks([statusContext("FAILURE")])).toBe("failing");
  expect(summarizeChecks([statusContext("PENDING")])).toBe("pending");
  // Drift in gh's output must never look green.
  expect(summarizeChecks([statusContext("SOMETHING_NEW")])).toBe("pending");
});

test("a pull request is parsed from the fields gh prints", () => {
  const raw = ghPr({
    number: 42,
    title: "Add the thing",
    isDraft: true,
    state: "MERGED",
    mergedAt: "2026-09-27T09:00:00Z",
    reviewDecision: "CHANGES_REQUESTED",
    reviewRequests: [{ login: "Demo-User" }, { name: "platform-team" }],
    statusCheckRollup: [checkRun("COMPLETED", "SUCCESS")],
  });
  expect(parsePullRequest(raw, "demo-user")).toEqual({
    number: 42,
    title: "Add the thing",
    url: "https://github.com/acme/alpha-infra/pull/42",
    author: "octo",
    head: "feat/change-42",
    base: "main",
    draft: true,
    state: "merged",
    createdAt: expect.any(String),
    mergedAt: "2026-09-27T09:00:00Z",
    closedAt: undefined,
    review: "changes_requested",
    reviewRequestedFromViewer: true,
    checks: "passing",
    mergeable: "mergeable",
  });
  // A team review request is not a request from the signed-in user, and no viewer means no marker.
  expect(parsePullRequest({ ...raw, reviewRequests: [{ name: "platform-team" }] }, "demo-user")?.reviewRequestedFromViewer).toBe(false);
  expect(parsePullRequest(raw, undefined)?.reviewRequestedFromViewer).toBe(false);
  expect(parsePullRequest({ title: "no number" })).toBeUndefined();
  expect(parsePullRequest({ number: 3 })?.review).toBe("none");
});

test("mergeability is read as GitHub reports it, and anything else is unknown", () => {
  expect(parsePullRequest(ghPr({ number: 1, mergeable: "MERGEABLE" }))?.mergeable).toBe("mergeable");
  expect(parsePullRequest(ghPr({ number: 2, mergeable: "CONFLICTING" }))?.mergeable).toBe("conflicting");
  expect(parsePullRequest(ghPr({ number: 3, mergeable: "UNKNOWN" }))?.mergeable).toBe("unknown");
  expect(parsePullRequest({ number: 4 })?.mergeable).toBe("unknown");
  // Drift in gh's output must never look mergeable.
  expect(parseMergeable("SOMETHING_NEW")).toBe("unknown");
  expect(parseMergeable(true)).toBe("unknown");
});

test("mergeability comes from the same gh pr list call, and no other subcommand runs", async () => {
  await gh.scenario({
    login: "demo-user",
    repos: { "acme/alpha-infra": { open: [ghPr({ number: 5, mergeable: "CONFLICTING" }), ghPr({ number: 6, mergeable: "UNKNOWN" })], closed: [] } },
  });
  await gh.forget();
  const targets: RepoTarget[] = [{ id: "alpha", path: await repoAt("alpha-mergeable", ALPHA), isGit: true }];
  const repo = (await newStore().refresh(targets, { force: true })).repos[0];
  expect(Object.fromEntries(repo.pullRequests.map((pr) => [pr.number, pr.mergeable]))).toEqual({ 5: "conflicting", 6: "unknown" });

  const calls = await gh.calls();
  expect(calls.map((c) => c.argv.slice(0, 2).join(" ")).sort()).toEqual(["api user", "pr list", "pr list"]);
  for (const call of calls.filter((c) => c.argv[0] === "pr")) {
    expect(call.argv[call.argv.indexOf("--json") + 1].split(",")).toContain("mergeable");
  }
});

// ---- querying (2.2, 2.3) ----

const DAY = 24 * 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

test("open and recently closed pull requests are queried, parsed and ordered newest first", async () => {
  await gh.scenario({
    login: "demo-user",
    repos: {
      "acme/alpha-infra": {
        open: [
          ghPr({ number: 1, createdAt: ago(2 * DAY), isDraft: true }),
          ghPr({ number: 2, createdAt: ago(2 * 3600_000), reviewDecision: "APPROVED", statusCheckRollup: [checkRun("COMPLETED", "SUCCESS")] }),
        ],
        closed: [
          ghPr({ number: 3, state: "MERGED", mergedAt: ago(3 * DAY), closedAt: ago(3 * DAY) }),
          // Merged a month ago: outside the window, so it is not listed however gh answered.
          ghPr({ number: 4, state: "MERGED", mergedAt: ago(30 * DAY), closedAt: ago(30 * DAY) }),
        ],
      },
    },
  });
  await gh.forget();
  const targets: RepoTarget[] = [{ id: "alpha", path: await repoAt("alpha-infra", ALPHA), isGit: true }];
  const answer = await newStore().refresh(targets, { force: true });

  expect(answer.viewer).toBe("demo-user");
  const repo = answer.repos[0];
  expect(repo.status).toBe("ok");
  expect(repo.github).toBe("acme/alpha-infra");
  expect(typeof repo.fetchedAt).toBe("string");
  expect(repo.truncated).toEqual({ open: false, closed: false });
  // Open ones first, newest opened first; then the recently merged one. The month-old merge is gone.
  expect(repo.pullRequests.map((pr) => pr.number)).toEqual([2, 1, 3]);
  expect(repo.pullRequests[0]).toMatchObject({ review: "approved", checks: "passing", state: "open" });
  expect(repo.pullRequests[1]).toMatchObject({ draft: true });
  expect(repo.pullRequests[2]).toMatchObject({ state: "merged" });

  // Two `pr list` calls and one `api user`, none of them inside the repository.
  const calls = await gh.calls();
  expect(calls).toHaveLength(3);
  expect(calls.every((c) => c.argv[0] === "pr" || c.argv[0] === "api")).toBe(true);
  expect(calls.some((c) => c.argv.includes("--search"))).toBe(true);
  for (const call of calls) expect(call.cwd.startsWith(targets[0].path)).toBe(false);
});

test("a list longer than the limit is marked as truncated and cut to the limit", async () => {
  const open = Array.from({ length: 140 }, (_, i) => ghPr({ number: i + 1, createdAt: ago(i * 60_000) }));
  await gh.scenario({ login: "demo-user", repos: { "acme/alpha-infra": { open, closed: [] } } });
  const targets: RepoTarget[] = [{ id: "alpha", path: await repoAt("alpha-truncated", ALPHA), isGit: true }];
  const repo = (await newStore().refresh(targets, { force: true })).repos[0];
  expect(repo.pullRequests).toHaveLength(100);
  expect(repo.truncated).toEqual({ open: true, closed: false });
});

test("gh missing, not signed in, a failure and a timeout each get their own reason", async () => {
  const targets: RepoTarget[] = [{ id: "alpha", path: await repoAt("alpha-failing", ALPHA), isGit: true }];

  // Not on PATH at all: nothing is started and every repository says so. PATH is narrowed to a directory holding only
  // `git`, which reading `origin` still needs: emptying PATH would hide git too, and on some platforms an empty PATH
  // falls back to a default search path where the machine's real `gh` would be found.
  const savedPath = process.env.PATH;
  const onlyGit = await tempDir("osd-no-gh-");
  const realGit = Bun.which("git");
  if (realGit) await symlink(realGit, join(onlyGit, "git"));
  process.env.PATH = onlyGit;
  try {
    const missing = (await newStore().refresh(targets, { force: true })).repos[0];
    expect(missing.status).toBe("unavailable");
    expect(missing.reason).toContain("not installed");
  } finally {
    process.env.PATH = savedPath;
  }

  await gh.scenario({ mode: "not-logged-in" });
  const denied = (await newStore().refresh(targets, { force: true })).repos[0];
  expect(denied.status).toBe("unavailable");
  expect(denied.reason).toContain("gh auth login");

  await gh.scenario({ login: "demo-user", perRepo: { "acme/alpha-infra": { mode: "fail", stderr: "HTTP 502: Bad gateway", exitCode: 1 } } });
  const failed = (await newStore().refresh(targets, { force: true })).repos[0];
  expect(failed.status).toBe("failed");
  expect(failed.reason).toContain("HTTP 502");

  await gh.scenario({ login: "demo-user", perRepo: { "acme/alpha-infra": { mode: "hang" } } });
  const timedOut = (await newStore({ timeoutMs: 300 }).refresh(targets, { force: true })).repos[0];
  expect(timedOut.status).toBe("failed");
  expect(timedOut.reason).toContain("timed out");
});

test("credentials in gh's message never reach the response", async () => {
  await gh.scenario({ login: "demo-user", perRepo: { "acme/alpha-infra": { mode: "fail", stderr: "fatal: could not read https://user:s3cret@github.com/acme/alpha-infra" } } });
  const targets: RepoTarget[] = [{ id: "alpha", path: await repoAt("alpha-masked", ALPHA), isGit: true }];
  const failed = (await newStore().refresh(targets, { force: true })).repos[0];
  expect(failed.reason).not.toContain("s3cret");
  expect(failed.reason).toContain("***@github.com");
});

// ---- coordination (2.4) ----

const twoClones = async (suffix: string): Promise<RepoTarget[]> => [
  { id: `alpha-${suffix}`, path: await repoAt(`alpha-${suffix}`, ALPHA), isGit: true },
  { id: `alpha-clone-${suffix}`, path: await repoAt(`alpha-clone-${suffix}`, "https://github.com/acme/alpha-infra"), isGit: true },
  { id: `beta-${suffix}`, path: await repoAt(`beta-${suffix}`, BETA), isGit: true },
];

const SHARED = {
  login: "demo-user",
  repos: {
    "acme/alpha-infra": { open: [ghPr({ number: 11 })], closed: [] },
    "acme/beta-soc": { open: [ghPr({ number: 22, url: "https://github.com/acme/beta-soc/pull/22" })], closed: [] },
  },
};

const prListCalls = (calls: { argv: string[] }[]) => calls.filter((c) => c.argv[0] === "pr").map((c) => c.argv[c.argv.indexOf("--repo") + 1]);

test("two clones of one project are queried once and both show its pull requests", async () => {
  await gh.scenario(SHARED);
  await gh.forget();
  const targets = await twoClones("shared");
  const answer = await newStore().refresh(targets, { force: true });
  // Two calls per GitHub repository (open and recently closed), for two repositories — not three clones' worth.
  expect(prListCalls(await gh.calls()).sort()).toEqual(["acme/alpha-infra", "acme/alpha-infra", "acme/beta-soc", "acme/beta-soc"]);
  expect(answer.repos.map((r) => r.pullRequests.map((pr) => pr.number))).toEqual([[11], [11], [22]]);
});

test("a second refresh arriving during the first starts no further gh, and both see the same result", async () => {
  await gh.scenario(SHARED);
  await gh.forget();
  const targets = await twoClones("concurrent");
  const store = newStore();
  const [first, second] = await Promise.all([store.refresh(targets, { force: true }), store.refresh(targets, { force: true })]);
  const calls = await gh.calls();
  expect(calls.filter((c) => c.argv[0] === "api")).toHaveLength(1);
  expect(prListCalls(calls)).toHaveLength(4);
  expect(second).toEqual(first);
});

test("a list younger than the freshness window is not fetched again unless the refresh is forced", async () => {
  await gh.scenario(SHARED);
  const targets = await twoClones("fresh");
  const store = newStore();
  await store.refresh(targets, { force: true });

  await gh.forget();
  await store.refresh(targets);
  expect(await gh.calls()).toEqual([]);

  await store.refresh(targets, { force: true });
  expect(prListCalls(await gh.calls())).toHaveLength(4);
});

test("a stale list is fetched again on an unforced refresh", async () => {
  await gh.scenario(SHARED);
  let now = Date.parse("2026-09-29T10:00:00Z");
  const targets = await twoClones("stale");
  const store = newStore({ now: () => now });
  await store.refresh(targets, { force: true });
  now += 20 * 60_000;
  await gh.forget();
  await store.refresh(targets);
  expect(prListCalls(await gh.calls())).toHaveLength(4);
});

test("refreshing one repository leaves the others' cached lists alone", async () => {
  await gh.scenario(SHARED);
  const targets = await twoClones("one");
  const store = newStore();
  await store.refresh(targets, { force: true });

  await gh.forget();
  await gh.scenario({ ...SHARED, repos: { ...SHARED.repos, "acme/beta-soc": { open: [ghPr({ number: 99 })], closed: [] } } });
  const answer = await store.refresh(targets, { repoId: targets[2].id, force: true });
  expect(prListCalls(await gh.calls()).sort()).toEqual(["acme/beta-soc", "acme/beta-soc"]);
  expect(answer.repos[2].pullRequests.map((pr) => pr.number)).toEqual([99]);
  expect(answer.repos[0].pullRequests.map((pr) => pr.number)).toEqual([11]);
});

test("a failed refresh keeps the last good list, with its age and the reason", async () => {
  await gh.scenario(SHARED);
  const targets = await twoClones("keep");
  const store = newStore();
  const good = await store.refresh(targets, { force: true });
  const fetchedAt = good.repos[0].fetchedAt;

  await gh.scenario({ ...SHARED, perRepo: { "acme/alpha-infra": { mode: "fail", stderr: "HTTP 500" } } });
  const after = await store.refresh(targets, { force: true });
  expect(after.repos[0].status).toBe("failed");
  expect(after.repos[0].reason).toContain("HTTP 500");
  expect(after.repos[0].pullRequests.map((pr) => pr.number)).toEqual([11]);
  expect(after.repos[0].fetchedAt).toBe(fetchedAt);
  // The other repository is unaffected.
  expect(after.repos[2].status).toBe("ok");
});

test("the watch queries a repository at most once a minute however many tabs ask; the user's own refresh is not held back", async () => {
  await gh.scenario(SHARED);
  let now = Date.parse("2026-09-29T10:00:00Z");
  const targets = await twoClones("watch-gap");
  const store = newStore({ now: () => now });
  const watch = () => store.refresh(targets, { repoIds: [targets[0].id], force: true });

  await gh.forget();
  // Three tabs' watches, twenty seconds apart: one query of acme/alpha-infra (open and recently closed).
  await watch();
  now += 20_000;
  await watch();
  now += 20_000;
  const third = await watch();
  expect(prListCalls(await gh.calls())).toEqual(["acme/alpha-infra", "acme/alpha-infra"]);
  // Answered from the cache meanwhile.
  expect(third.repos[0].pullRequests.map((pr) => pr.number)).toEqual([11]);

  // The user's Refresh right after still queries.
  await gh.forget();
  await store.refresh(targets, { repoId: targets[0].id, force: true });
  expect(prListCalls(await gh.calls())).toEqual(["acme/alpha-infra", "acme/alpha-infra"]);

  // A minute after the last query settled, the watch queries again.
  await gh.forget();
  now += 30_000;
  await watch();
  expect(await gh.calls()).toEqual([]);
  now += 31_000;
  await watch();
  expect(prListCalls(await gh.calls())).toEqual(["acme/alpha-infra", "acme/alpha-infra"]);
});

test("two refreshes of different repositories finishing together leave a cache holding both lists", async () => {
  await gh.scenario(SHARED);
  const targets = await twoClones("persist-race");
  await rm(pullRequestsCachePath(), { force: true });
  const store = newStore();
  await Promise.all([store.refresh(targets, { repoId: targets[0].id, force: true }), store.refresh(targets, { repoId: targets[2].id, force: true })]);
  const stored = JSON.parse(await readFile(pullRequestsCachePath(), "utf8"));
  expect(Object.keys(stored.repos).sort()).toEqual(["acme/alpha-infra", "acme/beta-soc"]);

  const restarted = newStore();
  await restarted.load();
  expect((await restarted.list(targets)).repos.map((r) => r.pullRequests.map((pr) => pr.number))).toEqual([[11], [11], [22]]);
});

// ---- the cache (2.5) ----

test("the cache survives a restart, and a deleted cache simply means never fetched", async () => {
  await gh.scenario(SHARED);
  const targets = await twoClones("cache");
  await newStore().refresh(targets, { force: true });

  const stored = JSON.parse(await readFile(pullRequestsCachePath(), "utf8"));
  expect(Object.keys(stored.repos).sort()).toEqual(["acme/alpha-infra", "acme/beta-soc"]);
  expect(stored.viewer).toBe("demo-user");

  // A fresh store, as after a restart: the lists are there without contacting GitHub.
  await gh.forget();
  const restarted = newStore();
  await restarted.load();
  const answer = await restarted.list(targets);
  expect(answer.viewer).toBe("demo-user");
  expect(answer.repos.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
  expect(answer.repos[0].pullRequests.map((pr) => pr.number)).toEqual([11]);
  expect(await gh.calls()).toEqual([]);

  await rm(pullRequestsCachePath(), { force: true });
  const empty = newStore();
  await empty.load();
  const nothing = await empty.list(targets);
  expect(nothing.repos.map((r) => r.status)).toEqual(["never", "never", "never"]);
  expect(nothing.repos.every((r) => r.pullRequests.length === 0)).toBe(true);
  expect(await gh.calls()).toEqual([]);
});

test("a version-1 cache written before mergeability was read still loads, as unknown", async () => {
  const targets: RepoTarget[] = [{ id: "alpha", path: await repoAt("alpha-old-cache", ALPHA), isGit: true }];
  const old: Record<string, unknown> = { ...parsePullRequest(ghPr({ number: 8 })) };
  delete old.mergeable;
  await mkdir(join(pullRequestsCachePath(), ".."), { recursive: true });
  await writeFile(
    pullRequestsCachePath(),
    JSON.stringify({ version: 1, viewer: "demo-user", repos: { "acme/alpha-infra": { fetchedAt: new Date().toISOString(), pullRequests: [old] } } }),
  );
  await gh.forget();
  const store = newStore();
  await store.load();
  const repo = (await store.list(targets)).repos[0];
  expect(repo.status).toBe("ok");
  expect(repo.pullRequests.map((pr) => [pr.number, pr.mergeable])).toEqual([[8, "unknown"]]);
  expect(await gh.calls()).toEqual([]);
  await rm(pullRequestsCachePath(), { force: true });
});

test("an unreadable cache file is treated as no cache at all", async () => {
  await writeFile(pullRequestsCachePath(), "{ not json");
  const store = newStore();
  await store.load();
  const targets: RepoTarget[] = [{ id: "alpha", path: await repoAt("alpha-broken-cache", ALPHA), isGit: true }];
  expect((await store.list(targets)).repos[0].status).toBe("never");
  await rm(pullRequestsCachePath(), { force: true });
});

// ---- head commit and docs-only (agent-merges-docs-prs 2.1, 2.2) ----

const OID = "c0ffee0000000000000000000000000000000088";
const files = (...paths: string[]) => ({ files: paths.map((path) => ({ path, additions: 1, deletions: 0 })), changedFiles: paths.length });
const fieldsOf = (call: { argv: string[] }) => call.argv[call.argv.indexOf("--json") + 1].split(",");

test("the head commit is a 40-character object name or absent", () => {
  expect(parsePullRequest(ghPr({ number: 1, headRefOid: OID }))?.headOid).toBe(OID);
  for (const bad of ["c0ffee", OID.toUpperCase(), `${OID}0`, 42, null, undefined, ""]) {
    const pr = parsePullRequest(ghPr({ number: 2, headRefOid: bad }));
    expect(pr && "headOid" in pr).toBe(false);
  }
});

test("docs-only: every path under openspec/, as many as GitHub counts, at least one; anything else is not", () => {
  const docs = (patch: Record<string, unknown>) => parsePullRequest(ghPr({ number: 88, ...patch }))?.docsOnly;
  expect(docs(files("openspec/specs/secrets/spec.md", "openspec/changes/archive/2026-10-20-rotate-keys/proposal.md"))).toBe(true);
  expect(docs(files("openspec/changes/rotate-keys/tasks.md", "src/keys.ts"))).toBe(false);
  // A look-alike is not under openspec/ at the root.
  expect(docs(files("openspec-notes.md"))).toBe(false);
  expect(docs(files("docs/openspec/x"))).toBe(false);
  expect(docs(files("openspec/../src/keys.ts"))).toBe(false);
  // gh returns at most 100 paths: 140 counted and 100 returned is not a complete list.
  const hundred = Array.from({ length: 100 }, (_, i) => ({ path: `openspec/changes/c${i}/tasks.md` }));
  expect(docs({ files: hundred, changedFiles: 140 })).toBe(false);
  expect(docs({ files: hundred, changedFiles: 100 })).toBe(true);
  // No files, or a field missing or malformed.
  expect(docs({ files: [], changedFiles: 0 })).toBe(false);
  expect(docs({ files: [{ path: "openspec/a.md" }] })).toBe(false);
  expect(docs({ changedFiles: 1 })).toBe(false);
  expect(docs({ files: "openspec/a.md", changedFiles: 1 })).toBe(false);
  expect(docs({ files: [{ name: "openspec/a.md" }], changedFiles: 1 })).toBe(false);
  // Not asked for at all: no answer, which every reader takes as not docs-only.
  expect(docs({})).toBeUndefined();
  // The paths themselves are never part of the parsed pull request.
  const parsed = parsePullRequest(ghPr({ number: 88, ...files("openspec/a.md") })) as unknown as Record<string, unknown>;
  expect(["files", "changedFiles"].some((key) => key in parsed)).toBe(false);
});

test("changed files are asked for only on the open call of a repository with docs auto-merge, and never kept", async () => {
  await gh.scenario({
    login: "demo-user",
    repos: {
      "acme/alpha-infra": { open: [ghPr({ number: 125, headRefOid: OID, ...files("openspec/a.md") })], closed: [] },
      "acme/demo-ops": {
        open: [ghPr({ number: 88, headRefName: "archive-rotate-keys", headRefOid: OID, ...files("openspec/specs/secrets/spec.md", "openspec/changes/archive/2026-10-20-rotate-keys/proposal.md") })],
        closed: [ghPr({ number: 87, state: "MERGED", mergedAt: ago(DAY), closedAt: ago(DAY), headRefOid: OID, ...files("openspec/a.md") })],
      },
    },
  });
  await gh.forget();
  const targets: RepoTarget[] = [
    { id: "alpha", path: await repoAt("alpha-files", ALPHA), isGit: true },
    { id: "demo", path: await repoAt("demo-files", "https://github.com/acme/demo-ops.git"), isGit: true, autoMergeDocs: true },
  ];
  const answer = await newStore().refresh(targets, { force: true });
  const [alpha, demo] = answer.repos;
  // alpha-infra has docs auto-merge off and shares no GitHub repository with a project that has it on.
  expect(alpha.pullRequests.map((pr) => [pr.number, pr.headOid, pr.docsOnly])).toEqual([[125, OID, undefined]]);
  expect(demo.pullRequests.map((pr) => [pr.number, pr.headOid, pr.docsOnly])).toEqual([
    [88, OID, true],
    [87, OID, undefined],
  ]);

  const calls = (await gh.calls()).filter((c) => c.argv[0] === "pr");
  const asked = calls.map((c) => ({ repo: c.argv[c.argv.indexOf("--repo") + 1], closed: c.argv.includes("--search"), files: fieldsOf(c).includes("files") && fieldsOf(c).includes("changedFiles") }));
  expect(asked.sort((a, b) => `${a.repo}${a.closed}`.localeCompare(`${b.repo}${b.closed}`))).toEqual([
    { repo: "acme/alpha-infra", closed: false, files: false },
    { repo: "acme/alpha-infra", closed: true, files: false },
    { repo: "acme/demo-ops", closed: false, files: true },
    { repo: "acme/demo-ops", closed: true, files: false },
  ]);
  for (const call of calls) expect(fieldsOf(call)).toContain("headRefOid");
  for (const call of await gh.calls()) expect(call.argv.slice(0, 2).join(" ")).toMatch(/^(pr list|api user)$/);

  // The paths are in neither the cache file nor the answer.
  const cached = await readFile(pullRequestsCachePath(), "utf8");
  expect(cached).not.toContain("openspec/specs/secrets/spec.md");
  expect(cached).not.toContain("changedFiles");
  expect(JSON.stringify(answer)).not.toContain("openspec/specs/secrets/spec.md");
  await rm(pullRequestsCachePath(), { force: true });
});

test("a cache from an earlier version, or one carrying drift, has no head commit and is not docs-only", async () => {
  const targets: RepoTarget[] = [{ id: "alpha", path: await repoAt("alpha-old-head", ALPHA), isGit: true }];
  const old = { ...parsePullRequest(ghPr({ number: 9 })) };
  const drifted = { ...parsePullRequest(ghPr({ number: 10 })), headOid: "not-a-commit", docsOnly: "yes" };
  const good = { ...parsePullRequest(ghPr({ number: 11, headRefOid: OID, ...files("openspec/a.md") })) };
  await mkdir(join(pullRequestsCachePath(), ".."), { recursive: true });
  await writeFile(
    pullRequestsCachePath(),
    JSON.stringify({ version: 1, viewer: "demo-user", repos: { "acme/alpha-infra": { fetchedAt: new Date().toISOString(), pullRequests: [old, drifted, good] } } }),
  );
  const store = newStore();
  await store.load();
  const repo = (await store.list(targets)).repos[0];
  expect(repo.pullRequests.map((pr) => [pr.number, pr.headOid, pr.docsOnly])).toEqual([
    [9, undefined, undefined],
    [10, undefined, undefined],
    [11, OID, true],
  ]);
  await rm(pullRequestsCachePath(), { force: true });
});

// ---- whether the head is in a fork (resolve-pr-conflicts 1.1) ----

test("isCrossRepository is read with the same pr list, kept only as a boolean, and an old cache leaves it unknown", async () => {
  await gh.scenario({
    login: "demo-user",
    repos: {
      "acme/alpha-infra": {
        open: [ghPr({ number: 31, isCrossRepository: true }), ghPr({ number: 32, isCrossRepository: false }), ghPr({ number: 33 }), ghPr({ number: 34, isCrossRepository: "no" })],
        closed: [],
      },
    },
  });
  await gh.forget();
  const targets: RepoTarget[] = [{ id: "alpha", path: await repoAt("alpha-fork", ALPHA), isGit: true }];
  const answer = await newStore().refresh(targets, { force: true });
  const byNumber = (prs: readonly PullRequest[]) => [...prs].sort((a, b) => a.number - b.number);
  expect(byNumber(answer.repos[0].pullRequests).map((pr) => [pr.number, pr.isCrossRepository])).toEqual([
    [31, true],
    [32, false],
    [33, undefined],
    [34, undefined],
  ]);
  const calls = await gh.calls();
  for (const call of calls.filter((c) => c.argv[0] === "pr")) expect(fieldsOf(call)).toContain("isCrossRepository");
  for (const call of calls) expect(call.argv.slice(0, 2).join(" ")).toMatch(/^(pr list|api user)$/);

  // A cache written before the field was read, or carrying drift, does not say the head is in the same repository.
  const stored = JSON.parse(await readFile(pullRequestsCachePath(), "utf8"));
  const cached: PullRequest[] = stored.repos["acme/alpha-infra"].pullRequests;
  delete (cached.find((pr) => pr.number === 31) as Partial<PullRequest>).isCrossRepository;
  (cached.find((pr) => pr.number === 32) as unknown as Record<string, unknown>).isCrossRepository = "false";
  await writeFile(pullRequestsCachePath(), JSON.stringify(stored));
  const reloaded = newStore();
  await reloaded.load();
  expect(byNumber((await reloaded.list(targets)).repos[0].pullRequests).map((pr) => pr.isCrossRepository)).toEqual([undefined, undefined, undefined, undefined]);
  await rm(pullRequestsCachePath(), { force: true });
});
