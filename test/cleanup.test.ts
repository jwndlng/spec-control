import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, realpath, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyCleanup, applyStaleCleanup, CleanupBusyError, isBranchName, isCleaningUp, previewCleanup, previewStaleCleanup, StaleCleanupError, type StaleScope } from "../src/server/cleanup.ts";
import { newRepoConfig } from "../src/server/config.ts";
import { repositoryKey } from "../src/server/git.ts";
import { worktreesDir } from "../src/server/paths.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { ensureWorktree } from "../src/server/sessions/worktree.ts";
import type { CleanupPreview, RepoConfig, RepoPullRequests, StaleCleanupPreview, StaleCleanupRequest } from "../src/shared/types.ts";
import { parsePullRequest } from "../src/server/pullRequests.ts";
import { ghPr, installFakeGh } from "./ghHelpers.ts";
import { tempDir, treeFingerprint, useTempHome } from "./helpers.ts";
import { hookLog, installRepoHooks } from "./hookHelpers.ts";
import { commitFiles, monorepo, squashMerge as squashMergeAt } from "./monorepoHelpers.ts";
import { git, harness, tempGitRepo, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: Harness["manager"][] = [];

// A commit may start `git maintenance run --auto` in the background (it does on the macOS runners), which then writes
// lock files into `.git/objects` while a test compares the repository byte for byte. The setup's git must not do that.
const NO_AUTO_MAINTENANCE: Record<string, string> = {
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "maintenance.auto",
  GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_KEY_1: "gc.auto",
  GIT_CONFIG_VALUE_1: "0",
};
const savedEnv = Object.fromEntries(Object.keys(NO_AUTO_MAINTENANCE).map((k) => [k, process.env[k]]));

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  Object.assign(process.env, NO_AUTO_MAINTENANCE);
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await cleanup();
});

interface Repo {
  repo: RepoConfig;
  path: string;
  origin: string;
}

/** A repository with an `origin` (a bare repository next to it) that has `main`, as after a clone. */
async function repoWithOrigin(): Promise<Repo> {
  const path = await tempGitRepo();
  const origin = join(await tempDir("osd-origin-"), "origin.git");
  git(path, "init", "-q", "--bare", origin);
  git(path, "remote", "add", "origin", origin);
  git(path, "push", "-q", "-u", "origin", "main");
  git(path, "remote", "set-head", "origin", "main");
  return { repo: newRepoConfig(path, true), path, origin };
}

