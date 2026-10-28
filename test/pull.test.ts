import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { blockingSet, classifyBlocking, fetchRepository, isChangeLeftoverPath, maskCredentials, parseBlobEntries, parseNulList, parseStatusStates, PullBusyError, pullAll, pullRepository, reasonFrom } from "../src/server/pull.ts";
import { readWorkStatus } from "../src/server/sessions/workStatus.ts";
import { Scanner } from "../src/server/scanner.ts";
import { AutoFetcher } from "../src/server/autoFetch.ts";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { useTempHome } from "./helpers.ts";
import { hookLog, installRepoHooks } from "./hookHelpers.ts";
import { commitFiles, monorepo } from "./monorepoHelpers.ts";
import { type Fixture, fixture, git, localChange, remoteChange, remoteCommits } from "./pullHelpers.ts";

// These tests create git repositories, run real git against local remotes and wait on deliberately slow fake remotes;
// slow CI runners need more than the 5 s default.
setDefaultTimeout(60_000);

let cleanup: () => Promise<void>;
const bases: string[] = [];
const savedSsh = process.env.GIT_SSH_COMMAND;
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(() => {
  if (savedSsh === undefined) delete process.env.GIT_SSH_COMMAND;
  else process.env.GIT_SSH_COMMAND = savedSsh;
});
afterAll(async () => {
  for (const b of bases) await rm(b, { recursive: true, force: true });
  await cleanup();
});

async function make(defaultName?: string): Promise<Fixture> {
  const f = await fixture(defaultName);
  bases.push(f.base);
  return f;
}
const head = (dir: string) => git(dir, "rev-parse", "HEAD");
const status = (dir: string) => git(dir, "status", "--porcelain");
const pull = (f: Fixture, options?: { fetchTimeoutMs?: number }) => pullRepository(newRepoConfig(f.repo, true), options);

/** Every file under `dir` with size and mtime — any write at all shows up. */
async function fingerprint(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const visit = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await visit(p);
      else {
        const s = await stat(p);
        out[relative(dir, p)] = `${s.size}:${s.mtimeMs}`;
      }
    }
  };
  await visit(dir);
  return out;
}

test("behind and clean: fast-forwarded by the right number of commits; then up to date", async () => {
  const f = await make();
  await remoteCommits(f, 2);
  const result = await pull(f);
  expect(result).toMatchObject({ fetched: true, update: "fast-forwarded", commits: 2, branch: "main", upstream: "origin/main", defaultBranch: "main" });
  expect(head(f.repo)).toBe(head(f.other));
  expect(status(f.repo)).toBe("");
  const before = await fingerprint(join(f.repo, "app.txt").replace(/app\.txt$/, "openspec"));
  expect(await pull(f)).toMatchObject({ fetched: true, update: "up-to-date" });
  expect(await fingerprint(join(f.repo, "openspec"))).toEqual(before);
});

test("an unrelated uncommitted edit survives; an overlapping one makes git refuse and nothing changes", async () => {
  const f = await make();
  await remoteCommits(f, 1, "app.txt");
  await writeFile(join(f.repo, "notes.txt"), "my notes, not committed\n");
  expect(await pull(f)).toMatchObject({ update: "fast-forwarded", commits: 1 });
  expect(await readFile(join(f.repo, "notes.txt"), "utf8")).toBe("my notes, not committed\n");

  await remoteCommits(f, 1, "app.txt");
  await writeFile(join(f.repo, "app.txt"), "my edit to the same file\n");
  const at = head(f.repo);
  const index = await readFile(join(f.repo, ".git", "index"));
  const refused = await pull(f);
  expect(refused).toMatchObject({ fetched: true, update: "refused" });
  expect(refused.reason).toContain("would be overwritten");
  expect(refused.reason).toContain("app.txt");
  expect([head(f.repo), await readFile(join(f.repo, "app.txt"), "utf8")]).toEqual([at, "my edit to the same file\n"]);
  expect(Buffer.compare(index, await readFile(join(f.repo, ".git", "index")))).toBe(0);
});

test("diverged: refused, the local commit and the working tree are untouched", async () => {
  const f = await make();
  await remoteCommits(f, 1);
  await writeFile(join(f.repo, "local.txt"), "local\n");
  git(f.repo, "add", "-A");
  git(f.repo, "commit", "-q", "-m", "local work");
  const at = head(f.repo);
  const result = await pull(f);
  expect(result).toMatchObject({ fetched: true, update: "refused", reason: "local and remote have diverged (1 ahead, 1 behind)" });
  expect([head(f.repo), status(f.repo)]).toEqual([at, ""]);
  expect(git(f.repo, "log", "--oneline", "--merges")).toBe(""); // never a merge commit
});

