// Resolve conflicts on GitHub's signal and on the pull request's own head branch (resolve-pr-conflicts 3.1–3.5). Real
// git, the fake agent and, for the route, the fake gh; the remote-tracking refs are written locally, so no test fetches.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFetchHandler, type AppState } from "../src/server/api.ts";
import { pullRequestsCachePath, worktreesDir } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { resolveConflictsPrompt } from "../src/server/sessions/agents.ts";
import { ensureWorktree, UnknownBranchError } from "../src/server/sessions/worktree.ts";
import { DEFAULT_RESOLVE_CONFLICTS_PROMPT, resolveConflictsTargetSentence, type PullRequest, type RepoPullRequests } from "../src/shared/types.ts";
import { installFakeGh, type GhHarness } from "./ghHelpers.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { fakeProfile, git, harness, tempGitRepo, waitFor, watch, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
let gh: GhHarness;
const managers: Harness["manager"][] = [];

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  gh = await installFakeGh({ login: "demo-user" });
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(async () => {
  gh.restore();
  await cleanup();
});

const CHANGE = "upgrade-runtime";
const HEAD = `feat/${CHANGE}`;
const FETCHED = new Date().toISOString();

/** `origin` with `origin/main` and `origin/HEAD` as after a clone, written locally: nothing here can reach a network. */
function remoteTracking(repo: string): void {
  git(repo, "remote", "add", "origin", "git@github.com:acme/demo-ops.git");
  git(repo, "update-ref", "refs/remotes/origin/main", git(repo, "rev-parse", "main"));
  git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
}

/** A branch that exists only as `origin/<branch>`: committed, recorded as remote-tracking, then deleted locally. */
function remoteOnlyBranch(repo: string, branch: string, file = "remote.txt"): string {
  git(repo, "checkout", "-q", "-b", branch);
  Bun.spawnSync(["sh", "-c", `echo pushed > ${file}`], { cwd: repo });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", `work on ${branch}`);
  const sha = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "main");
  git(repo, "update-ref", `refs/remotes/origin/${branch}`, sha);
  git(repo, "branch", "-q", "-D", branch);
  return sha;
}

const pr = (patch: Partial<PullRequest> = {}): PullRequest => ({
  number: 88,
  title: "upgrade runtime",
  url: "https://github.com/acme/demo-ops/pull/88",
  author: "octo",
  head: HEAD,
  base: "main",
  draft: false,
  state: "open",
  createdAt: new Date(Date.now() - 3600_000).toISOString(),
  review: "none",
  reviewRequestedFromViewer: false,
  checks: "passing",
  mergeable: "conflicting",
  isCrossRepository: false,
  ...patch,
});

const listOf = (h: Harness, ...pullRequests: PullRequest[]): RepoPullRequests => ({ repoId: h.repoId, github: "acme/demo-ops", status: "ok", fetchedAt: FETCHED, pullRequests });

const branchConfig = (repo: string) => Bun.spawnSync(["git", "config", "--get-regexp", "^branch\\."], { cwd: repo }).stdout.toString();

// ---- 3.1 the worktree on the head branch ----