const commit = async (cwd: string, file: string, content: string) => {
  await writeFile(join(cwd, file), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", `edit ${file}`);
};

/** A worktree the user made next to the repository, as `git worktree add` would. */
async function userWorktree(r: Repo, branch: string): Promise<string> {
  const path = join(await tempDir("osd-wt-"), branch.replace(/\//g, "-"));
  git(r.path, "worktree", "add", "-q", "-b", branch, path, "main");
  return path;
}

/** A worktree the dashboard made for a session. */
async function dashboardWorktree(r: Repo, name: string): Promise<string> {
  const path = join(worktreesDir(), r.repo.id, name);
  await ensureWorktree(r.path, path, `feat/${name}`);
  return realpath(path);
}

/** Squash-merges `branch` into main and pushes main; the remote has no such branch, as after a merged and deleted PR. */
function squashMerge(r: Repo, branch: string) {
  git(r.path, "merge", "-q", "--squash", branch);
  git(r.path, "commit", "-q", "-m", `squash ${branch}`);
  git(r.path, "push", "-q", "origin", "main");
}

const worktreeOf = (p: CleanupPreview, path: string) => p.worktrees.find((w) => w.path === path);
const branchOf = (p: CleanupPreview, name: string) => p.branches.find((b) => b.name === name);
const branches = (path: string) => git(path, "for-each-ref", "--format=%(refname)", "refs/heads").split("\n").filter(Boolean);

async function mergedEvidenceRepo(kind: "squash" | "rebase" = "squash") {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/merge-proof");
  await commit(wt, "proof.txt", "from branch");
  const headOid = git(wt, "rev-parse", "HEAD");
  await commit(r.path, "other.txt", "base moved");
  if (kind === "squash") squashMerge(r, "feat/merge-proof");
  else git(r.path, "cherry-pick", headOid); // rebase merge: replay onto the advanced base, preserving the PR's original head
  const mergeOid = git(r.path, "rev-parse", "HEAD");
  await commit(r.path, "proof.txt", "later base edit");
  git(r.path, "push", "-q", "origin", "main");
  git(r.path, "remote", "set-url", "origin", "https://github.com/acme/alpha-infra.git");
  const evidence: RepoPullRequests = {
    repoId: r.repo.id, github: "acme/alpha-infra", status: "ok", fetchedAt: new Date().toISOString(),
    pullRequests: [parsePullRequest(ghPr({ number: 81, state: "MERGED", headRefName: "feat/merge-proof", headRefOid: headOid,
      mergeCommit: { oid: mergeOid }, isCrossRepository: false, mergedAt: new Date().toISOString() }))!],
  };
  return { ...r, wt, headOid, mergeOid, evidence };
}

for (const kind of ["squash", "rebase"] as const) test(`${kind} PR evidence recognizes the exact merged head after later base edits, with no network or repository writes`, async () => {
  const r = await mergedEvidenceRepo(kind);
  const gh = await installFakeGh({ mode: "fail" });
  try {
    const before = [await snapshotTree(r.path), await snapshotTree(r.wt)];
    const p = await previewCleanup(r.repo, new Set(), r.evidence);
    expect(branchOf(p, "feat/merge-proof")).toMatchObject({ removable: true, mergedBy: "pull-request", pullRequest: 81, worktreePath: r.wt, evidenceFetchedAt: r.evidence.fetchedAt });
    expect(worktreeOf(p, r.wt)).toMatchObject({ removable: true, work: { state: "merged" } });
    expect([await snapshotTree(r.path), await snapshotTree(r.wt)]).toEqual(before);
    expect(await gh.calls()).toEqual([]);
    const result = await applyCleanup(r.repo, { worktrees: [r.wt], prune: false, branches: [{ name: "feat/merge-proof", commit: r.headOid }] }, new Set(), r.evidence);
    expect(result.items.map((i) => i.outcome)).toEqual(["removed", "deleted"]);
    expect(result.items.at(-1)?.commit).toBe(r.headOid);
    expect(await gh.calls()).toEqual([]);
  } finally { gh.restore(); }
});

test("missing, stale, failed, fork, wrong repository/base/head and unfetched evidence never proves recent work merged", async () => {
  const r = await mergedEvidenceRepo();
  const pr = r.evidence.pullRequests[0];
  const patches: Partial<RepoPullRequests>[] = [
    { repoId: "another" }, { github: "acme/another" }, { status: "failed" }, { fetchedAt: undefined },
    { fetchedAt: "invalid" }, { fetchedAt: new Date(Date.now() - 6 * 60_000).toISOString() },
    { fetchedAt: new Date(Date.now() + 60_000).toISOString() }, { pullRequests: [] },
    ...[{ base: "trunk" }, { isCrossRepository: true }, { isCrossRepository: undefined }, { headOid: "a".repeat(40) },
      { mergeOid: undefined }, { mergeOid: "--all" }, { mergeOid: r.headOid }, { state: "closed" as const }]
      .map((patch) => ({ pullRequests: [{ ...pr, ...patch }] })),
  ];
  for (const patch of patches) {
    const evidence = { ...r.evidence, ...patch };
    const b = branchOf(await previewCleanup(r.repo, new Set(), evidence), "feat/merge-proof")!;
    expect(b.removable).toBe(false);
    expect(b.mergedBy).toBeUndefined();
    expect(b.nextAction).toBeTruthy();
  }
  const unfetched = { ...r.evidence, pullRequests: [{ ...pr, mergeOid: r.headOid }] };
  expect(branchOf(await previewCleanup(r.repo, new Set(), unfetched), "feat/merge-proof")).toMatchObject({ reason: expect.stringContaining("not reachable"), nextAction: expect.stringContaining("Pull") });
  const result = await applyCleanup(r.repo, { worktrees: [r.wt], prune: false, branches: [{ name: "feat/merge-proof", commit: r.headOid }] }, new Set(), unfetched);
  expect(result.items.every((i) => i.outcome === "kept")).toBe(true);
});

test("exact PR evidence preserves dirty work, external locks, running sessions, active changes, main/default branches and moved heads", async () => {
  const r = await mergedEvidenceRepo();
  git(r.path, "worktree", "lock", "--reason", "editor", r.wt);
  expect(worktreeOf(await previewCleanup(r.repo, new Set(), r.evidence), r.wt)).toMatchObject({ removable: false, reason: expect.stringContaining("locked") });
  git(r.path, "worktree", "unlock", r.wt);
  expect(worktreeOf(await previewCleanup(r.repo, new Set([r.wt]), r.evidence), r.wt)).toMatchObject({ removable: false, reason: expect.stringContaining("session") });
  await writeFile(join(r.wt, "untracked.txt"), "keep");
  expect(worktreeOf(await previewCleanup(r.repo, new Set(), r.evidence), r.wt)).toMatchObject({ removable: false, reason: expect.stringContaining("uncommitted") });
  await rm(join(r.wt, "untracked.txt"));
  await mkdir(join(r.path, "openspec/changes/merge-proof"));
  expect(branchOf(await previewCleanup(r.repo, new Set(), r.evidence), "feat/merge-proof")).toMatchObject({ removable: false, reason: expect.stringContaining("active change") });
  await rm(join(r.path, "openspec/changes/merge-proof"), { recursive: true });
  const p = await previewCleanup(r.repo, new Set(), r.evidence);
  expect(branchOf(p, "main")).toBeUndefined();
  await commit(r.wt, "additional.txt", "post-merge work");
  const later = branchOf(await previewCleanup(r.repo, new Set(), r.evidence), "feat/merge-proof")!;
  expect(later).toMatchObject({ removable: false, reason: expect.stringContaining("head differs"), nextAction: expect.stringContaining("additional commits") });
  const changed = await applyCleanup(r.repo, { worktrees: [], prune: false, branches: [{ name: "feat/merge-proof", commit: r.headOid }, { name: "main", commit: git(r.path, "rev-parse", "main") }] }, new Set(), r.evidence);
  expect(changed.items).toMatchObject([{ outcome: "kept", reason: "it changed since the preview" }, { outcome: "kept", reason: "it is the default branch" }]);
});

test("branch names that could reach git as anything but a branch are refused", () => {
  for (const ok of ["feat/audit-trail", "fix/parser", "chore/archive-x.y", "main"]) expect(isBranchName(ok)).toBe(true);
  for (const bad of ["--all", "-D", "../x", "a..b", "a//b", "a/", "a.", "x.lock", "a/.b", "", " x", 3, undefined]) expect(isBranchName(bad)).toBe(false);
});

test("preview: a squash-merged worktree and its branch are removable; the branch depends on the worktree", async () => {
  const r = await repoWithOrigin();
  const wt = await dashboardWorktree(r, "audit-trail");
  await commit(wt, "a.txt", "1");
  await commit(wt, "b.txt", "2");
  await commit(wt, "a.txt", "3");
  squashMerge(r, "feat/audit-trail");

  const p = await previewCleanup(r.repo);
  expect(p.base).toBe("origin/main");
  expect(worktreeOf(p, wt)).toMatchObject({ branch: "feat/audit-trail", managed: true, removable: false, reason: "it is part of the active change audit-trail", work: { state: "merged" } });
  expect(branchOf(p, "feat/audit-trail")).toMatchObject({ removable: false, reason: "it is part of the active change audit-trail" });
  expect(branchOf(p, "main")).toBeUndefined();
});

test("preview: an unmerged branch is kept with its commit count; a fast-forward-merged one is removable", async () => {
  const r = await repoWithOrigin();
  git(r.path, "branch", "fix/parser");
  git(r.path, "branch", "feat/done");
  const wt = await userWorktree(r, "tmp/work");
  git(wt, "switch", "-q", "fix/parser");
  await commit(wt, "p.txt", "1");
  await commit(wt, "q.txt", "2");
  git(wt, "switch", "-q", "feat/done");
  await commit(wt, "d.txt", "1");
  git(wt, "switch", "-q", "tmp/work");
  git(r.path, "merge", "-q", "--ff-only", "feat/done");
  git(r.path, "push", "-q", "origin", "main");

  const p = await previewCleanup(r.repo);
  expect(branchOf(p, "fix/parser")).toMatchObject({ removable: false, reason: expect.stringContaining("without sufficient merge evidence") });
  expect(branchOf(p, "feat/done")).toMatchObject({ removable: true, mergedBy: "ancestry" });
  expect(worktreeOf(p, wt)).toMatchObject({ managed: false, removable: true });
});

test("preview: old unmerged branch without an active change is removable", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "fix/old-maintenance");
  await writeFile(join(wt, "old.txt"), "old work\\n");
  git(wt, "add", "-A");
  const oldDateEnv = { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" };
  const result = Bun.spawnSync(["git", "commit", "-q", "-m", "edit old.txt"], { cwd: wt, env: oldDateEnv, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git commit: ${result.stderr.toString()}`);
  const p = await previewCleanup(r.repo);
  expect(branchOf(p, "fix/old-maintenance")).toMatchObject({ removable: true, reason: "old work not associated with an active change" });
  expect(worktreeOf(p, wt)).toMatchObject({ removable: true });
});

test("preview: a dirty user worktree is kept and so is its merged branch", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/report");
  await writeFile(join(wt, "scratch.txt"), "wip");
  const p = await previewCleanup(r.repo);
  expect(worktreeOf(p, wt)).toMatchObject({ removable: false, reason: "the worktree has uncommitted changes" });
  expect(branchOf(p, "feat/report")).toMatchObject({ removable: false, reason: expect.stringContaining("which is kept") });
});

test("preview: deleted worktree directories are stale records; locked user worktrees and running sessions are kept", async () => {
  const r = await repoWithOrigin();
  const busy = await dashboardWorktree(r, "busy"); // first: creating a session worktree prunes stale records
  const gone = await userWorktree(r, "feat/gone");
  await rm(gone, { recursive: true, force: true });
  const locked = await userWorktree(r, "feat/held");
  git(r.path, "worktree", "lock", "--reason", "in use by editor", locked);

  const p = await previewCleanup(r.repo, new Set([busy]));
  expect(p.prunable).toEqual([{ path: gone }]);
  expect(branchOf(p, "feat/gone")).toMatchObject({ removable: true, prunePath: gone });
  expect(worktreeOf(p, locked)).toMatchObject({ removable: false, reason: "it is locked (in use by editor)" });
  expect(worktreeOf(p, busy)).toMatchObject({ removable: false, reason: "an agent session is running in it" });
});

test("stale records and their branches are removed together, with restore commands and current-head protection", async () => {
  const r = await repoWithOrigin();
  const gone = await userWorktree(r, "feat/prunable");
  await rm(gone, { recursive: true, force: true });
  const before = branchOf(await previewCleanup(r.repo), "feat/prunable")!;
  expect(before).toMatchObject({ removable: true, prunePath: gone });
  const selection = { worktrees: [], prune: true, branches: [{ name: before.name, commit: before.commit }] };
  const kept = await applyCleanup(r.repo, { ...selection, prune: false });
  expect(kept.items[0]).toMatchObject({ outcome: "kept", reason: expect.stringContaining("select pruning") });
  const result = await applyCleanup(r.repo, selection);
  expect(result.items).toEqual([
    { kind: "prune", id: gone, outcome: "pruned" },
    { kind: "branch", id: before.name, outcome: "deleted", commit: before.commit },
  ]);
  git(r.path, "branch", before.name, before.commit);
  expect(git(r.path, "rev-parse", before.name)).toBe(before.commit);

  const moved = await userWorktree(r, "feat/moved-prunable");
  const old = branchOf(await previewCleanup(r.repo), "feat/moved-prunable")!;
  await commit(moved, "new.txt", "new work");
  await rm(moved, { recursive: true, force: true });
  const changed = await applyCleanup(r.repo, { ...selection, branches: [{ name: old.name, commit: old.commit }] });
  expect(changed.items.at(-1)).toMatchObject({ outcome: "kept", reason: "it changed since the preview" });
});

test("failed pruning keeps its dependent branch; running sessions protect stale records' branches", async () => {
  const r = await repoWithOrigin();
  const gone = await userWorktree(r, "feat/retained-record");
  await rm(gone, { recursive: true, force: true });
  const p = await previewCleanup(r.repo);
  const b = branchOf(p, "feat/retained-record")!;
  const bin = await tempDir("osd-prune-refusal-");
  const realGit = Bun.which("git")!;
  await writeFile(join(bin, "git"), `#!/bin/sh\ncase "$*" in *"worktree prune"*) echo 'prune refused for test' >&2; exit 1 ;; esac\nexec '${realGit.replace(/'/g, "'\\''")}' "$@"\n`);
  await chmod(join(bin, "git"), 0o755);
  const savedPath = process.env.PATH;
  let result: Awaited<ReturnType<typeof applyCleanup>>;
  try {
    process.env.PATH = `${bin}:${savedPath}`;
    result = await applyCleanup(r.repo, { worktrees: [], prune: true, branches: [{ name: b.name, commit: b.commit }] });
  } finally {
    process.env.PATH = savedPath;
  }
  expect(result.items).toMatchObject([
    { outcome: "kept", reason: "git refused to prune" },
    { outcome: "kept", reason: "git refused to prune the stale worktree record" },
  ]);
  expect(branchOf(await previewCleanup(r.repo, new Set([gone])), b.name)).toMatchObject({ removable: false, reason: "an agent session is running in it" });
});

test("preview: the main checkout's branch is kept, and without a default branch every branch is kept", async () => {
  const r = await repoWithOrigin();
  git(r.path, "switch", "-q", "-c", "feat/redesign");
  let p = await previewCleanup(r.repo);
  expect(branchOf(p, "feat/redesign")).toMatchObject({ removable: false, reason: "it is checked out in the main checkout" });

  const bare = await tempGitRepo();
  git(bare, "branch", "-m", "main", "trunk");
  git(bare, "branch", "side");
  p = await previewCleanup(newRepoConfig(bare, true));
  expect(p.base).toBeUndefined();
  expect(branchOf(p, "side")).toMatchObject({ removable: false, reason: "the default branch is unknown" });
});

/**
 * Every file below `dir` with its bytes, so "nothing changed" can be asserted exactly. A file listed a moment ago can
 * be gone by the time it is read — git's own background maintenance writes and deletes locks under `.git/objects/` —
 * so a vanished file is left out of the snapshot rather than throwing. Test repositories switch that maintenance off
 * (`tempGitRepo`), which is what keeps this from hiding a real deletion: both snapshots see the same set either way.
 */
async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const bytes = await readFile(path).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined;
      throw err;
    });
    if (bytes) out.set(path, bytes.toString("base64"));
  }
  return out;
}

