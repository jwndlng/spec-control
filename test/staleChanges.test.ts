// Stale changes (openspec/specs/stale-changes): stranded archives found by the scan, settled worktrees found by the
// worktree listing. Real temp git repositories, no network.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newRepoConfig } from "../src/server/config.ts";
import { OPENSPEC_PATHS } from "../src/server/frameworks/registry.ts";
import { worktreesDir } from "../src/server/paths.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { listWorktrees } from "../src/server/sessions/workStatus.ts";
import { ensureWorktree } from "../src/server/sessions/worktree.ts";
import { archiveDate, findStrandedArchives, settledArchive } from "../src/server/staleChanges.ts";
import type { ChangeSession } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { git, tempGitRepo } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterAll(() => cleanup());

const CHANGE = "structured-logs";
const ARCHIVE = `2026-07-01-${CHANGE}`;
const changeDir = (root: string) => join(root, OPENSPEC_PATHS.changesDir, CHANGE);
const archiveDir = (root: string) => join(root, OPENSPEC_PATHS.archiveDir as string, ARCHIVE);

async function withOrigin(repoPath: string): Promise<string> {
  const bare = join(await realpath(await tempDir("osd-origin-")), "origin.git");
  git(repoPath, "init", "-q", "--bare", bare);
  git(repoPath, "remote", "add", "origin", bare);
  git(repoPath, "push", "-q", "-u", "origin", "main");
  git(repoPath, "remote", "set-head", "origin", "main");
  return bare;
}

/** Archives the change in `cwd` and commits it, as `/opsx:archive` would. */
async function archive(cwd: string): Promise<string> {
  await rename(changeDir(cwd), archiveDir(cwd));
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", `chore(openspec): archive ${CHANGE}`);
  return git(cwd, "rev-parse", "HEAD");
}

/** A repository whose branch `feat/structured-logs` archived the change; the main checkout is back on `main`. */
async function strandedRepo(): Promise<{ repo: string; commit: string }> {
  const repo = await tempGitRepo();
  git(repo, "checkout", "-q", "-b", `feat/${CHANGE}`);
  const commit = await archive(repo);
  git(repo, "checkout", "-q", "main");
  return { repo, commit };
}

const find = (repo: string, created = "2026-06-10", onMain = new Map<string, string>()) => findStrandedArchives(repo, OPENSPEC_PATHS, [{ name: CHANGE, created }], onMain, "main");

test("an archive directory belongs to the change of exactly that name", () => {
  expect(archiveDate(ARCHIVE, CHANGE)).toBe("2026-07-01");
  expect(archiveDate(`2026-07-01-${CHANGE}-v2`, CHANGE)).toBeUndefined();
  expect(archiveDate(`2026-07-01-x${CHANGE}`, CHANGE)).toBeUndefined();
});

test("an archive committed on a branch and never brought over is stranded", async () => {
  const { repo, commit } = await strandedRepo();
  expect(await find(repo)).toEqual(new Map([[CHANGE, { branch: `feat/${CHANGE}`, archive: ARCHIVE, commit }]]));
});

test("the scan marks a stranded archive and keeps the change's column", async () => {
  const { repo, commit } = await strandedRepo();
  const before = (await scanRepo(newRepoConfig(repo, true))).changes.find((c) => c.name === CHANGE);
  expect(before?.strandedArchive).toEqual({ branch: `feat/${CHANGE}`, archive: ARCHIVE, commit });
  expect(before?.archived).toBeUndefined();
  // Without the branch, the very same change in the very same column, unmarked.
  git(repo, "branch", "-q", "-D", `feat/${CHANGE}`);
  const after = (await scanRepo(newRepoConfig(repo, true))).changes.find((c) => c.name === CHANGE);
  expect(after?.strandedArchive).toBeUndefined();
  expect(after?.column).toBe(before?.column as string);
});

test("an archive the default branch already has is not stranded", async () => {
  const { repo } = await strandedRepo();
  await withOrigin(repo);
  git(repo, "push", "-q", "origin", `feat/${CHANGE}:main`);
  git(repo, "fetch", "-q", "origin");
  expect((await find(repo)).size).toBe(0);
});