test("a branch only on the remote is created from origin/<branch> and tracks it", async () => {
  const repo = await tempGitRepo();
  remoteTracking(repo);
  const sha = remoteOnlyBranch(repo, HEAD);
  const path = join(worktreesDir(), "t-remote", CHANGE);
  expect(await ensureWorktree(repo, path, HEAD, { fromRemote: true })).toEqual({ created: true, base: `origin/${HEAD}` });
  expect(git(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(HEAD);
  expect(git(path, "rev-parse", "HEAD")).toBe(sha);
  expect(git(path, "rev-parse", "--abbrev-ref", "@{u}")).toBe(`origin/${HEAD}`);
});

test("a local branch behind the remote is checked out as it is", async () => {
  const repo = await tempGitRepo();
  remoteTracking(repo);
  git(repo, "branch", HEAD);
  const local = git(repo, "rev-parse", HEAD);
  git(repo, "update-ref", `refs/remotes/origin/${HEAD}`, remoteOnlyBranch(repo, "scratch"));
  const path = join(worktreesDir(), "t-behind", CHANGE);
  expect(await ensureWorktree(repo, path, HEAD, { fromRemote: true })).toEqual({ created: true });
  expect(git(path, "rev-parse", "HEAD")).toBe(local); // not moved to origin's commit
});

test("a branch known neither locally nor on the remote is refused before anything is created", async () => {
  const repo = await tempGitRepo();
  remoteTracking(repo);
  const before = { branches: git(repo, "branch", "--list"), config: branchConfig(repo), worktrees: git(repo, "worktree", "list") };
  const path = join(worktreesDir(), "t-unknown", CHANGE);
  await expect(ensureWorktree(repo, path, HEAD, { fromRemote: true })).rejects.toBeInstanceOf(UnknownBranchError);
  expect(existsSync(path)).toBe(false);
  expect(existsSync(join(worktreesDir(), "t-unknown"))).toBe(false);
  expect({ branches: git(repo, "branch", "--list"), config: branchConfig(repo), worktrees: git(repo, "worktree", "list") }).toEqual(before);
});

// ---- 3.4 the prompt ----

test("the prompt names the pull request after the additional instructions, and is unchanged without one", () => {
  const agent = fakeProfile({ promptSuffixes: { resolveConflicts: "We rebase here, never merge." } });
  const plain = `${DEFAULT_RESOLVE_CONFLICTS_PROMPT.replaceAll("{change}", CHANGE)} We rebase here, never merge.`;
  expect(resolveConflictsPrompt(agent, CHANGE)).toBe(plain);
  expect(resolveConflictsPrompt(agent, CHANGE, { number: 88, head: HEAD, base: "main" })).toBe(`${plain} ${resolveConflictsTargetSentence(88, HEAD, "main")}`);
  expect(resolveConflictsTargetSentence(88, HEAD, "main")).toBe(
    `Its pull request is #88 from ${HEAD} into main. If this branch is behind origin/${HEAD}, bring it level first, then resolve against main and push to ${HEAD}.`,
  );
  // Nothing that is not a number or a branch name reaches the text.
  expect(() => resolveConflictsPrompt(agent, CHANGE, { number: 0, head: HEAD, base: "main" })).toThrow();
  expect(() => resolveConflictsPrompt(agent, CHANGE, { number: 88, head: "x; rm -rf ~", base: "main" })).toThrow();
  expect(() => resolveConflictsPrompt(agent, CHANGE, { number: 88, head: HEAD, base: "--force" })).toThrow();
});

// ---- 3.2 opening for Resolve conflicts ----

async function setup(): Promise<Harness> {
  const h = await harness();
  managers.push(h.manager);
  remoteTracking(h.repoPath);
  return h;
}

test("worktree gone, branch only on the remote: a session on that branch, with the pull request in its opening prompt", async () => {
  const h = await setup();
  remoteOnlyBranch(h.repoPath, HEAD);
  const before = git(h.repoPath, "branch", "--list");
  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, resolveConflicts: true, action: "archive", branch: "evil", pr: 1 } as never, listOf(h, pr()));
  expect(s).toMatchObject({ branch: HEAD, action: "implement", pullRequest: 88, worktreePath: join(worktreesDir(), h.repoId, CHANGE) });
  expect(git(s.worktreePath, "rev-parse", "--abbrev-ref", "@{u}")).toBe(`origin/${HEAD}`);
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("#88 from feat/upgrade-runtime into main"), "the pull-request sentence");
  // One new branch, the pull request's: no `feat/` branch of another name, nothing from the request.
  const after = git(h.repoPath, "branch", "--list").split("\n").map((b) => b.replace(/^[*+ ]+/, ""));
  expect(after.filter((b) => !before.includes(b))).toEqual([HEAD]);
});

test("a pull request on an off-convention branch the change recorded gets its session on that branch", async () => {
  const h = await setup();
  const branch = `fix/${CHANGE}`;
  remoteOnlyBranch(h.repoPath, branch);
  // The branch the agent recorded in the change's `.openspec.yaml`, as the scan reports it.
  const change = h.snapshot.repos[0].changes.find((c) => c.name === CHANGE);
  if (change) change.recorded = { branch };
  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, resolveConflicts: true }, listOf(h, pr({ number: 91, head: branch })));
  expect(s.branch).toBe(branch);
  expect(git(s.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
  expect(Bun.spawnSync(["git", "show-ref", "--verify", "--quiet", `refs/heads/${HEAD}`], { cwd: h.repoPath }).exitCode).not.toBe(0);
});