test("preview writes nothing, not even a refreshed index", async () => {
  const r = await repoWithOrigin();
  const wt = await dashboardWorktree(r, "quiet");
  await commit(wt, "a.txt", "1");
  squashMerge(r, "feat/quiet");
  await commit(r.path, "tracked.txt", "x");
  const old = new Date("2020-01-01T00:00:00Z");
  await utimes(join(r.path, "tracked.txt"), old, old); // stale stat info: `git status` would rewrite the index
  await utimes(join(wt, "a.txt"), old, old);
  const before = [await snapshotTree(r.path), await snapshotTree(wt)];
  const mtime = (await stat(join(r.path, ".git", "index"))).mtimeMs;
  await previewCleanup(r.repo);
  expect([await snapshotTree(r.path), await snapshotTree(wt)]).toEqual(before);
  expect((await stat(join(r.path, ".git", "index"))).mtimeMs).toBe(mtime);
});

test("apply: removes the worktree, then its branch, and reports the commit to restore it", async () => {
  const r = await repoWithOrigin();
  const wt = await dashboardWorktree(r, "quiet");
  await commit(wt, "a.txt", "1");
  squashMerge(r, "feat/quiet");
  const p = await previewCleanup(r.repo);
  const b = branchOf(p, "feat/quiet")!;

  const result = await applyCleanup(r.repo, { worktrees: [wt], prune: false, branches: [{ name: b.name, commit: b.commit }] });
  expect(result.items).toEqual([
    { kind: "worktree", id: wt, outcome: "removed" },
    { kind: "branch", id: "feat/quiet", outcome: "deleted", commit: b.commit },
  ]);
  expect(existsSync(wt)).toBe(false);
  expect(branches(r.path)).not.toContain("refs/heads/feat/quiet");
  git(r.path, "branch", "feat/quiet", b.commit); // the restore command the dialog shows
  expect(git(r.path, "rev-parse", "feat/quiet")).toBe(b.commit);
});

