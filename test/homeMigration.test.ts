import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { chmod, lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describeOutcome, MIGRATION_RECORD, migrateHome, NOT_YET_ATTEMPTED, type PendingStep, startHomeMigration } from "../src/server/homeMigration.ts";
import { dashboardHome, useFallbackHome } from "../src/server/paths.ts";
import { gitIn, tempDir, treeFingerprint, useTempHome } from "./helpers.ts";
import { hookLog, installRepoHooks } from "./hookHelpers.ts";

const SESSION_A = "0a7081db-fe14-4e65-b5de-9cfa1bf49c67";
const SESSION_B = "17f50d9a-7625-404b-93d8-7405183287d2";

// The repair runs git through `gitWrite`, whose empty hooks folder lives under the dashboard home: never the real one.
let cleanupHome: () => Promise<void>;
beforeAll(async () => {
  ({ cleanup: cleanupHome } = await useTempHome());
});
afterAll(() => cleanupHome());

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  useFallbackHome(undefined);
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

/** What the spec promises stays untouched in the main checkout: working tree, HEAD, refs and index. */
async function mainCheckoutFingerprint(repo: string): Promise<string> {
  const files = await Promise.all(["HEAD", "index", "packed-refs"].map((f) => readFile(join(repo, ".git", f), "utf8").catch(() => "")));
  return [await git(repo, "ls-files", "-s"), await git(repo, "for-each-ref"), await readFile(join(repo, "README.md"), "utf8"), ...files].join("\n---\n");
}

async function newRepo(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await gitIn(path, "init", "-q");
  await writeFile(join(path, "README.md"), "demo\n");
  await gitIn(path, "add", "README.md");
  await gitIn(path, "commit", "-q", "-m", "init");
}