test("the head branch checked out in a worktree made outside the dashboard is adopted", async () => {
  const h = await setup();
  const outside = join(await tempDir("osd-outside-"), "wt");
  git(h.repoPath, "worktree", "add", "-q", "-b", HEAD, outside);
  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, resolveConflicts: true }, listOf(h, pr()));
  expect(s).toMatchObject({ adopted: true, branch: HEAD });
  expect(await Bun.file(join(s.worktreePath, ".git")).exists()).toBe(true);
  expect(existsSync(join(worktreesDir(), h.repoId, CHANGE))).toBe(false);
});

test("an ended session's worktree on the head branch is resumed with the prompt, in the same record", async () => {
  const h = await setup();
  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, action: "implement" });
  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  // GitHub conflicts, the local check sees nothing: the worktree merges cleanly as of the last fetch.
  const again = await h.manager.open({ repoId: h.repoId, change: CHANGE, resolveConflicts: true }, listOf(h, pr()));
  expect(again.id).toBe(s.id);
  expect(again.state).toBe("running");
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes('args=["--resumed"]') && seen.text().includes("#88 from feat/upgrade-runtime"), "resumed with the sentence");
});

test("refusals: each with its reason, a 409, and nothing created", async () => {
  const h = await setup();
  remoteOnlyBranch(h.repoPath, HEAD);
  const open = (list: RepoPullRequests | undefined) => h.manager.open({ repoId: h.repoId, change: CHANGE, resolveConflicts: true }, list);
  const refused = async (list: RepoPullRequests | undefined, reason: RegExp) => {
    const before = { branches: git(h.repoPath, "branch", "--list"), worktrees: git(h.repoPath, "worktree", "list"), config: branchConfig(h.repoPath) };
    await expect(open(list)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(reason) });
    expect({ branches: git(h.repoPath, "branch", "--list"), worktrees: git(h.repoPath, "worktree", "list"), config: branchConfig(h.repoPath) }).toEqual(before);
    expect(h.manager.list()).toHaveLength(0);
  };
  await refused(listOf(h, pr({ isCrossRepository: true })), /^pull request #88 cannot be resolved here: its branch is in a fork$/);
  await refused(listOf(h, pr({ isCrossRepository: undefined })), /fork/); // not known not to be
  await refused(listOf(h, pr({ mergeable: "mergeable" })), /no conflicts to resolve/);
  await refused(undefined, /no conflicts to resolve/);
  await refused(listOf(h, pr({ head: "main" })), /no conflicts|default branch/); // `main` is no candidate branch of the change
  const change = h.snapshot.repos[0].changes.find((c) => c.name === CHANGE);
  if (change) change.branchMatch = "main";
  await refused(listOf(h, pr({ head: "main" })), /the default branch/);
  if (change) change.branchMatch = undefined;
  // Neither a local branch nor origin/<branch>.
  git(h.repoPath, "update-ref", "-d", `refs/remotes/origin/${HEAD}`);
  await refused(listOf(h, pr()), /not known locally — fetch or pull first/);
  // The main checkout is on the head branch.
  git(h.repoPath, "checkout", "-q", "-b", HEAD);
  await refused(listOf(h, pr()), /main checkout/);
  git(h.repoPath, "checkout", "-q", "main");
});

test("refused when the change's worktree, or its running session, is on another branch", async () => {
  const h = await setup();
  remoteOnlyBranch(h.repoPath, HEAD);
  const path = join(worktreesDir(), h.repoId, CHANGE);
  await ensureWorktree(h.repoPath, path, "wip/upgrade-runtime-spike");
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, resolveConflicts: true }, listOf(h, pr()))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/is on wip\/upgrade-runtime-spike, not on feat\/upgrade-runtime/) });

  // A session started there is running on the wrong branch: nothing is typed into it.
  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, action: "implement" });
  expect(s.worktreePath).toBe(path);
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  await expect(h.manager.open({ repoId: h.repoId, change: CHANGE, resolveConflicts: true }, listOf(h, pr()))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/running on wip\/upgrade-runtime-spike/) });
  await expect(h.manager.resolveConflicts(s.id, listOf(h, pr()))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/works on wip\/upgrade-runtime-spike, but pull request #88 is on feat\/upgrade-runtime/) });
  expect(seen.text()).not.toContain("you said:");
});