test("apply: re-checks every item — a new file, a moved branch, a foreign path and a bad name are all kept", async () => {
  const r = await repoWithOrigin();
  const dirty = await userWorktree(r, "feat/dirty");
  const other = await userWorktree(r, "feat/other");
  git(r.path, "branch", "feat/moved");
  const p = await previewCleanup(r.repo);
  expect(worktreeOf(p, dirty)?.removable).toBe(true);
  const moved = branchOf(p, "feat/moved")!;
  expect(moved.removable).toBe(true);

  await writeFile(join(dirty, "late.txt"), "after the preview");
  await commit(other, "o.txt", "1");
  git(r.path, "branch", "-f", "feat/moved", "feat/other");

  const result = await applyCleanup(r.repo, {
    worktrees: [dirty, "/tmp/elsewhere"],
    prune: false,
    branches: [
      { name: "feat/dirty", commit: branchOf(p, "feat/dirty")!.commit },
      { name: "feat/moved", commit: moved.commit },
      { name: "--all", commit: moved.commit },
      { name: "main", commit: git(r.path, "rev-parse", "main") },
    ],
  });
  expect(result.items).toEqual([
    { kind: "worktree", id: dirty, outcome: "kept", reason: "the worktree has uncommitted changes" },
    { kind: "worktree", id: "/tmp/elsewhere", outcome: "kept", reason: "not a worktree of this repository" },
    { kind: "branch", id: "feat/dirty", outcome: "kept", reason: expect.stringContaining("which is kept") },
    { kind: "branch", id: "feat/moved", outcome: "kept", reason: "it changed since the preview" },
    { kind: "branch", id: "--all", outcome: "kept", reason: "not a valid branch name" },
    { kind: "branch", id: "main", outcome: "kept", reason: "it is the default branch" },
  ]);
  expect(existsSync(dirty)).toBe(true);
  expect(branches(r.path)).toEqual(expect.arrayContaining(["refs/heads/feat/dirty", "refs/heads/feat/moved", "refs/heads/main"]));
});

