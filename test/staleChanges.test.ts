// Stale changes (openspec/specs/stale-changes): stranded archives and archived-and-merged leftovers, both found by the
// scan from a change's exact branches. Real temp git repositories, no network.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newRepoConfig } from "../src/server/config.ts";
import { OPENSPEC_PATHS } from "../src/server/frameworks/registry.ts";
import { worktreesDir } from "../src/server/paths.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { LocalRepoSource } from "../src/server/source.ts";
import type { RepoSnapshot } from "../src/shared/types.ts";
import { ensureWorktree } from "../src/server/sessions/worktree.ts";
import { archiveDate, changeBranches, findDuplicates, findStrandedArchives, parseRecordedBranches, type SessionHint, staleLeftovers } from "../src/server/staleChanges.ts";
import { parseWorktrees } from "../src/server/git.ts";
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

test("a change's branches are named exactly: recorded, the session branches and the session records' branches", () => {
  expect(changeBranches("rotate-keys", { branch: "fix/rotate-keys", archiveBranch: "chore/archive-rotate-keys" }, [])).toEqual([
    "fix/rotate-keys",
    "chore/archive-rotate-keys",
    "feat/rotate-keys",
  ]);
  const sessions: SessionHint[] = [
    { change: "rotate-keys", branch: "feat/rotate-keys-2", worktreePath: "/w/x", running: false },
    { change: "other", branch: "feat/other", worktreePath: "/w/y", running: false },
  ];
  expect(changeBranches("rotate-keys", undefined, sessions)).toEqual(["feat/rotate-keys", "chore/archive-rotate-keys", "feat/rotate-keys-2"]);
  // A recorded name git would not accept is ignored.
  expect(changeBranches("auth", { branch: "-x", archiveBranch: "a..b" }, [])).toEqual(["feat/auth", "chore/archive-auth"]);
  // Containment is not a match.
  expect(changeBranches("auth", undefined, [])).not.toContain("feat/auth-v2");
});

test("the recorded branches are read from the spec-control block of .openspec.yaml only", () => {
  const text = "schema: spec-driven\ncreated: 2026-06-10\nspec-control:\n  branch: fix/rotate-keys # the agent's\n  archive-branch: 'chore/archive-rotate-keys'\n  pr: 12\nother:\n  branch: nope\n";
  expect(parseRecordedBranches(text)).toEqual({ branch: "fix/rotate-keys", archiveBranch: "chore/archive-rotate-keys" });
  expect(parseRecordedBranches("schema: spec-driven\n")).toBeUndefined();
  expect(parseRecordedBranches("spec-control:\n  branch: ../etc\n")).toBeUndefined();
});

test("a branch that only contains the name strands nothing", async () => {
  const repo = await tempGitRepo();
  git(repo, "checkout", "-q", "-b", "feat/structured-logs-v2");
  await archive(repo);
  git(repo, "checkout", "-q", "main");
  expect((await find(repo)).size).toBe(0);
});

test("a session record's own branch strands the archive", async () => {
  const repo = await tempGitRepo();
  git(repo, "checkout", "-q", "-b", "fix/logs");
  const commit = await archive(repo);
  git(repo, "checkout", "-q", "main");
  expect((await find(repo)).size).toBe(0);
  const sessions: SessionHint[] = [{ change: CHANGE, branch: "fix/logs", worktreePath: "/w/gone", running: false }];
  const found = await findStrandedArchives(repo, OPENSPEC_PATHS, [{ name: CHANGE, created: "2026-06-10" }], new Map(), "main", sessions);
  expect(found.get(CHANGE)).toEqual({ branch: "fix/logs", archive: ARCHIVE, commit });
});

// ---------------------------------------------------------------------------------------------------------------------
// Archived and merged
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A repository with a remote whose `main` archived the change, with a session worktree on `feat/structured-logs` made
 * while the change was still active; the main checkout has pulled the archive.
 */
async function archivedSetup(): Promise<{ repo: string; repoId: string; wt: string }> {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  const config = newRepoConfig(repo, true);
  const wt = join(worktreesDir(), config.id, CHANGE);
  await mkdir(join(worktreesDir(), config.id), { recursive: true });
  await ensureWorktree(repo, wt, `feat/${CHANGE}`);
  await archive(repo);
  git(repo, "push", "-q", "origin", "main");
  return { repo, repoId: config.id, wt: await realpath(wt) };
}