test("off the default branch, or detached: fetched only — refs move, the checkout does not", async () => {
  const f = await make();
  git(f.repo, "checkout", "-q", "-b", "feat/redesign");
  await writeFile(join(f.repo, "wip.txt"), "work in progress\n");
  await remoteCommits(f, 3);
  const tracking = git(f.repo, "rev-parse", "origin/main");
  const at = head(f.repo);
  const result = await pull(f);
  expect(result).toMatchObject({ fetched: true, update: "skipped", branch: "feat/redesign", defaultBranch: "main", reason: "on feat/redesign, not main; only fetched" });
  expect(git(f.repo, "rev-parse", "origin/main")).not.toBe(tracking); // the fetch happened
  expect([head(f.repo), git(f.repo, "symbolic-ref", "--short", "HEAD"), status(f.repo)]).toEqual([at, "feat/redesign", "?? wip.txt"]);

  git(f.repo, "checkout", "-q", "--detach");
  expect(await pull(f)).toMatchObject({ fetched: true, update: "skipped", reason: "on a detached HEAD, not main; only fetched" });
});

test("no upstream: fetched from origin, not updated. No remote at all: nothing is run", async () => {
  const f = await make();
  git(f.repo, "branch", "--unset-upstream");
  await remoteCommits(f, 1);
  const at = head(f.repo);
  expect(await pull(f)).toMatchObject({ fetched: true, update: "skipped", reason: "main has no upstream; only fetched" });
  expect(head(f.repo)).toBe(at);

  const lonely = await make();
  git(lonely.repo, "remote", "remove", "origin");
  const before = await fingerprint(lonely.repo);
  expect(await pull(lonely)).toMatchObject({ fetched: false, update: "skipped", reason: "no remote configured; there is nothing to pull" });
  expect(await fingerprint(lonely.repo)).toEqual(before);
});

test("unreachable remote: failed with git's reason, nothing in the working tree changed", async () => {
  const f = await make();
  git(f.repo, "remote", "set-url", "origin", join(f.base, "nowhere.git"));
  const at = head(f.repo);
  const result = await pull(f);
  expect(result).toMatchObject({ fetched: false, update: "failed" });
  expect(result.reason).toContain("does not appear to be a git repository");
  expect([head(f.repo), status(f.repo)]).toEqual([at, ""]);
});

test("a remote that never answers is stopped at the timeout", async () => {
  const f = await make();
  git(f.repo, "remote", "set-url", "origin", "ssh://git.example.invalid/team/repo.git");
  process.env.GIT_SSH_COMMAND = "sleep 30 #"; // stands in for a connection that hangs
  const started = Date.now();
  expect(await pull(f, { fetchTimeoutMs: 500 })).toMatchObject({ fetched: false, update: "failed", reason: "timed out" });
  expect(Date.now() - started).toBeLessThan(10_000);
});

test("repository hooks do not run, and the result says so", async () => {
  const f = await make();
  const hook = join(f.repo, ".git", "hooks", "post-merge");
  await mkdir(join(f.repo, ".git", "hooks"), { recursive: true });
  await writeFile(hook, "#!/bin/sh\necho ran > hook-ran.txt\n");
  await chmod(hook, 0o755);
  await remoteCommits(f, 1);
  expect(await pull(f)).toMatchObject({ update: "fast-forwarded", hooksSkipped: true });
  expect(existsSync(join(f.repo, "hook-ran.txt"))).toBe(false);
  // the hook is real: a plain merge would have run it
  await remoteCommits(f, 1);
  git(f.repo, "fetch", "-q");
  git(f.repo, "merge", "--ff-only", "-q", "origin/main");
  expect(existsSync(join(f.repo, "hook-ran.txt"))).toBe(true);
});