test("apply: prunes stale records, and a locked user worktree is neither unlocked nor removed", async () => {
  const r = await repoWithOrigin();
  const gone = await userWorktree(r, "feat/gone");
  await rm(gone, { recursive: true, force: true });
  const locked = await userWorktree(r, "feat/held");
  git(r.path, "worktree", "lock", "--reason", "keep", locked);

  const result = await applyCleanup(r.repo, { worktrees: [locked], prune: true, branches: [] });
  expect(result.items).toEqual([
    { kind: "worktree", id: locked, outcome: "kept", reason: "it is locked (keep)" },
    { kind: "prune", id: gone, outcome: "pruned" },
  ]);
  const listed = git(r.path, "worktree", "list", "--porcelain");
  expect(listed).not.toContain(gone);
  expect(listed).toContain("locked keep");
});

test("apply leaves the remote, remote-tracking refs and the main checkout alone", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/pushed");
  await commit(wt, "x.txt", "1");
  git(wt, "push", "-q", "-u", "origin", "feat/pushed");
  git(r.path, "merge", "-q", "--ff-only", "feat/pushed");
  git(r.path, "push", "-q", "origin", "main");
  git(r.path, "branch", "feat/extra");
  const remoteRefs = () => git(r.path, "for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes");
  const originRefs = () => git(r.origin, "for-each-ref", "--format=%(refname) %(objectname)");
  const before = {
    remote: remoteRefs(),
    origin: originRefs(),
    index: await readFile(join(r.path, ".git", "index")),
    head: git(r.path, "symbolic-ref", "HEAD"),
    status: git(r.path, "status", "--porcelain"),
  };

  const p = await previewCleanup(r.repo);
  const pick = (n: string) => ({ name: n, commit: branchOf(p, n)!.commit });
  const result = await applyCleanup(r.repo, { worktrees: [wt], prune: false, branches: [pick("feat/pushed"), pick("feat/extra")] });
  expect(result.items.map((i) => i.outcome)).toEqual(["removed", "deleted", "deleted"]);
  expect({
    remote: remoteRefs(),
    origin: originRefs(),
    index: await readFile(join(r.path, ".git", "index")),
    head: git(r.path, "symbolic-ref", "HEAD"),
    status: git(r.path, "status", "--porcelain"),
  }).toEqual(before);
});

test("sessions cannot start in a repository while its cleanup runs, and a second cleanup is refused", async () => {
  const h = await harness();
  managers.push(h.manager);
  const repo = h.config.repos[0];
  const first = applyCleanup(repo, { worktrees: [], prune: true, branches: [] });
  expect(isCleaningUp(repo.id)).toBe(true);
  await expect(applyCleanup(repo, { worktrees: [], prune: false, branches: [] })).rejects.toThrow("already running");
  await expect(h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).rejects.toThrow("cleanup");
  await first;
  expect(isCleaningUp(repo.id)).toBe(false);
});

