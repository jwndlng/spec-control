import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, readlink, realpath, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKUP_LIMITS, deleteBranch, isCleaningUp, previewBranchDelete } from "../src/server/cleanup.ts";
import { newRepoConfig } from "../src/server/config.ts";
import { branchBackupsDir, worktreesDir } from "../src/server/paths.ts";
import { ensureWorktree } from "../src/server/sessions/worktree.ts";
import type { BranchDeletePreview, RepoConfig } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { git, tempGitRepo } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
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

async function userWorktree(r: Repo, branch: string): Promise<string> {
  const path = join(await realpath(await tempDir("osd-wt-")), branch.replace(/\//g, "-"));
  git(r.path, "worktree", "add", "-q", "-b", branch, path, "main");
  return path;
}

async function dashboardWorktree(r: Repo, name: string): Promise<string> {
  const path = join(worktreesDir(), r.repo.id, name);
  await ensureWorktree(r.path, path, `feat/${name}`);
  return realpath(path);
}

const branches = (cwd: string) => git(cwd, "for-each-ref", "--format=%(refname)", "refs/heads").split("\n");
const request = (p: BranchDeletePreview) => ({ path: p.path, branch: p.branch ?? null, commit: p.commit, statusDigest: p.statusDigest });

async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const bytes = await readFile(path).catch(() => undefined);
    if (bytes) out.set(path, bytes.toString("base64"));
  }
  return out;
}

test("preview lists what would be lost and writes nothing", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/report");
  await commit(wt, "a.txt", "1");
  await commit(wt, "b.txt", "2");
  await writeFile(join(wt, "README.md"), "edited");
  await mkdir(join(wt, "notes"));
  await writeFile(join(wt, "notes", "draft.md"), "untracked");
  const old = new Date("2020-01-01T00:00:00Z");
  await utimes(join(wt, "a.txt"), old, old); // stale stat info: `git status` would rewrite the index
  const before = [await snapshotTree(r.path), await snapshotTree(wt)];

  const p = await previewBranchDelete(r.repo, wt);
  expect(p.refused).toBeUndefined();
  expect(p.branch).toBe("feat/report");
  expect(p.commit).toBe(git(wt, "rev-parse", "HEAD"));
  expect(p.uncommitted.sort()).toEqual(["README.md", "notes/draft.md"]);
  expect(p.uncommittedCount).toBe(2);
  expect(p.notOnRemote).toBe(2);
  expect(p.notInBase).toBe(2);
  expect(p.merged).toBe(false);
  expect(p.base).toBe("origin/main");
  expect(p.managed).toBe(false);
  expect([await snapshotTree(r.path), await snapshotTree(wt)]).toEqual(before);
});

test("confirmed deletion backs up uncommitted files, forces the removal and deletes the branch", async () => {
  const r = await repoWithOrigin();
  const wt = await dashboardWorktree(r, "report");
  await commit(wt, "a.txt", "1");
  await writeFile(join(wt, "README.md"), "edited readme");
  await writeFile(join(wt, "new.txt"), "brand new");
  await symlink("new.txt", join(wt, "link.txt"));
  git(r.path, "worktree", "lock", "--reason", "agent", wt); // as an agent CLI leaves its worktrees
  const remoteRefs = git(r.path, "for-each-ref", "refs/remotes");
  const originRefs = git(r.origin, "for-each-ref");
  const mainIndex = await readFile(join(r.path, ".git", "index"));
  const mainStatus = git(r.path, "status", "--porcelain");

  const p = await previewBranchDelete(r.repo, wt);
  expect(p.managed).toBe(true);
  expect(p.locked).toBe(true);
  expect(p.refused).toBeUndefined(); // the dashboard unlocks its own worktrees
  const result = await deleteBranch(r.repo, request(p));
  expect(result.outcome).toBe("deleted");
  expect(result.branch).toBe("feat/report");
  expect(result.commit).toBe(p.commit);
  expect(result.backedUp).toBe(3);
  expect(existsSync(wt)).toBe(false);
  expect(branches(r.path)).not.toContain("refs/heads/feat/report");

  const backup = result.backupDir!;
  expect(backup.startsWith(branchBackupsDir())).toBe(true);
  expect(await readFile(join(backup, "files", "README.md"), "utf8")).toBe("edited readme");
  expect(await readFile(join(backup, "files", "new.txt"), "utf8")).toBe("brand new");
  expect(await readlink(join(backup, "files", "link.txt"))).toBe("new.txt");
  const record = JSON.parse(await readFile(join(backup, "backup.json"), "utf8"));
  expect(record).toMatchObject({ branch: "feat/report", commit: p.commit, worktree: wt });

  expect(git(r.path, "for-each-ref", "refs/remotes")).toBe(remoteRefs);
  expect(git(r.origin, "for-each-ref")).toBe(originRefs);
  expect(await readFile(join(r.path, ".git", "index"))).toEqual(mainIndex);
  expect(git(r.path, "status", "--porcelain")).toBe(mainStatus);
  expect(git(r.path, "branch", "--show-current")).toBe("main");

  git(r.path, "branch", "feat/report", result.commit!); // the restore command the dialog shows
  expect(git(r.path, "rev-parse", "feat/report")).toBe(p.commit);
});