test("linked worktrees are left alone: files, index and branch", async () => {
  const f = await make();
  const one = join(f.base, "wt-one");
  const two = join(f.repo, ".claude", "worktrees", "two");
  git(f.repo, "worktree", "add", "-q", "-b", "feat/one", one);
  git(f.repo, "worktree", "add", "-q", "-b", "feat/two", two);
  await writeFile(join(one, "wip.txt"), "uncommitted in a worktree\n");
  await remoteCommits(f, 2);
  const before = { one: await fingerprint(one), two: await fingerprint(two), heads: [head(one), head(two)], indexes: await Promise.all(["wt-one", "two"].map((n) => readFile(join(f.repo, ".git", "worktrees", n, "index")))) };
  expect(await pull(f)).toMatchObject({ update: "fast-forwarded", commits: 2 });
  expect(await fingerprint(one)).toEqual(before.one);
  expect([head(one), head(two)]).toEqual(before.heads);
  for (const [i, n] of ["wt-one", "two"].entries()) expect(Buffer.compare(before.indexes[i], await readFile(join(f.repo, ".git", "worktrees", n, "index")))).toBe(0);
  expect([git(one, "symbolic-ref", "--short", "HEAD"), git(two, "symbolic-ref", "--short", "HEAD")]).toEqual(["feat/one", "feat/two"]);
});

test("what reaches the browser: credentials masked, git's telling lines only", () => {
  expect(maskCredentials("fatal: unable to access 'https://alice:s3cret@git.example.invalid/team/repo.git/'")).toBe("fatal: unable to access 'https://***@git.example.invalid/team/repo.git/'");
  expect(maskCredentials("ssh://deploy@host.example.invalid/x and https://tok3n@h.example.invalid/y")).toBe("ssh://***@host.example.invalid/x and https://***@h.example.invalid/y");
  expect(maskCredentials("nothing to hide in /home/demo/work/x")).toBe("nothing to hide in /home/demo/work/x");
  expect(reasonFrom("hint: try again\nfatal: Could not read from remote repository.\n\nhint: check access")).toBe("Could not read from remote repository.");
  expect(reasonFrom("error: Your local changes to the following files would be overwritten by merge:\n\tapp.txt\nPlease commit your changes or stash them before you merge.\nAborting")).toBe("Your local changes to the following files would be overwritten by merge: app.txt");
  expect(reasonFrom("fatal: unable to access 'https://bob:pw@h.example.invalid/r.git/': timeout")).toBe("unable to access 'https://***@h.example.invalid/r.git/': timeout");
  expect(reasonFrom("")).toBe("git gave no reason");
});

test("one pull per repository at a time; pull-all reports every repository on its own", async () => {
  const slow = await make();
  git(slow.repo, "remote", "set-url", "origin", "ssh://git.example.invalid/team/repo.git");
  process.env.GIT_SSH_COMMAND = "sleep 2 #";
  const first = pull(slow, { fetchTimeoutMs: 800 });
  await expect(pull(slow)).rejects.toBeInstanceOf(PullBusyError);
  expect((await first).update).toBe("failed");
  expect((await pull(slow, { fetchTimeoutMs: 300 })).update).toBe("failed"); // the lock was released

  delete process.env.GIT_SSH_COMMAND;
  const [good, unreachable, offBranch] = [await make(), await make(), await make()];
  await remoteCommits(good, 1);
  git(unreachable.repo, "remote", "set-url", "origin", join(unreachable.base, "nowhere.git"));
  git(offBranch.repo, "checkout", "-q", "-b", "release/4.2");
  const results = await pullAll([good, unreachable, offBranch].map((f) => newRepoConfig(f.repo, true)));
  expect(results.map((r) => r.update)).toEqual(["fast-forwarded", "failed", "skipped"]);
  expect(results.map((r) => r.fetched)).toEqual([true, false, true]);
});