test("running session worktrees are reported by real path", async () => {
  const h = await harness();
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(await h.manager.runningWorktreePaths()).toEqual(new Set([await realpath(s.worktreePath)]));
});

// ---------------------------------------------------------------------------------------------------------------------
// A stale change's cleanup (stale-changes: "A stale change's leftovers are cleaned up on one confirmation").
// ---------------------------------------------------------------------------------------------------------------------

const STALE = "structured-logs";
const STALE_ARCHIVE = `2026-07-01-${STALE}`;

/** Archives `STALE` on `main` and pushes it; a session worktree on `feat/<STALE>` made before, and a merged archive branch. */
async function staleRepo(): Promise<Repo & { wt: string; scope: () => Promise<StaleScope> }> {
  const r = await repoWithOrigin();
  const wt = join(worktreesDir(), r.repo.id, STALE);
  await mkdir(join(worktreesDir(), r.repo.id), { recursive: true });
  await ensureWorktree(r.path, wt, `feat/${STALE}`);
  await rename(join(r.path, "openspec/changes", STALE), join(r.path, "openspec/changes/archive", STALE_ARCHIVE));
  git(r.path, "add", "-A");
  git(r.path, "commit", "-q", "-m", "archive");
  git(r.path, "push", "-q", "origin", "main");
  git(r.path, "branch", `chore/archive-${STALE}`);
  const scope = async (): Promise<StaleScope> => ({ scanned: await scanRepo(r.repo), hints: [], runningPaths: new Set() });
  return { ...r, wt: await realpath(wt), scope };
}

function requestFor(preview: StaleCleanupPreview, acknowledged = false): StaleCleanupRequest {
  const leftovers = preview.stale?.leftovers ?? [];
  const main = leftovers.find((l) => l.kind === "main");
  return {
    worktrees: leftovers.flatMap((l) => (l.kind === "worktree" ? [{ path: l.path, branch: l.branch ?? null, commit: l.commit, uncommitted: l.uncommitted }] : [])),
    branches: leftovers.flatMap((l) => (l.kind === "branch" ? [{ name: l.name, commit: l.commit }] : [])),
    mainCheckout: main?.kind === "main" ? { files: main.files.map(({ path, hash }) => ({ path, hash })) } : null,
    acknowledged,
  };
}

const heads = (path: string) => git(path, "for-each-ref", "--format=%(refname)", "refs/heads").split("\n").filter(Boolean);

test("two stale leftovers go on one confirmation, with a backup of the uncommitted source file", async () => {
  const r = await staleRepo();
  await writeFile(join(r.wt, "keys.ts"), "export const k = 1;\n");
  const scope = await r.scope();
  const preview = await previewStaleCleanup(r.repo, scope, STALE);
  expect(preview.stale?.leftovers.map((l) => l.kind).sort()).toEqual(["branch", "worktree"]);
  const worktree = preview.stale?.leftovers.find((l) => l.kind === "worktree");
  expect(worktree).toMatchObject({ path: r.wt, uncommitted: ["keys.ts"], outside: ["keys.ts"] });

  // Without the acknowledgement nothing goes.
  await expect(applyStaleCleanup(r.repo, scope, STALE, requestFor(preview))).rejects.toBeInstanceOf(StaleCleanupError);
  expect(existsSync(r.wt)).toBe(true);

  const result = await applyStaleCleanup(r.repo, scope, STALE, requestFor(preview, true));
  expect(result.items.map((i) => [i.kind, i.outcome]).sort()).toEqual([
    ["branch", "deleted"],
    ["worktree", "deleted"],
  ]);
  const removed = result.items.find((i) => i.kind === "worktree");
  expect(removed?.branch).toBe(`feat/${STALE}`);
  expect(await readFile(join(removed?.backupDir as string, "files", "keys.ts"), "utf8")).toBe("export const k = 1;\n");
  expect(existsSync(r.wt)).toBe(false);
  expect(heads(r.path)).toEqual(["refs/heads/main"]);
  // No longer stale.
  expect((await scanRepo(r.repo)).changes.some((c) => c.stale)).toBe(false);
});

test("a worktree whose only uncommitted file is inside the change needs no acknowledgement and is still backed up", async () => {
  const r = await staleRepo();
  git(r.path, "branch", "-q", "-D", `chore/archive-${STALE}`);
  await rm(join(r.wt, "openspec/changes", STALE, "proposal.md"));
  const scope = await r.scope();
  const preview = await previewStaleCleanup(r.repo, scope, STALE);
  expect(preview.stale?.leftovers).toMatchObject([{ kind: "worktree", outside: [], uncommitted: [`openspec/changes/${STALE}/proposal.md`] }]);
  const result = await applyStaleCleanup(r.repo, scope, STALE, requestFor(preview));
  expect(result.items).toMatchObject([{ kind: "worktree", outcome: "deleted" }]);
  expect(existsSync(r.wt)).toBe(false);
});