async function leftovers(repo: string, opts: { sessions?: SessionHint[]; active?: Map<string, { name: string; created?: string }>; onMain?: Map<string, string>; ending?: string } = {}) {
  const worktrees = parseWorktrees(`${git(repo, "worktree", "list", "--porcelain")}\n`);
  const found = await staleLeftovers({
    repoPath: repo,
    layout: OPENSPEC_PATHS,
    defaultBranch: "main",
    worktrees,
    active: opts.active ?? new Map(),
    archivedOnMain: opts.onMain ?? new Map([[CHANGE, "2026-07-01"]]),
    sessions: opts.sessions ?? [],
    managedRoot: await realpath(worktreesDir()),
    ending: opts.ending,
  });
  return found.get(CHANGE);
}

test("a merged worktree with an uncommitted source edit after the merge is a stale leftover", async () => {
  const { repo, wt } = await archivedSetup();
  await writeFile(join(wt, "src-keys.ts"), "export {};\n");
  const stale = await leftovers(repo);
  expect(stale?.archive).toBe(ARCHIVE);
  expect(stale?.pulled).toBe(true);
  expect(stale?.kept).toEqual([]);
  expect(stale?.leftovers).toEqual([
    {
      kind: "worktree",
      path: wt,
      branch: `feat/${CHANGE}`,
      commit: git(wt, "rev-parse", "HEAD"),
      uncommitted: ["src-keys.ts"],
      uncommittedCount: 1,
      outside: ["src-keys.ts"],
      managed: true,
    },
  ]);
});

test("an archive worktree with the move half committed is a stale leftover reporting that file, inside the change", async () => {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  const wt = join(worktreesDir(), "half", `archive-${CHANGE}`);
  await mkdir(join(worktreesDir(), "half"), { recursive: true });
  await ensureWorktree(repo, wt, `chore/archive-${CHANGE}`);
  // The agent commits the new archive directory, but not the removal of the old one.
  await mkdir(archiveDir(wt), { recursive: true });
  for (const f of ["proposal.md", "design.md"]) await writeFile(join(archiveDir(wt), f), await readFile(join(changeDir(wt), f)));
  git(wt, "add", "--", OPENSPEC_PATHS.archiveDir as string);
  git(wt, "commit", "-q", "-m", "archive");
  await rm(join(changeDir(wt), "proposal.md"));
  // The default branch gets the same content.
  git(repo, "merge", "-q", "--ff-only", `chore/archive-${CHANGE}`);
  git(repo, "push", "-q", "origin", "main");
  const stale = await leftovers(repo);
  const item = stale?.leftovers.find((l) => l.kind === "worktree");
  expect(item).toMatchObject({ kind: "worktree", branch: `chore/archive-${CHANGE}`, uncommitted: [`${OPENSPEC_PATHS.changesDir}/${CHANGE}/proposal.md`], outside: [] });
});