test("refused where sessions run in place, and while sessions are off", async () => {
  const plain = await harness({ git: false });
  managers.push(plain.manager);
  await expect(plain.manager.open({ repoId: plain.repoId, change: CHANGE, resolveConflicts: true }, listOf(plain, pr()))).rejects.toMatchObject({ status: 409 });
  const off = await harness({ enabled: false });
  await expect(off.manager.open({ repoId: off.repoId, change: CHANGE, resolveConflicts: true }, listOf(off, pr()))).rejects.toMatchObject({ status: 403 });
});

// ---- 3.3 the session route takes either signal ----

test("a running session whose worktree merges cleanly is sent the prompt when only GitHub reports a conflict", async () => {
  const h = await setup();
  const s = await h.manager.open({ repoId: h.repoId, change: CHANGE, action: "implement" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  await expect(h.manager.resolveConflicts(s.id, listOf(h, pr({ mergeable: "mergeable" })))).rejects.toMatchObject({ status: 409 });
  expect((await h.manager.resolveConflicts(s.id, listOf(h, pr()))).submitted).toBe(true);
  await waitFor(() => seen.text().includes("Its pull request is #88 from feat/upgrade-runtime into main."), "the sentence");
  // Through `open` too: the running session is returned with the prompt submitted, and no second process starts.
  const again = await h.manager.open({ repoId: h.repoId, change: CHANGE, resolveConflicts: true }, listOf(h, pr()));
  expect(again.id).toBe(s.id);
  expect(h.manager.list().filter((x) => x.state === "running")).toHaveLength(1);
});

// ---- 3.5 no query, no fetch ----

test("the route reads the cached list only: no gh process and no fetch, also when it starts a session", async () => {
  const h = await setup();
  remoteOnlyBranch(h.repoPath, HEAD);
  // Every access to origin goes through a fake ssh that leaves a marker; the cache is keyed by the same GitHub name.
  const base = await tempDir("osd-ssh-");
  const marker = join(base, "remote-was-contacted");
  const fakeSsh = join(base, "fake-ssh.sh");
  await writeFile(fakeSsh, `#!/bin/sh\necho contacted >> "${marker}"\nexit 1\n`);
  await chmod(fakeSsh, 0o755);
  const previousSsh = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = fakeSsh;
  try {
    await mkdir(join(pullRequestsCachePath(), ".."), { recursive: true });
    const cache = (prs: PullRequest[]) => writeFile(pullRequestsCachePath(), JSON.stringify({ version: 1, viewer: "demo-user", repos: { "acme/demo-ops": { fetchedAt: FETCHED, pullRequests: prs } } }));
    await gh.forget();
    const state: AppState = { config: h.config, scanner: new Scanner(() => h.config, { persist: false }, h.snapshot), sessions: h.manager };
    const handler = createFetchHandler({ state, indexHtml: "<title>stub</title>" });
    const post = (path: string, body: unknown) => handler(new Request(`http://127.0.0.1:4711${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:4711" }, body: JSON.stringify(body) }));

    await cache([pr({ mergeable: "mergeable" })]);
    const nothing = await post("/api/sessions", { repoId: h.repoId, change: CHANGE, resolveConflicts: true });
    expect(nothing.status).toBe(409);
    expect(h.manager.list()).toHaveLength(0);

    await cache([pr()]);
    state.pullRequests = undefined; // re-read from disk, as after a restart
    const started = await post("/api/sessions", { repoId: h.repoId, change: CHANGE, resolveConflicts: true, branch: "main" });
    expect(started.status).toBe(201);
    const session = (await started.json()) as { id: string; branch: string };
    expect(session.branch).toBe(HEAD);
    const seen = await watch(h.manager, session.id);
    await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
    expect((await post(`/api/sessions/${session.id}/resolve-conflicts`, {})).status).toBe(200);

    expect(await gh.calls()).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  } finally {
    if (previousSsh === undefined) delete process.env.GIT_SSH_COMMAND;
    else process.env.GIT_SSH_COMMAND = previousSsh;
  }
});