test("the main checkout's staged copy is backed up where it differs from the archive, removed and its removal staged", async () => {
  const r = await staleRepo();
  await rm(r.wt, { recursive: true, force: true });
  git(r.path, "worktree", "prune");
  git(r.path, "branch", "-q", "-D", `feat/${STALE}`, `chore/archive-${STALE}`);
  // What the dashboard created and staged, and never anybody committed there.
  const dir = join(r.path, "openspec/changes", STALE);
  await mkdir(dir);
  await writeFile(join(dir, "proposal.md"), await readFile(join(r.path, "openspec/changes/archive", STALE_ARCHIVE, "proposal.md")));
  await writeFile(join(dir, "prompt.md"), "log everything\n");
  git(r.path, "add", "--", `openspec/changes/${STALE}/`);
  const head = git(r.path, "rev-parse", "HEAD");
  const scope = await r.scope();
  const preview = await previewStaleCleanup(r.repo, scope, STALE);
  expect(preview.stale?.leftovers).toMatchObject([{ kind: "main", dir: `openspec/changes/${STALE}`, files: [{ path: "prompt.md", staged: true }, { path: "proposal.md", staged: true }] }]);
  const result = await applyStaleCleanup(r.repo, scope, STALE, requestFor(preview));
  expect(result.items).toMatchObject([{ kind: "main", outcome: "removed", backedUp: 1 }]);
  // Only the file that differs from the archive's copy is kept aside.
  expect(await readdir(join(result.items[0].backupDir as string, "files"))).toEqual(["prompt.md"]);
  expect(existsSync(dir)).toBe(false);
  expect(git(r.path, "status", "--porcelain")).toBe("");
  expect(git(r.path, "rev-parse", "HEAD")).toBe(head);
  expect(git(r.path, "branch", "--show-current")).toBe("main");
});

test("with openspec/changes a symbolic link, the main checkout's copy is kept, nothing is backed up for it, and the rest still goes", async () => {
  const r = await staleRepo();
  const dir = join(r.path, "openspec/changes", STALE);
  await mkdir(dir);
  await writeFile(join(dir, "prompt.md"), "log everything\n");
  git(r.path, "add", "--", `openspec/changes/${STALE}/`);
  const scope = await r.scope();
  const preview = await previewStaleCleanup(r.repo, scope, STALE);
  expect(preview.stale?.leftovers.map((l) => l.kind).sort()).toEqual(["branch", "main", "worktree"]);
  // The link appears after the user looked: the removal re-checks every segment immediately before it deletes.
  const target = join(await tempDir("osd-shared-changes-"), "shared-changes");
  await rename(join(r.path, "openspec/changes"), target);
  await symlink(target, join(r.path, "openspec/changes"));
  const before = await treeFingerprint(target);
  const result = await applyStaleCleanup(r.repo, scope, STALE, requestFor(preview, true));
  const main = result.items.find((i) => i.kind === "main");
  expect(main).toMatchObject({ outcome: "kept" });
  expect(main?.reason).toContain("openspec/changes is a symbolic link");
  expect(main?.backupDir).toBeUndefined();
  expect(result.items.filter((i) => i.kind !== "main").map((i) => i.outcome)).toEqual(["deleted", "deleted"]);
  expect(await treeFingerprint(target)).toEqual(before);
});

test("an item that changed since the dialog is kept, and the rest still goes", async () => {
  const r = await staleRepo();
  const scope = await r.scope();
  const preview = await previewStaleCleanup(r.repo, scope, STALE);
  // A new commit lands on the archive branch after the user looked.
  git(r.path, "checkout", "-q", `chore/archive-${STALE}`);
  await writeFile(join(r.path, "late.txt"), "late\n");
  git(r.path, "add", "-A");
  git(r.path, "commit", "-q", "-m", "late");
  git(r.path, "checkout", "-q", "main");
  const result = await applyStaleCleanup(r.repo, scope, STALE, requestFor(preview));
  expect(result.items.find((i) => i.kind === "branch")).toMatchObject({ outcome: "kept" });
  expect(result.items.find((i) => i.kind === "worktree")).toMatchObject({ outcome: "deleted" });
  expect(heads(r.path)).toContain(`refs/heads/chore/archive-${STALE}`);
});

test("nothing is removed when the archive is gone from the default branch", async () => {
  const r = await staleRepo();
  const scope = await r.scope();
  const preview = await previewStaleCleanup(r.repo, scope, STALE);
  git(r.path, "reset", "-q", "--hard", "HEAD~1");
  git(r.path, "push", "-q", "-f", "origin", "main");
  const result = await applyStaleCleanup(r.repo, scope, STALE, requestFor(preview, true));
  expect(result.refused).toContain("no longer archived on the default branch");
  expect(result.items).toEqual([]);
  expect(existsSync(r.wt)).toBe(true);
});

test("an item that is no stale leftover of the change is kept and never removed", async () => {
  const r = await staleRepo();
  const other = join(worktreesDir(), r.repo.id, "report");
  await ensureWorktree(r.path, other, "feat/report");
  const scope = await r.scope();
  const result = await applyStaleCleanup(r.repo, scope, STALE, {
    worktrees: [{ path: other, branch: "feat/report", commit: git(other, "rev-parse", "HEAD"), uncommitted: [] }],
    branches: [{ name: "feat/report", commit: git(other, "rev-parse", "HEAD") }],
    mainCheckout: null,
    acknowledged: true,
  });
  expect(result.items.map((i) => i.outcome)).toEqual(["kept", "kept"]);
  expect(result.items[0].reason).toContain(`not a stale leftover of "${STALE}"`);
  expect(existsSync(other)).toBe(true);
});