test("a squash-merged branch without a worktree is a stale leftover", async () => {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  git(repo, "checkout", "-q", "-b", `feat/${CHANGE}`);
  await writeFile(join(repo, "feature.ts"), "export const x = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "feat");
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--squash", `feat/${CHANGE}`);
  git(repo, "commit", "-q", "-m", "squash");
  await archive(repo);
  git(repo, "push", "-q", "origin", "main");
  const stale = await leftovers(repo);
  expect(stale?.leftovers).toEqual([{ kind: "branch", name: `feat/${CHANGE}`, commit: git(repo, "rev-parse", `feat/${CHANGE}`) }]);
});

test("the created change directory left in the main checkout is a stale leftover once the archive is there", async () => {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  // Main archives a change that the dashboard had created and staged in the main checkout of another clone.
  const name = "rotate-keys";
  await mkdir(join(repo, OPENSPEC_PATHS.archiveDir as string, `2026-10-20-${name}`), { recursive: true });
  await writeFile(join(repo, OPENSPEC_PATHS.archiveDir as string, `2026-10-20-${name}`, "proposal.md"), "# Proposal\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "archive rotate-keys");
  git(repo, "push", "-q", "origin", "main");
  await mkdir(join(repo, OPENSPEC_PATHS.changesDir, name));
  await writeFile(join(repo, OPENSPEC_PATHS.changesDir, name, ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-10-01\n");
  await writeFile(join(repo, OPENSPEC_PATHS.changesDir, name, "prompt.md"), "rotate the keys\n");
  git(repo, "add", "--", `${OPENSPEC_PATHS.changesDir}/${name}/.openspec.yaml`);
  const found = await staleLeftovers({ repoPath: repo, layout: OPENSPEC_PATHS, defaultBranch: "main", worktrees: [], active: new Map(), archivedOnMain: new Map(), sessions: [] });
  const stale = found.get(name);
  expect(stale?.pulled).toBe(false); // no archive date of the main checkout was given
  expect(stale?.leftovers).toEqual([
    {
      kind: "main",
      dir: `${OPENSPEC_PATHS.changesDir}/${name}`,
      files: [
        { path: ".openspec.yaml", hash: git(repo, "hash-object", `${OPENSPEC_PATHS.changesDir}/${name}/.openspec.yaml`), staged: true },
        { path: "prompt.md", hash: git(repo, "hash-object", `${OPENSPEC_PATHS.changesDir}/${name}/prompt.md`), staged: false },
      ],
    },
  ]);
  // A session running in place in the main checkout keeps it.
  const kept = await staleLeftovers({ repoPath: repo, layout: OPENSPEC_PATHS, defaultBranch: "main", worktrees: [], active: new Map(), archivedOnMain: new Map(), sessions: [{ worktreePath: repo, running: true }] });
  expect(kept.get(name)?.leftovers).toEqual([]);
  expect(kept.get(name)?.kept[0]).toMatchObject({ kind: "main", reason: "an agent session is running in the main checkout" });
});

test("a hand-made worktree on the change's branch outside the dashboard's folder is a leftover like a session worktree", async () => {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  const wt = join(await realpath(await tempDir("osd-own-")), "alpha-infra-wt");
  git(repo, "worktree", "add", "-q", "-b", `feat/${CHANGE}`, wt, "main");
  await archive(repo);
  git(repo, "push", "-q", "origin", "main");
  const stale = await leftovers(repo);
  expect(stale?.leftovers).toMatchObject([{ kind: "worktree", path: wt, managed: false }]);
});

test("work the default branch lacks is kept with its reason", async () => {
  const { repo, wt } = await archivedSetup();
  await writeFile(join(wt, "app.ts"), "export {};\n");
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "feat: new work");
  const stale = await leftovers(repo);
  expect(stale?.leftovers).toEqual([]);
  expect(stale?.kept).toEqual([{ kind: "worktree", id: wt, reason: "it holds 1 commit(s) the default branch lacks" }]);
});

test("a running session keeps its worktree, unless it is the session being ended", async () => {
  const { repo, wt } = await archivedSetup();
  const sessions: SessionHint[] = [{ change: CHANGE, branch: `feat/${CHANGE}`, worktreePath: wt, running: true }];
  const stale = await leftovers(repo, { sessions });
  expect(stale?.leftovers).toEqual([]);
  expect(stale?.kept).toEqual([{ kind: "worktree", id: wt, reason: "an agent session is running in it" }]);
  const ending = await leftovers(repo, { sessions, ending: await realpath(wt) });
  expect(ending?.leftovers).toMatchObject([{ kind: "worktree", path: wt }]);
});

test("an archive not on the default branch yet makes nothing stale", async () => {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  const wt = join(worktreesDir(), "open-pr", `archive-${CHANGE}`);
  await mkdir(join(worktreesDir(), "open-pr"), { recursive: true });
  await ensureWorktree(repo, wt, `chore/archive-${CHANGE}`);
  await archive(wt);
  expect(await leftovers(repo, { onMain: new Map() })).toBeUndefined();
});

test("a newer change reusing the name has no leftovers", async () => {
  const { repo } = await archivedSetup();
  expect(await leftovers(repo, { active: new Map([[CHANGE, { name: CHANGE, created: "2026-08-01" }]]) })).toBeUndefined();
});

test("a branch recorded in the archive's metadata on the default branch is one of the change's branches", async () => {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  git(repo, "branch", "fix/logs-by-agent");
  await rename(changeDir(repo), archiveDir(repo));
  await writeFile(join(archiveDir(repo), ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-06-10\nspec-control:\n  branch: fix/logs-by-agent\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "archive");
  git(repo, "push", "-q", "origin", "main");
  const stale = await leftovers(repo);
  expect(stale?.leftovers).toEqual([{ kind: "branch", name: "fix/logs-by-agent", commit: git(repo, "rev-parse", "fix/logs-by-agent") }]);
});

test("the scan marks the archived change stale and leaves its column alone; nothing on disk changes", async () => {
  const { repo, wt } = await archivedSetup();
  await rm(join(changeDir(wt), "proposal.md"));
  const before = git(wt, "status", "--porcelain");
  const snapshot = await scanRepo(newRepoConfig(repo, true));
  const archived = snapshot.changes.find((c) => c.name === CHANGE && c.archived);
  expect(archived?.stale?.leftovers).toMatchObject([{ kind: "worktree", path: wt, uncommittedCount: 1, outside: [] }]);
  expect(archived?.column).toBe("Archived");
  expect(git(wt, "status", "--porcelain")).toBe(before);
  // The worktree's own copy is not an active card: the default branch archived it.
  expect(snapshot.changes.filter((c) => c.name === CHANGE && !c.archived).every((c) => !c.stale)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Duplicate after archive
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A repository with a remote whose `main` holds the change's archive *and* its directory, as a half-committed archive
 * leaves it: the archive was added, the directory never removed, and the copy kept a file the archive lacks.
 */
async function duplicateRepo(): Promise<string> {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  await mkdir(archiveDir(repo), { recursive: true });
  await cp(changeDir(repo), archiveDir(repo), { recursive: true });
  await writeFile(join(changeDir(repo), "tasks.md"), "- [x] 1.1 Ticked after the archive\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", `chore(openspec): archive ${CHANGE}`);
  git(repo, "push", "-q", "origin", "main");
  return repo;
}

const duplicates = (repo: string, onMain = new Map([[CHANGE, "2026-07-01"]])) => findDuplicates(repo, OPENSPEC_PATHS, onMain);

test("a change committed next to its archive on the default branch is a duplicate", async () => {
  const repo = await duplicateRepo();
  expect((await duplicates(repo)).get(CHANGE)).toEqual({ archive: ARCHIVE, differing: ["tasks.md"], differingCount: 1, pulled: true });
  // Only that change: every other active change has no archive of its name.
  expect([...(await duplicates(repo)).keys()]).toEqual([CHANGE]);
});

test("identical copies are a duplicate with nothing differing", async () => {
  const repo = await duplicateRepo();
  await rm(join(changeDir(repo), "tasks.md"));
  git(repo, "commit", "-q", "-am", "drop the tick");
  git(repo, "push", "-q", "origin", "main");
  expect((await duplicates(repo)).get(CHANGE)).toEqual({ archive: ARCHIVE, differing: [], differingCount: 0, pulled: true });
});

test("a change created after its archive reuses the name and is no duplicate", async () => {
  const repo = await duplicateRepo();
  await writeFile(join(changeDir(repo), ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-08-01\n");
  git(repo, "commit", "-q", "-am", "a new change of the same name");
  git(repo, "push", "-q", "origin", "main");
  expect((await duplicates(repo)).size).toBe(0);
});

test("a copy without a created date counts as not later", async () => {
  const repo = await duplicateRepo();
  await rm(join(changeDir(repo), ".openspec.yaml"));
  git(repo, "commit", "-q", "-am", "no marker");
  git(repo, "push", "-q", "origin", "main");
  expect((await duplicates(repo)).get(CHANGE)?.differing).toEqual([".openspec.yaml", "tasks.md"]);
});

test("a duplicate only the main checkout still has is no duplicate: pulling resolves it", async () => {
  const repo = await duplicateRepo();
  // The default branch removed the directory; the main checkout has not pulled that yet.
  const other = join(await realpath(await tempDir("osd-clone-")), "clone");
  git(repo, "clone", "-q", "-b", "main", git(repo, "remote", "get-url", "origin"), other);
  git(other, "config", "user.email", "t@example.invalid");
  git(other, "config", "user.name", "t");
  git(other, "rm", "-q", "-r", `${OPENSPEC_PATHS.changesDir}/${CHANGE}`);
  git(other, "commit", "-q", "-m", "remove the duplicate");
  git(other, "push", "-q", "origin", "main");
  git(repo, "fetch", "-q", "origin");
  expect((await duplicates(repo)).size).toBe(0);
});

test("the main checkout's state and an existing archive branch are reported", async () => {
  const repo = await duplicateRepo();
  expect((await duplicates(repo, new Map())).get(CHANGE)?.pulled).toBe(false);
  git(repo, "branch", "-q", `chore/archive-${CHANGE}`);
  expect((await duplicates(repo)).get(CHANGE)?.archiveBranch).toBe(`chore/archive-${CHANGE}`);
});

test("a failing git command reports nothing and fails nothing", async () => {
  const plain = await tempDir("osd-plain-");
  expect((await findDuplicates(plain, OPENSPEC_PATHS, new Map())).size).toBe(0);
});

test("the scan marks the archived card as a duplicate and keeps its column, stage and counts", async () => {
  const repo = await duplicateRepo();
  const scan = await scanRepo(newRepoConfig(repo, true));
  const cards = scan.changes.filter((c) => c.name === CHANGE);
  expect(cards).toHaveLength(1);
  expect(cards[0].archived).toBe("2026-07-01");
  expect(cards[0].column).toBe("Archived");
  expect(cards[0].duplicate).toEqual({ archive: ARCHIVE, differing: ["tasks.md"], differingCount: 1, pulled: true });
  // Without the report, the very same cards in the very same columns.
  const board = (s: RepoSnapshot) => s.changes.map((c) => [c.name, c.archived, c.stage, c.column]);
  const unmarked = await scanRepo(newRepoConfig(repo, true), Object.assign(new LocalRepoSource(repo), { duplicates: undefined }));
  expect(unmarked.changes.some((c) => c.duplicate)).toBe(false);
  expect(board(scan)).toEqual(board(unmarked));
});