/** A synthetic old home with a config, two session records, a cache, a session worktree and a stray directory. */
async function world() {
  const root = await tempDir("osd-migrate-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const oldHome = join(root, "home", ".openspec-dashboard");
  const newHome = join(root, "home", ".spec-control");
  const repo = join(root, "w", "demo-ops");
  await newRepo(repo);
  const userWorktree = join(root, "w", "demo-ops-hotfix");
  await gitIn(repo, "worktree", "add", "-q", "-b", "hotfix", userWorktree);

  const sessionWorktree = join(oldHome, "worktrees", "3d84480c2b4d", "feat-x");
  await mkdir(join(oldHome, "worktrees", "3d84480c2b4d"), { recursive: true });
  await gitIn(repo, "worktree", "add", "-q", "-b", "feat/x", sessionWorktree);
  await gitIn(repo, "worktree", "lock", sessionWorktree);
  await mkdir(join(oldHome, "worktrees", "3d84480c2b4d", "stray"));

  const consoleFolder = join(oldHome, "console", "mine");
  await writeFile(join(oldHome, "config.json"), `${JSON.stringify({ scanRoots: [join(root, "w")], agentSessions: { consoleFolder } }, null, 2)}\n`);
  for (const [id, meta] of [
    [SESSION_A, { id: SESSION_A, worktreePath: sessionWorktree, branch: "feat/x" }],
    [SESSION_B, { id: SESSION_B, folder: join(root, "w"), branch: "main" }],
  ] as const) {
    await mkdir(join(oldHome, "sessions", id), { recursive: true });
    await writeFile(join(oldHome, "sessions", id, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
  }
  await mkdir(join(oldHome, "cache"));
  await writeFile(join(oldHome, "cache", "snapshot.json"), JSON.stringify({ worktree: sessionWorktree }));
  return { root, oldHome, newHome, repo, userWorktree, sessionWorktree, consoleFolder };
}

test("moves the home, leaves a link, rewrites stored paths and re-registers only its own worktrees", async () => {
  const w = await world();
  const before = await mainCheckoutFingerprint(w.repo);
  const userRecord = await readFile(join(w.repo, ".git", "worktrees", "demo-ops-hotfix", "gitdir"), "utf8");
  const untouched = await readFile(join(w.oldHome, "sessions", SESSION_B, "meta.json"), "utf8");

  const outcome = await migrateHome(w.oldHome, w.newHome);
  expect(outcome).toEqual({ kind: "migrated", from: w.oldHome, to: w.newHome, pending: [] });

  expect((await lstat(w.oldHome)).isSymbolicLink()).toBe(true);
  expect(await readlink(w.oldHome)).toBe(w.newHome);
  expect((await lstat(w.newHome)).isDirectory()).toBe(true);

  const moved = w.sessionWorktree.replace(w.oldHome, w.newHome);
  const meta = JSON.parse(await readFile(join(w.newHome, "sessions", SESSION_A, "meta.json"), "utf8"));
  expect(meta.worktreePath).toBe(moved);
  expect((await lstat(join(w.newHome, "sessions", SESSION_A, "meta.json"))).mode & 0o777).toBe(0o600);
  expect(await readFile(join(w.newHome, "sessions", SESSION_B, "meta.json"), "utf8")).toBe(untouched);
  const config = JSON.parse(await readFile(join(w.newHome, "config.json"), "utf8"));
  expect(config.agentSessions.consoleFolder).toBe(w.consoleFolder.replace(w.oldHome, w.newHome));
  expect(config.scanRoots).toEqual([join(w.root, "w")]);
  expect(await exists(join(w.newHome, "cache", "snapshot.json"))).toBe(false);

  const listed = await git(w.repo, "worktree", "list", "--porcelain");
  expect(listed).toContain(`worktree ${moved}\n`);
  expect(listed).not.toContain(w.sessionWorktree);
  expect(listed).toContain("locked"); // the lock survives the repair
  expect(await git(moved, "status", "--porcelain")).toBe("");
  expect(await readFile(join(w.repo, ".git", "worktrees", "demo-ops-hotfix", "gitdir"), "utf8")).toBe(userRecord);
  expect(await mainCheckoutFingerprint(w.repo)).toBe(before);

  const record = JSON.parse(await readFile(join(w.newHome, MIGRATION_RECORD), "utf8"));
  expect(record.pending).toEqual([]);
});

test("nothing to migrate when neither home exists, or only the new one", async () => {
  const root = await tempDir("osd-migrate-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const oldHome = join(root, ".openspec-dashboard");
  const newHome = join(root, ".spec-control");
  expect(await migrateHome(oldHome, newHome)).toEqual({ kind: "nothing" });
  expect(await exists(newHome)).toBe(false);
  await mkdir(newHome);
  const before = await treeFingerprint(root);
  expect(await migrateHome(oldHome, newHome)).toEqual({ kind: "nothing" });
  expect(await treeFingerprint(root)).toBe(before);
});

test("both homes as directories: nothing is moved or merged", async () => {
  const w = await world();
  await mkdir(w.newHome);
  const before = await treeFingerprint(join(w.root, "home"));
  expect(await migrateHome(w.oldHome, w.newHome)).toEqual({ kind: "both", old: w.oldHome });
  expect(await treeFingerprint(join(w.root, "home"))).toBe(before);
});

test("a second start after the migration does nothing", async () => {
  const w = await world();
  await migrateHome(w.oldHome, w.newHome);
  const before = await treeFingerprint(join(w.root, "home"));
  expect(await migrateHome(w.oldHome, w.newHome)).toEqual({ kind: "nothing" });
  expect(await treeFingerprint(join(w.root, "home"))).toBe(before);
});

test("our own link with the new home deleted is not moved onto itself", async () => {
  const root = await tempDir("osd-migrate-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const oldHome = join(root, ".openspec-dashboard");
  const newHome = join(root, ".spec-control");
  await symlink(newHome, oldHome);
  expect(await migrateHome(oldHome, newHome)).toEqual({ kind: "nothing" });
  expect(await readlink(oldHome)).toBe(newHome);
  expect(await exists(newHome)).toBe(false);
});

test("an old home that is a link elsewhere moves as a link and keeps its target", async () => {
  const root = await tempDir("osd-migrate-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "elsewhere");
  await mkdir(target);
  await writeFile(join(target, "config.json"), "{}\n");
  const oldHome = join(root, "home", ".openspec-dashboard");
  const newHome = join(root, "home", ".spec-control");
  await mkdir(join(root, "home"));
  await symlink(target, oldHome);
  expect((await migrateHome(oldHome, newHome)).kind).toBe("migrated");
  expect(await readlink(newHome)).toBe(target);
  expect(await readlink(oldHome)).toBe(newHome);
  expect(await readFile(join(newHome, "config.json"), "utf8")).toBe("{}\n");
});

test("a refused rename leaves the old home in place and in use", async () => {
  const root = await tempDir("osd-migrate-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const oldHome = join(root, "a", ".openspec-dashboard");
  const locked = join(root, "b");
  const newHome = join(locked, ".spec-control");
  await mkdir(oldHome, { recursive: true });
  await writeFile(join(oldHome, "config.json"), "{}\n");
  await mkdir(locked);
  await chmod(locked, 0o500);
  cleanups.push(() => chmod(locked, 0o700));

  const names = ["SPEC_CONTROL_HOME", "OPENSPEC_DASHBOARD_HOME"] as const;
  const previous = names.map((n) => process.env[n]);
  for (const n of names) delete process.env[n];
  try {
    const outcome = await startHomeMigration(oldHome, newHome);
    expect(outcome.kind).toBe("refused");
    expect(dashboardHome()).toBe(oldHome);
  } finally {
    names.forEach((n, i) => {
      if (previous[i] !== undefined) process.env[n] = previous[i];
    });
  }
  expect(await readFile(join(oldHome, "config.json"), "utf8")).toBe("{}\n");
  expect(await exists(newHome)).toBe(false);
});

test("an explicit home is never migrated", async () => {
  const w = await world();
  const previous = process.env.SPEC_CONTROL_HOME;
  process.env.SPEC_CONTROL_HOME = join(w.root, "explicit");
  try {
    const before = await treeFingerprint(join(w.root, "home"));
    expect(await startHomeMigration(w.oldHome, w.newHome)).toEqual({ kind: "explicit" });
    expect(await treeFingerprint(join(w.root, "home"))).toBe(before);
  } finally {
    if (previous === undefined) delete process.env.SPEC_CONTROL_HOME;
    else process.env.SPEC_CONTROL_HOME = previous;
  }
});

test("a worktree whose repository is gone stays pending, is reported, and is repaired on a later start", async () => {
  const w = await world();
  const away = join(w.root, "moved-away");
  await rename(w.repo, away);

  const first = await migrateHome(w.oldHome, w.newHome);
  expect(first.kind).toBe("migrated");
  const moved = w.sessionWorktree.replace(w.oldHome, w.newHome);
  expect(first.kind === "migrated" && first.pending).toEqual([{ kind: "repair", worktree: moved, error: expect.any(String) }]);
  expect(await exists(moved)).toBe(true); // nothing deleted

  await rename(away, w.repo);
  expect(await migrateHome(w.oldHome, w.newHome)).toEqual({ kind: "retried", pending: [] });
  expect(await git(w.repo, "worktree", "list", "--porcelain")).toContain(`worktree ${moved}\n`);
  expect(JSON.parse(await readFile(join(w.newHome, MIGRATION_RECORD), "utf8")).pending).toEqual([]);
});

test("a pending worktree that was deleted meanwhile is dropped", async () => {
  const w = await world();
  const away = join(w.root, "moved-away");
  await rename(w.repo, away);
  await migrateHome(w.oldHome, w.newHome);
  await rm(w.sessionWorktree.replace(w.oldHome, w.newHome), { recursive: true, force: true });
  expect(await migrateHome(w.oldHome, w.newHome)).toEqual({ kind: "retried", pending: [] });
});

test("a start with nothing to migrate runs no git at all", async () => {
  const w = await world();
  await migrateHome(w.oldHome, w.newHome);
  // A `git` first on the PATH that only records that it ran.
  const bin = join(w.root, "bin");
  const log = join(w.root, "git-calls.log");
  await mkdir(bin);
  await writeFile(join(bin, "git"), `#!/bin/sh\necho "$@" >> ${log}\nexit 1\n`, { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  try {
    expect(await migrateHome(w.oldHome, w.newHome)).toEqual({ kind: "nothing" });
    await rm(join(w.newHome, MIGRATION_RECORD));
    expect(await migrateHome(w.oldHome, w.newHome)).toEqual({ kind: "nothing" });
  } finally {
    process.env.PATH = previous;
  }
  expect(await exists(log)).toBe(false);
});

test("hooks do not run for the repair of a moved session worktree", async () => {
  const w = await world();
  const log = await installRepoHooks(w.repo);
  const outcome = await migrateHome(w.oldHome, w.newHome);
  expect(outcome).toMatchObject({ kind: "migrated", pending: [] });
  expect(await git(w.repo, "worktree", "list", "--porcelain")).toContain(`worktree ${w.sessionWorktree.replace(w.oldHome, w.newHome)}\n`);
  expect(await hookLog(log)).toEqual([]);
});

// --- An interrupted migration (design D5): the record is written right after the rename and after every step. ---

/** Stops the migration at its `n`th record write, as a signal or a crash would: 0 is right after the rename. */
const stopAt = (n: number) => {
  let writes = 0;
  return {
    onRecorded: (_pending: readonly PendingStep[]) => {
      if (writes++ === n) throw new Error("stopped");
    },
  };
};

/** The finished state the first test checks: link, rewritten session record, repaired worktree record, no snapshot. */
async function expectFinished(w: Awaited<ReturnType<typeof world>>): Promise<void> {
  const moved = w.sessionWorktree.replace(w.oldHome, w.newHome);
  expect(await readlink(w.oldHome)).toBe(w.newHome);
  expect(JSON.parse(await readFile(join(w.newHome, "sessions", SESSION_A, "meta.json"), "utf8")).worktreePath).toBe(moved);
  expect(JSON.parse(await readFile(join(w.newHome, "config.json"), "utf8")).agentSessions.consoleFolder).toBe(w.consoleFolder.replace(w.oldHome, w.newHome));
  expect(await exists(join(w.newHome, "cache", "snapshot.json"))).toBe(false);
  const listed = await git(w.repo, "worktree", "list", "--porcelain");
  expect(listed).toContain(`worktree ${moved}\n`);
  expect(listed).not.toContain(w.sessionWorktree);
  expect(JSON.parse(await readFile(join(w.newHome, MIGRATION_RECORD), "utf8")).pending).toEqual([]);
}

test("stopped right after the rename: the record lists every step as not attempted, and the next start finishes the move", async () => {
  const w = await world();
  await expect(migrateHome(w.oldHome, w.newHome, stopAt(0))).rejects.toThrow("stopped");
  expect(await exists(w.oldHome)).toBe(false);
  const record = JSON.parse(await readFile(join(w.newHome, MIGRATION_RECORD), "utf8"));
  const moved = w.sessionWorktree.replace(w.oldHome, w.newHome);
  expect(record.pending.slice(0, 2)).toEqual([
    { kind: "link", error: NOT_YET_ATTEMPTED },
    { kind: "rewrite", file: join(w.newHome, "config.json"), error: NOT_YET_ATTEMPTED },
  ]);
  expect(record.pending).toHaveLength(7);
  expect(record.pending).toEqual(
    expect.arrayContaining([
      ...[SESSION_A, SESSION_B].map((id) => ({ kind: "rewrite", file: join(w.newHome, "sessions", id, "meta.json"), error: NOT_YET_ATTEMPTED })),
      { kind: "cache", error: NOT_YET_ATTEMPTED },
      ...[moved, join(w.newHome, "worktrees", "3d84480c2b4d", "stray")].map((worktree) => ({ kind: "repair", worktree, error: NOT_YET_ATTEMPTED })),
    ]),
  );

  const outcome = await migrateHome(w.oldHome, w.newHome);
  expect(outcome).toEqual({ kind: "retried", pending: [], resumed: { from: w.oldHome, to: w.newHome } });
  await expectFinished(w);
  expect(await migrateHome(w.oldHome, w.newHome)).toEqual({ kind: "nothing" });
});

test("stopped after the link: the next start does the rest and leaves the link as it was", async () => {
  const w = await world();
  await expect(migrateHome(w.oldHome, w.newHome, stopAt(1))).rejects.toThrow("stopped");
  expect(await readlink(w.oldHome)).toBe(w.newHome);
  const pending = JSON.parse(await readFile(join(w.newHome, MIGRATION_RECORD), "utf8")).pending as PendingStep[];
  expect(pending.map((p) => p.kind)).not.toContain("link");
  expect(pending.every((p) => p.error === NOT_YET_ATTEMPTED)).toBe(true);
  const link = await lstat(w.oldHome);

  expect((await migrateHome(w.oldHome, w.newHome)).kind).toBe("retried");
  await expectFinished(w);
  expect((await lstat(w.oldHome)).mtimeMs).toBe(link.mtimeMs);
});

test("every step listed as pending over a home where some already ran: the finished ones stay byte for byte, none is left", async () => {
  const w = await world();
  await expect(migrateHome(w.oldHome, w.newHome, stopAt(3))).rejects.toThrow("stopped"); // link, config.json and one session record done
  const moved = w.sessionWorktree.replace(w.oldHome, w.newHome);
  const gitdir = join(w.repo, ".git", "worktrees", "feat-x", "gitdir");
  // The whole list again, as if nothing had run: a record from the very first write.
  const record = JSON.parse(await readFile(join(w.newHome, MIGRATION_RECORD), "utf8"));
  const finishedSession = [SESSION_A, SESSION_B].find((id) => !record.pending.some((step: PendingStep) => step.kind === "rewrite" && step.file === join(w.newHome, "sessions", id, "meta.json")));
  expect(finishedSession).toBeDefined();
  const finishedSessionFile = join(w.newHome, "sessions", finishedSession as string, "meta.json");
  const all: PendingStep[] = [
    { kind: "link", error: NOT_YET_ATTEMPTED },
    { kind: "rewrite", file: join(w.newHome, "config.json"), error: NOT_YET_ATTEMPTED },
    ...[SESSION_A, SESSION_B].map((id): PendingStep => ({ kind: "rewrite", file: join(w.newHome, "sessions", id, "meta.json"), error: NOT_YET_ATTEMPTED })),
    { kind: "cache", error: NOT_YET_ATTEMPTED },
    { kind: "repair", worktree: moved, error: NOT_YET_ATTEMPTED },
  ];
  await writeFile(join(w.newHome, MIGRATION_RECORD), JSON.stringify({ ...record, pending: all }));
  const linkTarget = await readlink(w.oldHome);
  const config = await readFile(join(w.newHome, "config.json"), "utf8");
  const session = await readFile(finishedSessionFile, "utf8");

  expect(await migrateHome(w.oldHome, w.newHome)).toMatchObject({ kind: "retried", pending: [] });
  expect(await readlink(w.oldHome)).toBe(linkTarget);
  expect(await readFile(join(w.newHome, "config.json"), "utf8")).toBe(config);
  expect(await readFile(finishedSessionFile, "utf8")).toBe(session);
  await expectFinished(w);

  // Once more over the finished home: the repaired worktree record, too, is left byte for byte.
  // Everything but the record itself, which each start rewrites.
  const home = async () => (await treeFingerprint(w.newHome)).split("\n").filter((line) => !line.includes(MIGRATION_RECORD)).join("\n");
  const repaired = await readFile(gitdir, "utf8");
  const finished = await home();
  await writeFile(join(w.newHome, MIGRATION_RECORD), JSON.stringify({ ...record, pending: all }));
  expect(await migrateHome(w.oldHome, w.newHome)).toMatchObject({ kind: "retried", pending: [] });
  expect(await readFile(gitdir, "utf8")).toBe(repaired);
  expect(await home()).toBe(finished);
});

test("a resumed migration is said on start; one that is still not finished names what is left", () => {
  const resumed = { from: "/w/u/.openspec-dashboard", to: "/w/u/.spec-control" };
  expect(describeOutcome({ kind: "retried", pending: [], resumed })).toEqual(["finished moving /w/u/.openspec-dashboard to /w/u/.spec-control, which an earlier start was stopped in the middle of"]);
  expect(describeOutcome({ kind: "retried", pending: [] })).toEqual([]);
  expect(describeOutcome({ kind: "migrated", from: resumed.from, to: resumed.to, pending: [], recordError: "EROFS" })[1]).toContain("could not be written (EROFS)");
});