test("a stale cleanup contacts no remote and leaves every remote-tracking ref alone", async () => {
  const r = await staleRepo();
  const remotes = git(r.path, "for-each-ref", "refs/remotes");
  const marker = join(await tempDir("osd-ssh-"), "remote-was-contacted");
  const fakeSsh = join(dirname(marker), "fake-ssh.sh");
  await writeFile(fakeSsh, `#!/bin/sh\necho contacted >> "${marker}"\nexit 1\n`);
  await chmod(fakeSsh, 0o755);
  git(r.path, "remote", "set-url", "origin", "ssh://git.example.invalid/team/repo.git");
  process.env.GIT_SSH_COMMAND = fakeSsh;
  try {
    const scope = await r.scope();
    const preview = await previewStaleCleanup(r.repo, scope, STALE);
    const result = await applyStaleCleanup(r.repo, scope, STALE, requestFor(preview, true));
    expect(result.items.every((i) => i.outcome !== "kept")).toBe(true);
  } finally {
    delete process.env.GIT_SSH_COMMAND;
  }
  expect(existsSync(marker)).toBe(false);
  expect(git(r.path, "for-each-ref", "refs/remotes")).toBe(remotes);
});

// ---------------------------------------------------------------------------------------------------------------------
// Projects in a subfolder of their repository, hooks, and one cleanup per git repository (harden-git-invocations).
// ---------------------------------------------------------------------------------------------------------------------

test("a subfolder project's unmerged branch is kept with its commit count, and a crafted confirmation deletes nothing", async () => {
  const m = await monorepo();
  const repo = newRepoConfig(m.project(), true);
  git(m.top, "switch", "-q", "-c", "feat/rotate-keys");
  const tip = await commitFiles(m.top, { "packages/tools/src/keys.ts": "export const keys = 2;\n" });
  git(m.top, "switch", "-q", "main");

  const p = await previewCleanup(repo);
  expect(branchOf(p, "feat/rotate-keys")).toMatchObject({ removable: false, reason: expect.stringContaining("without sufficient merge evidence") });
  const result = await applyCleanup(repo, { worktrees: [], prune: false, branches: [{ name: "feat/rotate-keys", commit: tip }] });
  expect(result.items).toMatchObject([{ kind: "branch", id: "feat/rotate-keys", outcome: "kept", reason: expect.stringContaining("without sufficient merge evidence") }]);
  expect(branches(m.top)).toContain("refs/heads/feat/rotate-keys");

  squashMergeAt(m.top, "feat/rotate-keys");
  const merged = await previewCleanup(repo);
  expect(branchOf(merged, "feat/rotate-keys")).toMatchObject({ removable: true, mergedBy: "content" });
  const deleted = await applyCleanup(repo, { worktrees: [], prune: false, branches: [{ name: "feat/rotate-keys", commit: tip }] });
  expect(deleted.items).toMatchObject([{ kind: "branch", outcome: "deleted" }]);
});

test("hooks do not run: a cleanup removes a merged worktree, prunes a record and deletes a merged branch", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/pushed");
  await commit(wt, "x.txt", "1");
  git(wt, "push", "-q", "-u", "origin", "feat/pushed");
  git(r.path, "merge", "-q", "--ff-only", "feat/pushed");
  git(r.path, "push", "-q", "origin", "main");
  git(r.path, "branch", "feat/extra");
  const gone = await userWorktree(r, "feat/gone");
  await rm(gone, { recursive: true, force: true });
  const log = await installRepoHooks(r.path);

  const p = await previewCleanup(r.repo);
  const pick = (n: string) => ({ name: n, commit: branchOf(p, n)!.commit });
  const result = await applyCleanup(r.repo, { worktrees: [wt], prune: true, branches: [pick("feat/pushed"), pick("feat/extra")] });
  expect(result.items.map((i) => [i.kind, i.outcome])).toEqual([
    ["worktree", "removed"],
    ["prune", "pruned"],
    ["branch", "deleted"],
    ["branch", "deleted"],
  ]);
  expect(await hookLog(log)).toEqual([]);
});

test("one cleanup per git repository: a cleanup of a sibling project is refused as busy while one runs", async () => {
  const m = await monorepo(["packages/a", "packages/b"]);
  const a = newRepoConfig(m.project("packages/a"), true);
  const b = newRepoConfig(m.project("packages/b"), true);
  git(m.top, "branch", "feat/extra");
  const tip = git(m.top, "rev-parse", "feat/extra");
  // Both projects resolved their repository once before, as any earlier action does.
  await Promise.all([repositoryKey(a.path), repositoryKey(b.path)]);

  const first = applyCleanup(a, { worktrees: [], prune: true, branches: [] });
  await expect(applyCleanup(b, { worktrees: [], prune: false, branches: [{ name: "feat/extra", commit: tip }] })).rejects.toBeInstanceOf(CleanupBusyError);
  await first;
  expect(branches(m.top)).toContain("refs/heads/feat/extra");
  // Once it is over, the sibling's cleanup runs.
  expect((await applyCleanup(b, { worktrees: [], prune: false, branches: [{ name: "feat/extra", commit: tip }] })).items).toMatchObject([{ outcome: "deleted" }]);
});