test("nothing but the pull action ever reaches a remote: scans and polls leave a recording remote untouched", async () => {
  const f = await make();
  // Every access to this remote goes through a fake ssh that leaves a marker before failing.
  const marker = join(f.base, "remote-was-contacted");
  const fakeSsh = join(f.base, "fake-ssh.sh");
  await writeFile(fakeSsh, `#!/bin/sh\necho contacted >> "${marker}"\nexit 1\n`);
  await chmod(fakeSsh, 0o755);
  git(f.repo, "remote", "set-url", "origin", "ssh://git.example.invalid/team/repo.git");
  process.env.GIT_SSH_COMMAND = fakeSsh;

  // auto fetch switched off: the schedule arms nothing either
  const repo = { ...newRepoConfig(f.repo, true), autoFetchSeconds: 0 as const };
  const config = { ...defaultConfig(), repos: [repo] };
  const scanner = new Scanner(() => config, { persist: false });
  const timers: (() => void)[] = [];
  const fetcher = new AutoFetcher({ getConfig: () => config, getSnapshot: () => scanner.snapshot, onMoved: () => undefined, setTimer: (run) => timers.push(run), clearTimer: () => undefined });
  for (let i = 0; i < 3; i++) {
    await scanner.trigger().done; // what start-up and the poll interval do
    fetcher.plan();
  }
  expect(scanner.snapshot.repos[0]).toMatchObject({ ok: true, defaultBranch: "main", onDefaultBranch: true, hasRemote: true });
  expect(timers).toHaveLength(0);
  expect(existsSync(marker)).toBe(false);

  // …and the recorder does work: the pull action is what trips it
  expect((await pullRepository(repo)).update).toBe("failed");
  expect(existsSync(marker)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Blocking files: the pure classification, then what a refusal reports.
// ---------------------------------------------------------------------------------------------------------------------

const YAML = "openspec/changes/add-login/.openspec.yaml";
const blob = (id: string, mode = "100644") => ({ mode, id });
const a = "a".repeat(40);
const b = "b".repeat(40);

test("git's -z output parses back into paths, states and blobs, spaces and all", () => {
  expect(parseNulList("one\u0000two\u0000")).toEqual(["one", "two"]);
  const states = parseStatusStates(" M src/app.ts\u0000A  openspec/changes/x/y\u0000?? note s.md\u0000AD gone.txt\u0000");
  expect([...states]).toEqual([
    ["src/app.ts", " M"],
    ["openspec/changes/x/y", "A "],
    ["note s.md", "??"],
    ["gone.txt", "AD"],
  ]);
  expect([...parseBlobEntries(`100644 blob ${a}\t${YAML}\u0000120000 blob ${b}\tlink\u0000`)]).toEqual([
    [YAML, blob(a)],
    ["link", blob(b, "120000")],
  ]);
  expect([...parseBlobEntries(`100755 ${a} 0\tbin/run\u0000`)]).toEqual([["bin/run", blob(a, "100755")]]);
  expect(parseBlobEntries("garbage with no tab\u0000").size).toBe(0);
});

test("only the paths the incoming commits change and the checkout has uncommitted block, once each, sorted", () => {
  const states = new Map([
    ["src/app.ts", " M"],
    ["notes.md", " M"],
  ]);
  expect(blockingSet(["src/app.ts", "src/app.ts", "README.md"], states)).toEqual(["src/app.ts"]);
  expect(blockingSet(["b.txt", "src/app.ts"], new Map([...states, ["b.txt", "??"]]))).toEqual(["b.txt", "src/app.ts"]);
  expect(blockingSet(["README.md"], states)).toEqual([]);
});

test("a leftover path is a change directory's file, never the archive and never an odd name", () => {
  expect(isChangeLeftoverPath(YAML)).toBe(true);
  expect(isChangeLeftoverPath("openspec/changes/add-login/specs/api/spec.md")).toBe(true);
  expect(isChangeLeftoverPath("openspec/changes/archive/2026-01-01-add-login/proposal.md")).toBe(false);
  expect(isChangeLeftoverPath("openspec/changes/add login/proposal.md")).toBe(false); // not a change name
  expect(isChangeLeftoverPath("openspec/changes/../secrets/x.md")).toBe(false);
  expect(isChangeLeftoverPath("openspec/changes/add-login/../../../x")).toBe(false);
  expect(isChangeLeftoverPath("openspec/changes/add-login")).toBe(false); // the directory itself, no file
  expect(isChangeLeftoverPath("openspec/changes/add-login/")).toBe(false);
  expect(isChangeLeftoverPath("openspec/specs/api/spec.md")).toBe(false);
  expect(isChangeLeftoverPath("src/app.ts")).toBe(false);
});

test("what makes a blocking file a leftover, and what makes it differ", () => {
  const facts = { incoming: blob(a), worktree: a, regularFile: true };
  // staged, identical to the incoming blob
  expect(classifyBlocking(YAML, "A ", { ...facts, staged: blob(a) })).toEqual({ path: YAML, kind: "leftover", differs: false, incoming: a, staged: a, worktree: a });
  // staged and edited: the working tree differs
  expect(classifyBlocking(YAML, "AM", { ...facts, staged: blob(a), worktree: b })).toMatchObject({ kind: "leftover", differs: true, worktree: b });
  // staged content differs even though the working tree matches
  expect(classifyBlocking(YAML, "A ", { ...facts, staged: blob(b) })).toMatchObject({ kind: "leftover", differs: true, staged: b });
  // a mode of its own is a difference too
  expect(classifyBlocking(YAML, "A ", { ...facts, staged: blob(a, "100755") })).toMatchObject({ kind: "leftover", differs: true });
  // untracked, never staged
  expect(classifyBlocking(YAML, "??", facts)).toEqual({ path: YAML, kind: "leftover", differs: false, incoming: a, staged: undefined, worktree: a });

  // everything that is the user's own work instead
  const work = { path: YAML, kind: "local-work" as const };
  expect(classifyBlocking(YAML, " M", facts)).toEqual(work); // tracked in the current commit and edited
  expect(classifyBlocking(YAML, "AD", facts)).toEqual(work); // staged new but deleted again
  expect(classifyBlocking(YAML, "A ", { ...facts, incoming: undefined })).toEqual(work); // the incoming commit has no such file
  expect(classifyBlocking(YAML, "A ", { ...facts, incoming: blob(a, "120000") })).toEqual(work); // a symlink upstream
  expect(classifyBlocking(YAML, "A ", { ...facts, staged: blob(a, "120000") })).toEqual(work); // a symlink in the index
  expect(classifyBlocking(YAML, "A ", { ...facts, regularFile: false })).toEqual(work); // not an ordinary file on disk
  expect(classifyBlocking(YAML, "A ", { ...facts, worktree: undefined })).toEqual(work); // could not be hashed
  expect(classifyBlocking("src/app.ts", "A ", facts)).toEqual({ path: "src/app.ts", kind: "local-work" });
  expect(classifyBlocking("openspec/changes/archive/2026-01-01-x/proposal.md", "A ", facts)).toMatchObject({ kind: "local-work" });
});

test("a refusal over local work lists exactly the overlapping files and says what to do about them", async () => {
  const f = await make();
  await remoteCommits(f, 1, "app.txt");
  await writeFile(join(f.repo, "app.txt"), "my edit to the same file\n");
  await writeFile(join(f.repo, "notes.txt"), "an edit nothing incoming touches\n"); // not blocking
  const refused = await pull(f);
  expect(refused).toMatchObject({ update: "refused", blocking: [{ path: "app.txt", kind: "local-work" }], hint: "Commit or set aside the listed files, then pull again." });
  expect(refused.blocking).toHaveLength(1);
  expect(refused.resolvable).toBeUndefined();
  expect(refused.reason).toContain("would be overwritten");
});

test("a change's own leftovers are recognised: staged, untracked, identical and differing, and the offer is made", async () => {
  const f = await make();
  await remoteChange(f, "add-login", { ".openspec.yaml": "schema: spec-driven\n", "prompt.md": "upstream prompt\n" });
  await remoteChange(f, "add-billing", { ".openspec.yaml": "schema: spec-driven\n" });
  await localChange(f, "add-login", { ".openspec.yaml": "schema: spec-driven\n", "prompt.md": "the prompt as it was typed here\n" });
  await localChange(f, "add-billing", { ".openspec.yaml": "schema: spec-driven\n" }, false); // never staged
  const refused = await pull(f);
  expect(refused.update).toBe("refused");
  expect(refused.blocking).toEqual([
    { path: "openspec/changes/add-billing/.openspec.yaml", kind: "leftover", differs: false, incoming: expect.any(String), staged: undefined, worktree: expect.any(String) },
    { path: "openspec/changes/add-login/.openspec.yaml", kind: "leftover", differs: false, incoming: expect.any(String), staged: expect.any(String), worktree: expect.any(String) },
    { path: "openspec/changes/add-login/prompt.md", kind: "leftover", differs: true, incoming: expect.any(String), staged: expect.any(String), worktree: expect.any(String) },
  ]);
  expect(refused.resolvable).toEqual({ upstream: git(f.repo, "rev-parse", "origin/main"), files: refused.blocking ?? [] });
  expect(refused.hint).toContain("Resolve and pull replaces them with the incoming version");
});

test("one real edit among the leftovers withdraws the offer", async () => {
  const f = await make();
  await remoteChange(f, "add-login", { ".openspec.yaml": "schema: spec-driven\n" });
  await remoteCommits(f, 1, "app.txt");
  await localChange(f, "add-login", { ".openspec.yaml": "schema: spec-driven\n" });
  await writeFile(join(f.repo, "app.txt"), "my own edit\n");
  const refused = await pull(f);
  expect(refused.blocking?.map((b) => [b.path, b.kind])).toEqual([
    ["app.txt", "local-work"],
    ["openspec/changes/add-login/.openspec.yaml", "leftover"],
  ]);
  expect(refused.resolvable).toBeUndefined();
  expect(refused.hint).toBe("Commit or set aside the listed files, then pull again.");
});

test("an offer writes nothing: a refused pull with a Resolve and pull offer changed nothing beyond the fetch", async () => {
  const f = await make();
  await remoteChange(f, "add-login", { ".openspec.yaml": "schema: spec-driven\n", "prompt.md": "as merged\n" });
  await localChange(f, "add-login", { ".openspec.yaml": "schema: spec-driven\n", "prompt.md": "as typed here\n" });
  git(f.repo, "fetch", "-q"); // so even the remote-tracking ref is already where the pull will leave it
  const before = { at: head(f.repo), status: status(f.repo), index: await readFile(join(f.repo, ".git", "index")), files: await fingerprint(join(f.repo, "openspec")) };

  const refused = await pull(f);
  expect(refused.resolvable).toBeDefined();
  expect([head(f.repo), status(f.repo)]).toEqual([before.at, before.status]);
  expect(Buffer.compare(before.index, await readFile(join(f.repo, ".git", "index")))).toBe(0);
  expect(await fingerprint(join(f.repo, "openspec"))).toEqual(before.files);
  // …and nothing was written under the dashboard's home either: copies happen only on confirmation
  expect(existsSync(join(process.env.SPEC_CONTROL_HOME as string, "pull-backups"))).toBe(false);
});

test("a diverged refusal says where to reconcile and never mentions forcing", async () => {
  const f = await make();
  await remoteCommits(f, 1);
  await writeFile(join(f.repo, "local.txt"), "local\n");
  git(f.repo, "add", "-A");
  git(f.repo, "commit", "-q", "-m", "local work");
  const refused = await pull(f);
  expect(refused).toMatchObject({ update: "refused", hint: "Reconcile the local commits outside the dashboard, then pull again." });
  expect(refused.blocking).toBeUndefined();
  expect(`${refused.reason} ${refused.hint}`).not.toMatch(/force|--hard|discard|reset/i);
});

// ---------------------------------------------------------------------------------------------------------------------
// The automatic fetch: the pull action's fetch and nothing after it.
// ---------------------------------------------------------------------------------------------------------------------

test("an automatic fetch moves the remote-tracking refs and nothing else: branch, HEAD, index and files stay", async () => {
  const f = await make();
  await remoteCommits(f, 2, "app.txt");
  await writeFile(join(f.repo, "app.txt"), "my uncommitted edit\n");
  await writeFile(join(f.repo, "untracked.txt"), "mine\n");
  const at = head(f.repo);
  const tracking = git(f.repo, "rev-parse", "origin/main");
  const index = await readFile(join(f.repo, ".git", "index"));
  const files = await fingerprint(join(f.repo, "openspec"));
  const outcome = await fetchRepository(newRepoConfig(f.repo, true));
  expect(outcome).toMatchObject({ ok: true, moved: true });
  expect(git(f.repo, "rev-parse", "origin/main")).toBe(head(f.other));
  expect(git(f.repo, "rev-parse", "origin/main")).not.toBe(tracking);
  expect([head(f.repo), git(f.repo, "symbolic-ref", "--short", "HEAD")]).toEqual([at, "main"]);
  expect(await readFile(join(f.repo, ".git", "index"))).toEqual(index);
  expect(await readFile(join(f.repo, "app.txt"), "utf8")).toBe("my uncommitted edit\n");
  expect(await fingerprint(join(f.repo, "openspec"))).toEqual(files);
  expect(git(f.repo, "log", "--oneline", "--merges")).toBe("");

  // nothing new: nothing moved
  expect(await fetchRepository(newRepoConfig(f.repo, true))).toMatchObject({ ok: true, moved: false });
});

test("an automatic fetch without a remote runs nothing; an unreachable one fails with a masked reason", async () => {
  const lonely = await make();
  git(lonely.repo, "remote", "remove", "origin");
  const before = await fingerprint(lonely.repo);
  expect(await fetchRepository(newRepoConfig(lonely.repo, true))).toMatchObject({ ok: false, moved: false, reason: "no remote configured" });
  expect(await fingerprint(lonely.repo)).toEqual(before);

  const f = await make();
  git(f.repo, "remote", "set-url", "origin", "https://someone:hunter2@git.example.invalid/team/repo.git");
  const failed = await fetchRepository(newRepoConfig(f.repo, true), { fetchTimeoutMs: 20_000 });
  expect(failed).toMatchObject({ ok: false, moved: false });
  expect(failed.reason).not.toContain("hunter2");
});

test("an automatic fetch and a pull never overlap: a pull waits, a fetch during a pull is skipped", async () => {
  const slow = await make();
  git(slow.repo, "remote", "set-url", "origin", "ssh://git.example.invalid/team/repo.git");
  process.env.GIT_SSH_COMMAND = "sleep 2 #";
  const repo = newRepoConfig(slow.repo, true);

  // a pull that arrives during an automatic fetch waits for it, then runs its own fetch
  const auto = fetchRepository(repo, { fetchTimeoutMs: 600 });
  const started = Date.now();
  const waited = await pullRepository(repo, { fetchTimeoutMs: 600 });
  expect(waited.update).toBe("failed"); // it ran, rather than being refused as busy
  expect(Date.now() - started).toBeGreaterThanOrEqual(1_000); // two timed-out fetches, one after the other
  expect((await auto).ok).toBe(false);

  // an automatic fetch that falls due during a pull runs nothing
  const pulling = pullRepository(repo, { fetchTimeoutMs: 600 });
  expect(await fetchRepository(repo)).toMatchObject({ skipped: true, ok: false, moved: false });
  await pulling;

  // two pulls still refuse each other
  const first = pullRepository(repo, { fetchTimeoutMs: 600 });
  await expect(pullRepository(repo)).rejects.toBeInstanceOf(PullBusyError);
  await first;
});

test("after an automatic fetch a squash-merged session branch reads merged", async () => {
  const f = await make();
  const wt = join(f.base, "wt-add-login");
  git(f.repo, "worktree", "add", "-q", "-b", "feat/add-login", wt);
  await writeFile(join(wt, "login.txt"), "login\n");
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "login");
  git(wt, "push", "-q", "-u", "origin", "feat/add-login");
  expect((await readWorkStatus(f.repo, wt)).work.state).toBe("pushed");

  // merged on the remote, as a squash, and the branch deleted there
  git(f.other, "fetch", "-q");
  git(f.other, "merge", "-q", "--squash", "origin/feat/add-login");
  git(f.other, "commit", "-q", "-m", "feat: login (#7)");
  git(f.other, "push", "-q", "origin", "main");
  expect((await readWorkStatus(f.repo, wt)).work.state).toBe("pushed"); // as of the last fetch

  expect(await fetchRepository(newRepoConfig(f.repo, true))).toMatchObject({ ok: true, moved: true });
  expect((await readWorkStatus(f.repo, wt)).work.state).toBe("merged");
});

test("a scan reports whether a repository has a remote and when it was last fetched, without fetching", async () => {
  const f = await make();
  const repo = newRepoConfig(f.repo, true);
  const config = { ...defaultConfig(), repos: [repo] };
  const scanner = new Scanner(() => config, { persist: false });
  await rm(join(f.repo, ".git", "FETCH_HEAD"), { force: true });
  await scanner.trigger().done;
  expect(scanner.snapshot.repos[0]).toMatchObject({ ok: true, hasRemote: true });
  expect(scanner.snapshot.repos[0].lastFetchedAt).toBeUndefined();

  await fetchRepository(repo);
  await scanner.trigger().done;
  const fetchedAt = Date.parse(scanner.snapshot.repos[0].lastFetchedAt ?? "");
  expect(Date.now() - fetchedAt).toBeLessThan(60_000);

  const lonely = await make();
  git(lonely.repo, "remote", "remove", "origin");
  git(lonely.repo, "update-ref", "-d", "refs/remotes/origin/main");
  git(lonely.repo, "update-ref", "-d", "refs/remotes/origin/HEAD");
  const alone = { ...defaultConfig(), repos: [newRepoConfig(lonely.repo, true)] };
  const lonelyScanner = new Scanner(() => alone, { persist: false });
  await lonelyScanner.trigger().done;
  expect(lonelyScanner.snapshot.repos[0]).toMatchObject({ ok: true, hasRemote: false });
});

test("with auto fetch on by default, scans, discovery and the state endpoint still never reach the remote; only the schedule does", async () => {
  const f = await make();
  const marker = join(f.base, "remote-was-contacted");
  const fakeSsh = join(f.base, "fake-ssh.sh");
  await writeFile(fakeSsh, `#!/bin/sh\necho contacted >> "${marker}"\nexit 1\n`);
  await chmod(fakeSsh, 0o755);
  git(f.repo, "remote", "set-url", "origin", "ssh://git.example.invalid/team/repo.git");
  process.env.GIT_SSH_COMMAND = fakeSsh;

  const repo = newRepoConfig(f.repo, true); // no setting: fetched every minute
  const config = { ...defaultConfig(), scanRoots: [f.base], repos: [repo] };
  const scanner = new Scanner(() => config, { persist: false });
  const timers: (() => void)[] = [];
  const state: AppState = { config, scanner };
  let moved = 0;
  state.autoFetcher = new AutoFetcher({ getConfig: () => config, getSnapshot: () => scanner.snapshot, onMoved: () => void moved++, setTimer: (run) => timers.push(run), clearTimer: () => undefined });
  for (let i = 0; i < 3; i++) {
    await scanner.trigger().done;
    state.autoFetcher.plan();
  }
  const handle = createFetchHandler({ state, indexHtml: "" });
  const call = (path: string, method = "GET") =>
    handle(new Request(`http://127.0.0.1:4711${path}`, { method, headers: { "content-type": "application/json", host: "127.0.0.1:4711", origin: "http://127.0.0.1:4711" }, body: method === "POST" ? "{}" : undefined }));
  expect((await call("/api/state")).status).toBe(200);
  expect((await call("/api/discover", "POST")).status).toBe(200);
  expect(existsSync(marker)).toBe(false);

  // the armed timer is what reaches the remote, and its failure is reported with the repository
  expect(timers).toHaveLength(1);
  timers[0]();
  for (let i = 0; i < 100 && !(await (await call("/api/state")).json()).repos[0].autoFetch; i++) await Bun.sleep(20);
  expect(existsSync(marker)).toBe(true);
  expect((await (await call("/api/state")).json()).repos[0].autoFetch).toMatchObject({ ok: false });
  expect(moved).toBe(0);
  state.autoFetcher.stop();
});

// ---------------------------------------------------------------------------------------------------------------------
// Configuration and hooks cannot widen the pull; one pull or fetch per git repository (harden-git-invocations).
// ---------------------------------------------------------------------------------------------------------------------

test("hooks do not run for the pull's fetch or its fast-forward", async () => {
  const f = await make();
  const log = await installRepoHooks(f.repo);
  await remoteCommits(f, 2);
  expect(await pull(f)).toMatchObject({ fetched: true, update: "fast-forwarded", commits: 2 });
  expect(head(f.repo)).toBe(head(f.other));
  expect(await hookLog(log)).toEqual([]);
});

test("merge.autoStash configured: an overlapping edit is refused as local work, nothing is stashed or changed", async () => {
  const f = await make();
  git(f.repo, "config", "merge.autoStash", "true");
  await remoteCommits(f, 1, "app.txt");
  await writeFile(join(f.repo, "app.txt"), "my edit to the same file\n");
  const at = head(f.repo);
  const index = await readFile(join(f.repo, ".git", "index"));
  const refused = await pull(f);
  expect(refused).toMatchObject({ fetched: true, update: "refused", blocking: [{ path: "app.txt", kind: "local-work" }] });
  expect([head(f.repo), await readFile(join(f.repo, "app.txt"), "utf8"), status(f.repo)]).toEqual([at, "my edit to the same file\n", "M app.txt"]);
  expect(Buffer.compare(index, await readFile(join(f.repo, ".git", "index")))).toBe(0);
  expect(git(f.repo, "stash", "list")).toBe("");
});

test("one pull per git repository: a sibling project's pull is refused, and its automatic fetch skipped", async () => {
  const m = await monorepo(["packages/a", "packages/b"]);
  bases.push(m.base);
  const a = newRepoConfig(m.project("packages/a"), true);
  const b = newRepoConfig(m.project("packages/b"), true);
  // Both projects were pulled once before, as on any day after the first.
  expect((await pullRepository(a)).update).toBe("up-to-date");
  expect((await pullRepository(b)).update).toBe("up-to-date");

  const remoteCommit = async () => {
    await commitFiles(m.other, { "packages/a/src/keys.ts": `export const keys = ${Math.random()};\n` });
    git(m.other, "push", "-q");
  };
  await remoteCommit();
  const first = pullRepository(b);
  await expect(pullRepository(a)).rejects.toBeInstanceOf(PullBusyError);
  expect(await first).toMatchObject({ update: "fast-forwarded", commits: 1 });
  expect(git(m.top, "reflog", "-n", "1", "--format=%gs")).toContain("merge");

  await remoteCommit();
  const pulling = pullRepository(a);
  expect(await fetchRepository(b)).toMatchObject({ skipped: true, ok: false, moved: false });
  expect(await pulling).toMatchObject({ update: "fast-forwarded", commits: 1 });
});