test("a clean, unmerged branch is deleted without a backup", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "fix/parser");
  await commit(wt, "p.txt", "1");
  await commit(wt, "q.txt", "2");
  const p = await previewBranchDelete(r.repo, wt);
  expect(p.uncommittedCount).toBe(0);
  expect(p.notInBase).toBe(2);
  const result = await deleteBranch(r.repo, request(p));
  expect(result).toMatchObject({ outcome: "deleted", branch: "fix/parser", commit: p.commit });
  expect(result.backupDir).toBeUndefined();
  expect(existsSync(wt)).toBe(false);
});

test("a merged, clean worktree is reported as merged", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/done");
  const p = await previewBranchDelete(r.repo, wt);
  expect(p.merged).toBe(true);
  expect(p.notInBase).toBe(0);
});

test("a file written after the preview refuses the deletion and deletes nothing", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/busy");
  await writeFile(join(wt, "one.txt"), "1");
  const p = await previewBranchDelete(r.repo, wt);
  await writeFile(join(wt, "late.txt"), "after the preview");
  const result = await deleteBranch(r.repo, request(p));
  expect(result.outcome).toBe("refused");
  expect(result.reason).toContain("changed since you looked");
  expect(existsSync(join(wt, "late.txt"))).toBe(true);
  expect(branches(r.path)).toContain("refs/heads/feat/busy");
  expect(existsSync(branchBackupsDir()) ? (await readdir(branchBackupsDir(), { recursive: true })).some((f) => String(f).includes("feat_busy")) : false).toBe(false);
});

test("a branch moved after the preview refuses the deletion", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/moving");
  const p = await previewBranchDelete(r.repo, wt);
  await commit(wt, "m.txt", "1");
  const result = await deleteBranch(r.repo, request(p));
  expect(result.outcome).toBe("refused");
  expect(result.reason).toContain("branch changed");
  expect(existsSync(wt)).toBe(true);
});

test("a running session, a user's lock, the default branch and a foreign path are refused", async () => {
  const r = await repoWithOrigin();
  const running = await userWorktree(r, "feat/running");
  const p = await previewBranchDelete(r.repo, running, new Set([running]));
  expect(p.refused).toContain("agent session");
  expect((await deleteBranch(r.repo, request(p), new Set([running]))).outcome).toBe("refused");
  expect(existsSync(running)).toBe(true);

  const locked = await userWorktree(r, "feat/locked");
  git(r.path, "worktree", "lock", "--reason", "in use by editor", locked);
  expect((await previewBranchDelete(r.repo, locked)).refused).toContain("in use by editor");

  git(r.path, "checkout", "-q", "-b", "feat/elsewhere");
  const onMain = join(await realpath(await tempDir("osd-wt-")), "main");
  git(r.path, "worktree", "add", "-q", onMain, "main");
  expect((await previewBranchDelete(r.repo, onMain)).refused).toBe("it is the default branch");

  expect((await previewBranchDelete(r.repo, "/tmp/elsewhere")).refused).toContain("not a linked worktree");
  expect((await previewBranchDelete(r.repo, r.path)).refused).toContain("not a linked worktree");
});

test("a detached worktree is removed and no branch is deleted", async () => {
  const r = await repoWithOrigin();
  const path = join(await realpath(await tempDir("osd-wt-")), "detached");
  git(r.path, "worktree", "add", "-q", "--detach", path, "main");
  await writeFile(join(path, "scratch.txt"), "x");
  const before = branches(r.path);
  const p = await previewBranchDelete(r.repo, path);
  expect(p.branch).toBeUndefined();
  const result = await deleteBranch(r.repo, request(p));
  expect(result.outcome).toBe("removed");
  expect(result.branch).toBeUndefined();
  expect(existsSync(path)).toBe(false);
  expect(branches(r.path)).toEqual(before);
});

test("too much to back up is refused before anything is removed", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/huge");
  const saved = BACKUP_LIMITS.files;
  BACKUP_LIMITS.files = 2;
  try {
    for (const n of [1, 2, 3]) await writeFile(join(wt, `f${n}.txt`), String(n));
    const p = await previewBranchDelete(r.repo, wt);
    expect(p.refused).toContain("exceed what a backup holds");
    expect((await deleteBranch(r.repo, request(p))).outcome).toBe("refused");
    expect(existsSync(wt)).toBe(true);
  } finally {
    BACKUP_LIMITS.files = saved;
  }
});

test("the deletion holds the repository's cleanup lock while it runs", async () => {
  const r = await repoWithOrigin();
  const wt = await userWorktree(r, "feat/lock");
  const p = await previewBranchDelete(r.repo, wt);
  const pending = deleteBranch(r.repo, request(p));
  expect(isCleaningUp(r.repo.id)).toBe(true);
  await pending;
  expect(isCleaningUp(r.repo.id)).toBe(false);
  expect((await stat(r.path)).isDirectory()).toBe(true);
});