test("an archive the main checkout has is not stranded", async () => {
  const { repo } = await strandedRepo();
  expect((await find(repo, "2026-06-10", new Map([[CHANGE, "2026-07-01"]]))).size).toBe(0);
});

test("a change created after the archive reuses the name and is not stranded", async () => {
  const { repo } = await strandedRepo();
  expect((await find(repo, "2026-08-01")).size).toBe(0);
});

test("a remote-tracking branch alone still strands the archive", async () => {
  const { repo, commit } = await strandedRepo();
  await withOrigin(repo);
  git(repo, "push", "-q", "origin", `feat/${CHANGE}`);
  git(repo, "branch", "-q", "-D", `feat/${CHANGE}`);
  expect(await find(repo)).toEqual(new Map([[CHANGE, { branch: `origin/feat/${CHANGE}`, archive: ARCHIVE, commit }]]));
});

test("branches that do not name the change and the default branch are never read", async () => {
  const repo = await tempGitRepo();
  git(repo, "checkout", "-q", "-b", "feat/other-work");
  await archive(repo);
  git(repo, "checkout", "-q", "main");
  expect((await find(repo)).size).toBe(0);
});

/** A session worktree of the change, made while main still had it active; then main archives it. */
async function settledSetup(): Promise<{ repo: string; repoId: string; wt: string }> {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  const config = newRepoConfig(repo, true);
  const wt = join(worktreesDir(), config.id, CHANGE);
  await mkdir(join(worktreesDir(), config.id), { recursive: true });
  await ensureWorktree(repo, wt, `feat/${CHANGE}`);
  await archive(repo);
  git(repo, "push", "-q", "origin", "main");
  return { repo, repoId: config.id, wt };
}

test("a worktree whose only uncommitted edit is inside the archived change is settled", async () => {
  const { repo, wt } = await settledSetup();
  await rm(join(changeDir(wt), "proposal.md"));
  expect(await settledArchive(repo, wt, CHANGE, OPENSPEC_PATHS)).toEqual({ archive: ARCHIVE, uncommitted: 1 });
});

test("a clean worktree of an archived change is settled", async () => {
  const { repo, wt } = await settledSetup();
  expect(await settledArchive(repo, wt, CHANGE, OPENSPEC_PATHS)).toEqual({ archive: ARCHIVE, uncommitted: 0 });
});

test("work outside the change's directory is never settled", async () => {
  const { repo, wt } = await settledSetup();
  await rm(join(changeDir(wt), "proposal.md"));
  await writeFile(join(wt, "app.ts"), "export {};\n");
  expect(await settledArchive(repo, wt, CHANGE, OPENSPEC_PATHS)).toBeUndefined();
});

test("a commit the default branch lacks is never settled", async () => {
  const { repo, wt } = await settledSetup();
  await writeFile(join(wt, "app.ts"), "export {};\n");
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "feat: new work");
  expect(await settledArchive(repo, wt, CHANGE, OPENSPEC_PATHS)).toBeUndefined();
});

test("a change the default branch has not archived is never settled", async () => {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  const wt = join(worktreesDir(), "x", CHANGE);
  await ensureWorktree(repo, wt, `feat/${CHANGE}`);
  expect(await settledArchive(repo, wt, CHANGE, OPENSPEC_PATHS)).toBeUndefined();
});

test("the worktree listing marks a settled worktree unless a session runs in it", async () => {
  const { repo, repoId, wt } = await settledSetup();
  await rm(join(changeDir(wt), "proposal.md"));
  const config = { ...newRepoConfig(repo, true), id: repoId };
  const session = (state: ChangeSession["state"]): ChangeSession => ({
    id: "s1",
    repoId,
    change: CHANGE,
    action: "implement",
    agentId: "fake",
    agentName: "Fake",
    state,
    worktreePath: wt,
    branch: `feat/${CHANGE}`,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    resumable: true,
  });
  const [ended] = await listWorktrees([config], [session("exited")]);
  expect(ended.settled).toEqual({ archive: ARCHIVE, uncommitted: 1 });
  const [running] = await listWorktrees([config], [session("running")]);
  expect(running.settled).toBeUndefined();
  // Nothing on disk changed for any of it.
  expect(await readFile(join(changeDir(wt), "design.md"), "utf8").catch(() => "")).not.toBe("");
});
