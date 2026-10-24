import { afterAll, beforeAll, expect, test } from "bun:test";
import { appendFile, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import type { ParsedStatus } from "../src/server/git.ts";
import { MAX_INSPECTED_WORKTREES, PROMPT_LIMIT_BYTES, Scanner, scanLabels, scanRepo } from "../src/server/scanner.ts";
import { LocalRepoSource } from "../src/server/source.ts";
import type { Worktree } from "../src/shared/types.ts";
import { FIXTURES, gitIn, tempDir, treeFingerprint, useTempHome } from "./helpers.ts";

let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterAll(() => cleanup());

const nano = newRepoConfig(join(FIXTURES, "demo-ops"), true);
const soc = newRepoConfig(join(FIXTURES, "beta-soc"), true);

test("scans a fixture repo: artifacts, tasks, archive dates, columns", async () => {
  const snap = await scanRepo(nano);
  expect(snap.ok).toBe(true);
  const byName = new Map(snap.changes.map((c) => [c.name, c]));

  const aws = byName.get("cloud-deployment")!;
  expect(aws.artifacts.map((a) => a.id)).toEqual(["proposal", "specs", "design", "tasks"]);
  expect(aws.artifacts.every((a) => a.status === "done")).toBe(true);
  expect(aws.tasks?.total).toBeGreaterThan(0);
  expect(aws.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  const { done, total } = aws.tasks!;
  expect(aws.column).toBe(done === total ? "Done" : done > 0 ? "Implementing" : "Ready");

  const complete = byName.get("configurable-builder")!;
  expect(complete.tasks?.done).toBe(complete.tasks?.total);
  expect(complete.column).toBe("Done");

  // All three checkbox states end to end: `[~]` is counted in `total` and in `awaiting`, never in `done`.
  const awaiting = byName.get("verify-rollout")!;
  expect(awaiting.tasks).toEqual({ done: 3, awaiting: 2, total: 6 });
  expect(awaiting.column).toBe("Implementing");

  // Every task settled with two awaiting a person: the done column, sub-state `validate`.
  const validating = byName.get("confirm-retention")!;
  expect(validating.tasks).toEqual({ done: 4, awaiting: 2, total: 6 });
  expect([validating.column, validating.subState]).toEqual(["Done", "validate"]);
  expect(complete.subState).toBe("complete");

  const archived = byName.get("runbook-repo-field")!;
  expect(archived.archived).toBe("2026-06-18");
  expect(archived.created).toBe("2026-06-16");
  expect(archived.column).toBe("Archived");
  expect(archived.tasks?.done).toBe(archived.tasks?.total);
});

test("a change without a design is Ready: the spec-driven schema requires only tasks", async () => {
  const snap = await scanRepo(nano);
  const trim = snap.changes.find((c) => c.name === "trim-log-noise")!;
  expect(trim.artifacts.map((a) => [a.id, a.status, a.required])).toEqual([
    ["proposal", "done", false],
    ["specs", "done", false],
    ["design", "ready", false],
    ["tasks", "done", true],
  ]);
  expect(trim.tasks).toEqual({ done: 0, awaiting: 0, total: 3 });
  expect(trim.column).toBe("Ready");
  expect(trim.warnings ?? []).not.toContain("tasks file has no tasks");
});

test("all artifacts done with an empty tasks file lands in Ready with a warning", async () => {
  const root = await tempDir();
  const change = join(root, "openspec", "changes", "empty-tasks");
  await mkdir(join(change, "specs", "cap"), { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  await writeFile(join(change, ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-09-01\n");
  for (const f of ["proposal.md", "design.md"]) await writeFile(join(change, f), "# x\n");
  await writeFile(join(change, "specs", "cap", "spec.md"), "## ADDED Requirements\n");
  await writeFile(join(change, "tasks.md"), "## 1. Nothing\n\n(no tasks yet)\n");

  const snap = await scanRepo(newRepoConfig(root, true));
  const empty = snap.changes.find((c) => c.name === "empty-tasks")!;
  expect(empty.artifacts.every((a) => a.status === "done")).toBe(true);
  expect(empty.tasks).toEqual({ done: 0, awaiting: 0, total: 0 });
  expect(empty.column).toBe("Ready");
  expect(empty.warnings).toContain("tasks file has no tasks");
  expect(empty.created).toBe("2026-09-01");
  await rm(root, { recursive: true, force: true });
});

test("an empty tasks file without a design is Ready with the no-tasks warning", async () => {
  const root = await tempDir();
  const change = join(root, "openspec", "changes", "no-design");
  await mkdir(join(change, "specs", "cap"), { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  await writeFile(join(change, ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-09-01\n");
  await writeFile(join(change, "proposal.md"), "# x\n");
  await writeFile(join(change, "specs", "cap", "spec.md"), "## ADDED Requirements\n");
  await writeFile(join(change, "tasks.md"), "## 1. Nothing\n\n(no tasks yet)\n");

  const snap = await scanRepo(newRepoConfig(root, true));
  const noDesign = snap.changes.find((c) => c.name === "no-design")!;
  expect(noDesign.artifacts.find((a) => a.id === "design")?.status).not.toBe("done");
  expect(noDesign.column).toBe("Ready");
  expect(noDesign.warnings).toContain("tasks file has no tasks");
  await rm(root, { recursive: true, force: true });
});

test("skip_specs marks spec artifacts done; unknown schema is reported per change", async () => {
  const root = await tempDir();
  await mkdir(join(root, "openspec", "changes", "refactor"), { recursive: true });
  await mkdir(join(root, "openspec", "changes", "odd"), { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  await writeFile(join(root, "openspec", "changes", "refactor", ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-09-02\nskip_specs: true\n");
  await writeFile(join(root, "openspec", "changes", "refactor", "proposal.md"), "# p\n");
  await writeFile(join(root, "openspec", "changes", "odd", ".openspec.yaml"), "schema: my-custom\ncreated: 2026-09-03\n");

  const snap = await scanRepo(newRepoConfig(root, true));
  const refactor = snap.changes.find((c) => c.name === "refactor")!;
  expect(refactor.artifacts).toEqual([
    { id: "proposal", status: "done", required: false },
    { id: "specs", status: "done", required: false },
    { id: "design", status: "ready", required: false },
    { id: "tasks", status: "blocked", required: true },
  ]);
  // some artifacts written, not all
  expect(refactor.column).toBe("Drafts");

  const odd = snap.changes.find((c) => c.name === "odd")!;
  expect(odd.schema).toBe("my-custom");
  expect(odd.artifacts).toEqual([]);
  expect(odd.column).toBe("Unknown");
  expect(odd.warnings?.[0]).toMatch(/unknown schema 'my-custom'/);
  await rm(root, { recursive: true, force: true });
});

test("archived list is sorted newest first and archive count matches disk", async () => {
  const snap = await scanRepo(soc);
  const archived = snap.changes.filter((c) => c.archived);
  expect(archived.length).toBe(16);
  const dates = archived.map((c) => c.archived!);
  expect([...dates].sort().reverse()).toEqual(dates);
});

test("missing repo path yields ok:false without throwing", async () => {
  const snap = await scanRepo(newRepoConfig("/nonexistent/repo", true));
  expect(snap.ok).toBe(false);
  expect(snap.error).toMatch(/does not exist/);
});

test("unexpected change directory names are skipped with a warning", async () => {
  class Weird extends LocalRepoSource {
    override async listChanges(...args: Parameters<LocalRepoSource["listChanges"]>) {
      const listing = await super.listChanges(...args);
      return { ...listing, warnings: [...listing.warnings, 'skipped change directory with unexpected name: "foo;rm -rf"'] };
    }
  }
  const snap = await scanRepo(nano, new Weird(nano.path));
  expect(snap.warnings?.[0]).toContain("foo;rm -rf");
});

test("scanner isolates a failing repo and keeps its last good changes", async () => {
  const config = { ...defaultConfig(), repos: [nano, soc] };
  const scanner = new Scanner(() => config, { persist: false });
  await scanner.trigger().done;
  expect(scanner.snapshot.repos.map((r) => r.ok)).toEqual([true, true]);
  const socChanges = scanner.snapshot.repos[1].changes.length;

  const failing = new Scanner(() => config, {
    persist: false,
    sourceFor: (repo) => {
      const src = new LocalRepoSource(repo.path);
      if (repo.id === soc.id) src.listChanges = () => Promise.reject(new Error("disk on fire"));
      return src;
    },
  }, scanner.snapshot);
  const { started, done } = failing.trigger();
  expect(started).toBe(true);
  expect(failing.trigger().started).toBe(false);
  await done;
  const [n, b] = failing.snapshot.repos;
  expect(n.ok).toBe(true);
  expect(b.ok).toBe(false);
  expect(b.error).toBe("disk on fire");
  expect(b.changes.length).toBe(socChanges);
});

// --- Checkouts: real linked worktrees in temporary repositories, with a local bare repository as the "remote". ---

const CLEAN = { modified: 0, untracked: 0, conflicts: 0 };

/** A committed repository with an `openspec/` directory. Resolved path: macOS temp dirs sit behind a symlink, and git reports real paths. */
async function newGitRepo(prefix: string): Promise<{ base: string; repo: string }> {
  const base = await realpath(await tempDir(prefix));
  const repo = join(base, "alpha-infra");
  await mkdir(join(repo, "openspec", "changes"), { recursive: true });
  await writeFile(join(repo, "openspec", "config.yaml"), "schema: spec-driven\n");
  await writeFile(join(repo, "a.txt"), "a\n");
  await writeFile(join(repo, "b.txt"), "b\n");
  await gitIn(repo, "init", "-q");
  await gitIn(repo, "add", "-A");
  await gitIn(repo, "commit", "-q", "-m", "init");
  return { base, repo };
}

async function commits(cwd: string, n: number, label: string): Promise<void> {
  for (let i = 0; i < n; i++) {
    await appendFile(join(cwd, "a.txt"), `${label} ${i}\n`);
    await gitIn(cwd, "commit", "-q", "-am", `${label} ${i}`);
  }
}

let wt: { base: string; repo: string };
const wtPath = (name: string) => join(wt.base, "wt", name);
const scanWt = (source?: LocalRepoSource) => scanRepo(newRepoConfig(wt.repo, true), source);
const checkout = (list: Worktree[], name: string) => list.find((w) => w.path === wtPath(name))!;

beforeAll(async () => {
  wt = await newGitRepo("osd-checkouts-");
  const { base, repo } = wt;
  await gitIn(base, "init", "-q", "--bare", "remote.git");
  await gitIn(repo, "remote", "add", "origin", join(base, "remote.git"));
  await gitIn(repo, "push", "-q", "-u", "origin", "main");

  await gitIn(repo, "worktree", "add", "-q", wtPath("clean"), "-b", "feat/report");
  await gitIn(wtPath("clean"), "push", "-q", "-u", "origin", "feat/report");

  const dirty = wtPath("dirty");
  await gitIn(repo, "worktree", "add", "-q", dirty, "-b", "feat/dirty");
  await appendFile(join(dirty, "a.txt"), "edited\n");
  await writeFile(join(dirty, "secret-plan.md"), "staged\n");
  await gitIn(dirty, "add", "secret-plan.md");
  await gitIn(dirty, "mv", "b.txt", "c.txt");
  await mkdir(join(dirty, "scratch"));
  for (let i = 0; i < 40; i++) await writeFile(join(dirty, "scratch", `note-${i}.md`), "x\n");

  // 5 commits pushed and then dropped locally, 2 new local ones: ahead 2, behind 5.
  const diverged = wtPath("diverged");
  await gitIn(repo, "worktree", "add", "-q", diverged, "-b", "feat/diverged");
  await commits(diverged, 5, "upstream");
  await gitIn(diverged, "push", "-q", "-u", "origin", "feat/diverged");
  await gitIn(diverged, "reset", "-q", "--hard", "HEAD~5");
  await commits(diverged, 2, "local");

  await gitIn(repo, "worktree", "add", "-q", wtPath("never-pushed"), "-b", "feat/never-pushed");
  await commits(wtPath("never-pushed"), 3, "unpushed");

  await gitIn(repo, "worktree", "add", "-q", "--detach", wtPath("detached"));
  await commits(wtPath("detached"), 1, "detached");

  const unborn = wtPath("unborn");
  await gitIn(repo, "worktree", "add", "-q", "--detach", unborn);
  await gitIn(unborn, "checkout", "-q", "--orphan", "feat/unborn");
  await gitIn(unborn, "rm", "-rfq", ".");
  await writeFile(join(unborn, "one.md"), "1\n");
  await writeFile(join(unborn, "two.md"), "2\n");

  await gitIn(repo, "worktree", "add", "-q", wtPath("held"), "-b", "fix/held");
  await gitIn(repo, "worktree", "lock", "--reason", "in use", wtPath("held"));

  await gitIn(repo, "worktree", "add", "-q", wtPath("gone"), "-b", "feat/gone");
  await rm(wtPath("gone"), { recursive: true, force: true });
});
afterAll(() => rm(wt.base, { recursive: true, force: true }));

test("checkouts: the main checkout is recorded but not counted as a worktree", async () => {
  const snap = await scanWt();
  expect(snap.ok).toBe(true);
  expect(snap.worktrees.length).toBe(9);
  expect(snap.worktrees.filter((w) => w.isMain).map((w) => w.path)).toEqual([wt.repo]);
  expect(snap.worktrees[0]).toMatchObject({ isMain: true, branch: "main", status: { ...CLEAN, upstream: "origin/main", ahead: 0, behind: 0 }, unpushed: 0 });
  expect(snap.workInProgress).toEqual({ worktrees: 8, uncommitted: 2, unpushed: 3, stale: 1, unknown: 0 });
});

test("checkouts: clean, uncommitted, ahead and behind", async () => {
  const { worktrees } = await scanWt();
  const clean = checkout(worktrees, "clean");
  expect(clean.status).toEqual({ ...CLEAN, upstream: "origin/feat/report", ahead: 0, behind: 0 });
  expect(clean.unpushed).toBe(0);

  // Edited + staged + renamed; the untracked directory of 40 files is one item.
  const dirty = checkout(worktrees, "dirty");
  expect(dirty.status).toMatchObject({ modified: 3, untracked: 1 });

  const diverged = checkout(worktrees, "diverged");
  expect(diverged.status).toMatchObject({ upstream: "origin/feat/diverged", ahead: 2, behind: 5 });
  expect(diverged.unpushed).toBe(2);
});

test("checkouts: never-pushed branch, detached HEAD and unborn branch", async () => {
  const snap = await scanWt();
  const never = checkout(snap.worktrees, "never-pushed");
  expect(never.status).toEqual(CLEAN);
  expect(never.unpushed).toBe(3);

  const detached = checkout(snap.worktrees, "detached");
  expect(detached).toMatchObject({ detached: true, unpushed: 1 });
  expect(detached.branch).toBeUndefined();
  expect(detached.head).toMatch(/^[0-9a-f]{7}$/);

  const unborn = checkout(snap.worktrees, "unborn");
  expect(unborn.status).toEqual({ ...CLEAN, untracked: 2 });
  expect(unborn.unpushed).toBe(0);
  expect(snap.ok).toBe(true);
});

test("checkouts: a removed directory is prunable and never inspected; a locked worktree is flagged", async () => {
  const inspected: string[] = [];
  class Recording extends LocalRepoSource {
    override checkoutStatus(path: string) {
      inspected.push(path);
      return super.checkoutStatus(path);
    }
    override localOnlyCommits(path: string) {
      inspected.push(path);
      return super.localOnlyCommits(path);
    }
  }
  const snap = await scanWt(new Recording(wt.repo));
  const gone = checkout(snap.worktrees, "gone");
  expect(snap.ok).toBe(true);
  expect(gone).toMatchObject({ prunable: true, branch: "feat/gone" });
  expect(gone.status).toBeUndefined();
  expect(gone.unpushed).toBeUndefined();
  expect(inspected).not.toContain(wtPath("gone"));
  expect(inspected).toContain(wtPath("held"));
  expect(checkout(snap.worktrees, "held")).toMatchObject({ locked: true, lockReason: "in use", status: CLEAN });
});

test("checkouts: detached and branchless entries are ignored by branch matching", async () => {
  await mkdir(join(wt.repo, "openspec", "changes", "never-pushed"), { recursive: true });
  await mkdir(join(wt.repo, "openspec", "changes", "detached"), { recursive: true });
  const snap = await scanWt();
  await rm(join(wt.repo, "openspec", "changes"), { recursive: true, force: true });
  await mkdir(join(wt.repo, "openspec", "changes"));
  expect(snap.changes.find((c) => c.name === "never-pushed")?.branchMatch).toBe("feat/never-pushed");
  expect(snap.changes.find((c) => c.name === "detached")?.branchMatch).toBeUndefined();
});

test("checkouts: a failing status leaves that worktree unknown and the others intact", async () => {
  class OneFails extends LocalRepoSource {
    override checkoutStatus(path: string): Promise<ParsedStatus | undefined> {
      if (path === wtPath("clean")) return Promise.resolve(undefined); // what a failed or timed-out command resolves to
      if (path === wtPath("held")) return Promise.reject(new Error("boom"));
      return super.checkoutStatus(path);
    }
  }
  const snap = await scanWt(new OneFails(wt.repo));
  expect(snap.ok).toBe(true);
  expect(checkout(snap.worktrees, "clean").status).toBe("unknown");
  expect(checkout(snap.worktrees, "held").status).toBe("unknown");
  expect(checkout(snap.worktrees, "diverged").unpushed).toBe(2);
  expect(snap.worktrees[0].status).toMatchObject(CLEAN);
  expect(snap.workInProgress).toMatchObject({ unknown: 2, uncommitted: 2 });
});

test("checkouts: a failed scan keeps the previous checkouts and summary", async () => {
  const config = { ...defaultConfig(), repos: [newRepoConfig(wt.repo, true)] };
  let fail = false;
  class Flaky extends LocalRepoSource {
    override listChanges(...args: Parameters<LocalRepoSource["listChanges"]>) {
      return fail ? Promise.reject(new Error("boom")) : super.listChanges(...args);
    }
  }
  const scanner = new Scanner(() => config, { persist: false, sourceFor: (r) => new Flaky(r.path) });
  const good = (await scanner.trigger().done).repos[0];
  fail = true;
  const bad = (await scanner.trigger().done).repos[0];
  expect(bad.ok).toBe(false);
  expect(bad.worktrees).toEqual(good.worktrees);
  expect(checkout(bad.worktrees, "dirty").status).toMatchObject({ modified: 3 });
  expect(bad.workInProgress).toEqual(good.workInProgress!);
});

test("checkouts: without remote-tracking refs nothing reports an unpushed count", async () => {
  const { base, repo } = await newGitRepo("osd-noremote-");
  await gitIn(repo, "worktree", "add", "-q", join(base, "wt"), "-b", "feat/local");
  await commits(join(base, "wt"), 2, "local");
  const snap = await scanRepo(newRepoConfig(repo, true));
  expect(snap.worktrees.map((w) => w.status)).toEqual([CLEAN, CLEAN]);
  expect(snap.worktrees.every((w) => w.unpushed === undefined)).toBe(true);
  expect(snap.workInProgress).toEqual({ worktrees: 1, uncommitted: 0, unpushed: 0, stale: 0, unknown: 0 });
  await rm(base, { recursive: true, force: true });
});

test("checkouts: above the cap the rest are listed without a status", async () => {
  const { base, repo } = await newGitRepo("osd-cap-");
  for (let i = 0; i < 15; i++) await gitIn(repo, "worktree", "add", "-q", join(base, "wt", `w${i}`), "-b", `feat/w${i}`);
  const snap = await scanRepo(newRepoConfig(repo, true));
  const linked = snap.worktrees.filter((w) => !w.isMain);
  expect(linked.length).toBe(15);
  expect(linked.filter((w) => typeof w.status === "object").length).toBe(MAX_INSPECTED_WORKTREES);
  const skipped = linked.filter((w) => w.inspected === false);
  expect(skipped.length).toBe(3);
  expect(skipped.every((w) => w.status === undefined)).toBe(true);
  expect(snap.worktrees[0].status).toEqual(CLEAN);
  expect(snap.workInProgress).toEqual({ worktrees: 15, uncommitted: 0, unpushed: 0, stale: 0, unknown: 0 });
  await rm(base, { recursive: true, force: true });
});

test("checkouts: a non-git repository reports none and no summary", async () => {
  class NotGit extends LocalRepoSource {
    override isGit() {
      return Promise.resolve(false);
    }
  }
  const snap = await scanRepo(newRepoConfig(wt.repo, true), new NotGit(wt.repo));
  expect(snap.ok).toBe(true);
  expect(snap.worktrees).toEqual([]);
  expect(snap.workInProgress).toBeUndefined();
});

test("scanner reports prompt.md: absent, small, oversized, and does not affect artifact status", async () => {
  const root = await tempDir();
  const changeRoot = join(root, "openspec", "changes");
  await mkdir(changeRoot, { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");

  await mkdir(join(changeRoot, "no-prompt"), { recursive: true });
  await writeFile(join(changeRoot, "no-prompt", ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-09-01\n");

  await mkdir(join(changeRoot, "with-prompt"), { recursive: true });
  await writeFile(join(changeRoot, "with-prompt", ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-09-02\n");
  await writeFile(join(changeRoot, "with-prompt", "prompt.md"), "# Prompt\n\nLog every mutation\n");

  await mkdir(join(changeRoot, "oversized"), { recursive: true });
  await writeFile(join(changeRoot, "oversized", ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-09-03\n");
  await writeFile(join(changeRoot, "oversized", "prompt.md"), "a".repeat(PROMPT_LIMIT_BYTES + 100));

  const snap = await scanRepo(newRepoConfig(root, true));
  const byName = new Map(snap.changes.map((c) => [c.name, c]));

  const noPrompt = byName.get("no-prompt")!;
  expect(noPrompt.prompt).toBeUndefined();
  // Artifact status unchanged by the prompt logic — no artifact done ⇒ "Backlog".
  expect(noPrompt.column).toBe("Backlog");

  const withPrompt = byName.get("with-prompt")!;
  expect(withPrompt.prompt).toBe("# Prompt\n\nLog every mutation\n");
  expect(withPrompt.column).toBe("Backlog");

  const oversized = byName.get("oversized")!;
  expect(oversized.prompt?.length).toBe(PROMPT_LIMIT_BYTES);
  expect(oversized.warnings?.some((w) => w.includes("larger than"))).toBe(true);

  await rm(root, { recursive: true, force: true });
});

// --- Detected labels: marker files written into temporary repositories, never into the shared fixtures. ---

async function labelledRepo(files: string[], git: boolean): Promise<string> {
  const repo = join(await realpath(await tempDir("osd-labels-")), "demo-ops");
  await mkdir(join(repo, "openspec", "changes"), { recursive: true });
  for (const file of files) {
    await mkdir(join(repo, file, ".."), { recursive: true });
    await writeFile(join(repo, file), "");
  }
  if (git) {
    await gitIn(repo, "init", "-q");
    await gitIn(repo, "add", "-A");
    await gitIn(repo, "commit", "-q", "-m", "init");
  }
  return repo;
}

test("labels: markers at the top and one level down are detected, deeper and skipped folders are not", async () => {
  const repo = await labelledRepo(["main.tf", "service/go.mod", "deploy/env/prod/Cargo.toml", "node_modules/lib/Gemfile", ".github/Dockerfile", "openspec/Chart.yaml"], true);
  const before = await treeFingerprint(repo);
  const snap = await scanRepo(newRepoConfig(repo, true));
  expect(snap.detectedLabels).toEqual([
    { label: "go", marker: "`go.mod`" },
    { label: "terraform", marker: "`.tf` files" },
  ]);
  expect(await treeFingerprint(repo)).toBe(before);
});

test("labels: a non-git folder is detected the same way, and a symbolic link is not followed", async () => {
  const repo = await labelledRepo(["package.json", "tsconfig.json"], false);
  const elsewhere = await labelledRepo(["go.mod"], false);
  await symlink(elsewhere, join(repo, "linked"));
  await symlink(join(elsewhere, "go.mod"), join(repo, "go.mod"));
  const snap = await scanRepo(newRepoConfig(repo, true));
  expect(snap.isGit).toBe(false);
  expect(snap.detectedLabels?.map((d) => d.label)).toEqual(["javascript", "typescript"]);
});

test("labels: detection only lists directories and follows the repository", async () => {
  const repo = await labelledRepo(["Gemfile"], false);
  const listed: string[] = [];
  const source = new LocalRepoSource(repo);
  const onlyListing = { listEntries: (dir: string) => (listed.push(dir), source.listEntries(dir)) };
  expect((await scanLabels(onlyListing, repo)).map((d) => d.label)).toEqual(["ruby"]);
  expect(listed).toEqual([repo]); // `openspec/` is skipped
  await writeFile(join(repo, "Dockerfile"), "");
  expect((await scanRepo(newRepoConfig(repo, true))).detectedLabels?.map((d) => d.label)).toEqual(["docker", "ruby"]);
});

test("labels: a failed scan has none", async () => {
  const snap = await scanRepo(newRepoConfig("/w/acme/does-not-exist", true));
  expect(snap.ok).toBe(false);
  expect(snap.detectedLabels).toBeUndefined();
});

// --- Change dependencies: generated into temporary repositories, never into the shared fixtures. ---

async function writeChange(changeRoot: string, dir: string, dependsOn?: string, extra: Record<string, string> = {}): Promise<void> {
  await mkdir(join(changeRoot, dir), { recursive: true });
  await writeFile(join(changeRoot, dir, ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-09-01\n");
  if (dependsOn !== undefined) await writeFile(join(changeRoot, dir, "depends-on.yaml"), dependsOn);
  for (const [file, text] of Object.entries(extra)) await writeFile(join(changeRoot, dir, file), text);
}

test("dependencies: states, blocked, required-by and warnings, read without writing", async () => {
  const root = await tempDir();
  const changeRoot = join(root, "openspec", "changes");
  await mkdir(join(changeRoot, "archive"), { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  await writeChange(changeRoot, "archive/2026-09-30-add-billing-schema", "depends_on: [add-billing-api]\n");
  await writeChange(changeRoot, "add-billing-api", "depends_on:\n  - add-billing-schema\n");
  await writeChange(changeRoot, "add-billing-ui", "# waits for the API\ndepends_on: [add-billing-api, add-billing-scheme, add-billing-api]\n");
  await writeChange(changeRoot, "alpha", "depends_on: [beta]\n");
  await writeChange(changeRoot, "beta", "depends_on: [alpha]\n");
  await writeChange(changeRoot, "malformed", "depends_on: [unclosed\n");
  await writeChange(changeRoot, "wrong-shape", "depends_on: add-billing-api\n");
  await writeChange(changeRoot, "odd-names", "depends_on: [add-billing-api, ../etc]\n");
  await writeChange(changeRoot, "empty-list", "depends_on: []\n");
  await writeChange(changeRoot, "plain");
  const before = await treeFingerprint(root);

  const snap = await scanRepo(newRepoConfig(root, true));
  const byName = new Map(snap.changes.map((c) => [c.archived ? `archived:${c.name}` : c.name, c]));
  const get = (name: string) => byName.get(name)!;

  expect(get("add-billing-api").dependsOn).toEqual([{ name: "add-billing-schema", state: "met" }]);
  expect(get("add-billing-api").blocked).toBeUndefined();
  expect(get("add-billing-api").requiredBy).toEqual(["add-billing-ui", "odd-names"]);
  expect(get("add-billing-ui").dependsOn).toEqual([
    { name: "add-billing-api", state: "waiting" },
    { name: "add-billing-scheme", state: "missing" },
  ]);
  expect(get("add-billing-ui").blocked).toBe(true);
  expect(get("add-billing-ui").warnings).toContain('depends on "add-billing-scheme", but no change of that name exists');
  // The file is not an artifact: the change is still in the backlog.
  expect(get("add-billing-ui").column).toBe("Backlog");
  expect(get("alpha").dependsOn).toEqual([{ name: "beta", state: "cycle" }]);
  expect(get("beta").warnings).toContain("dependency cycle: beta → alpha → beta");
  expect(get("malformed").blocked).toBe(true);
  expect(get("malformed").dependsOn).toBeUndefined();
  expect(get("malformed").warnings?.some((w) => w.includes("depends-on.yaml is not valid YAML"))).toBe(true);
  expect(get("wrong-shape").blocked).toBe(true);
  expect(get("odd-names").dependsOn).toEqual([{ name: "add-billing-api", state: "waiting" }]);
  expect(get("odd-names").warnings).toContain('depends-on.yaml: ignored "../etc", which is not a valid change name');
  for (const name of ["empty-list", "plain"]) {
    expect(get(name).dependsOn).toBeUndefined();
    expect(get(name).blocked).toBeUndefined();
    expect(get(name).requiredBy).toBeUndefined();
  }
  // An archived change is never blocked, whatever its file says.
  expect(get("archived:add-billing-schema").blocked).toBeUndefined();
  expect(get("archived:add-billing-schema").dependsOn).toBeUndefined();
  expect(get("archived:add-billing-schema").requiredBy).toEqual(["add-billing-api"]);

  expect(await treeFingerprint(root)).toBe(before);
  await rm(root, { recursive: true, force: true });
});

test("dependencies: the leading copy declares, and the archive reaching the main checkout unblocks", async () => {
  const { base, repo } = await newGitRepo("osd-deps-");
  const changeRoot = join(repo, "openspec", "changes");
  await writeChange(changeRoot, "add-billing-schema");
  await writeChange(changeRoot, "add-billing-ui");
  await gitIn(repo, "add", "-A");
  await gitIn(repo, "commit", "-q", "-m", "changes");

  // The UI change progresses on a branch and declares its dependency there only.
  const ui = join(base, "wt", "ui");
  await gitIn(repo, "worktree", "add", "-q", ui, "-b", "feat/add-billing-ui");
  await writeChange(join(ui, "openspec", "changes"), "add-billing-ui", "depends_on: [add-billing-schema]\n", { "proposal.md": "# Proposal\n\n## Why\n\nBecause.\n" });
  // The schema change is archived on its own branch first.
  const schema = join(base, "wt", "schema");
  await gitIn(repo, "worktree", "add", "-q", schema, "-b", "chore/archive-add-billing-schema");
  await mkdir(join(schema, "openspec", "changes", "archive"), { recursive: true });
  await gitIn(schema, "mv", "openspec/changes/add-billing-schema", "openspec/changes/archive/2026-10-01-add-billing-schema");
  await gitIn(schema, "commit", "-q", "-m", "archive");

  let snap = await scanRepo(newRepoConfig(repo, true));
  let uiChange = snap.changes.find((c) => c.name === "add-billing-ui")!;
  expect(uiChange.checkout?.isMain).toBe(false);
  expect(uiChange.dependsOn).toEqual([{ name: "add-billing-schema", state: "waiting" }]);
  expect(uiChange.blocked).toBe(true);

  // The archive is merged and pulled into the main checkout: the next scan unblocks, nothing to do for the user.
  await gitIn(repo, "merge", "-q", "--ff-only", "chore/archive-add-billing-schema");
  snap = await scanRepo(newRepoConfig(repo, true));
  uiChange = snap.changes.find((c) => c.name === "add-billing-ui")!;
  expect(uiChange.dependsOn).toEqual([{ name: "add-billing-schema", state: "met" }]);
  expect(uiChange.blocked).toBeUndefined();
});

// --- A git repository with nothing to branch a session from. ---

test("a git repository with no commit reports noCommit until its first commit", async () => {
  const base = await tempDir("osd-nocommit-");
  const repo = join(base, "fresh-app");
  await mkdir(join(repo, "openspec", "changes", "first-feature"), { recursive: true });
  await writeFile(join(repo, "openspec", "config.yaml"), "schema: spec-driven\n");
  await gitIn(repo, "init", "-q");
  const before = await scanRepo(newRepoConfig(repo, true));
  expect(before.ok).toBe(true);
  expect(before.isGit).toBe(true);
  expect(before.noCommit).toBe(true);

  await gitIn(repo, "add", "-A");
  await gitIn(repo, "commit", "-q", "-m", "init");
  const after = await scanRepo(newRepoConfig(repo, true));
  expect(after.ok).toBe(true);
  expect("noCommit" in after).toBe(false);
  await rm(base, { recursive: true, force: true });
});

test("a folder without git carries no noCommit", async () => {
  const base = await tempDir("osd-nogit-");
  const repo = join(base, "plain");
  await mkdir(join(repo, "openspec", "changes"), { recursive: true });
  await writeFile(join(repo, "openspec", "config.yaml"), "schema: spec-driven\n");
  const snapshot = await scanRepo(newRepoConfig(repo, true));
  expect(snapshot.isGit).toBe(false);
  expect("noCommit" in snapshot).toBe(false);
  await rm(base, { recursive: true, force: true });
});

// --- Source issues: `issue.yaml`, generated into a temporary repository. ---

test("issue.yaml: read for active and archived changes, malformed or linked files ignored, never an artifact", async () => {
  const root = await tempDir();
  const changeRoot = join(root, "openspec", "changes");
  await mkdir(join(changeRoot, "archive"), { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  const valid = "# The GitHub issue this change was imported from (spec-control).\ngithub: acme/alpha-infra\nnumber: 42\ntitle: Retry webhook delivery\n";
  await writeChange(changeRoot, "retry-webhooks", undefined, { "issue.yaml": valid, "prompt.md": "# Prompt\n\nRetry\n" });
  await writeChange(changeRoot, "archive/2026-09-30-old-import", undefined, { "issue.yaml": "github: acme/alpha-infra\nnumber: 7\n" });
  await writeChange(changeRoot, "negative", undefined, { "issue.yaml": "github: acme/alpha-infra\nnumber: -3\n" });
  await writeChange(changeRoot, "not-yaml", undefined, { "issue.yaml": "github: [unclosed\n" });
  await writeChange(changeRoot, "bad-repo", undefined, { "issue.yaml": "github: ../../etc\nnumber: 1\n" });
  await writeChange(changeRoot, "url-ignored", undefined, { "issue.yaml": "github: acme/alpha-infra\nnumber: 5\nurl: https://evil.example.test/\n" });
  await writeChange(changeRoot, "oversized", undefined, { "issue.yaml": `github: acme/alpha-infra\nnumber: 1\ntitle: ${"x".repeat(17_000)}\n` });
  await writeChange(changeRoot, "linked");
  await writeFile(join(root, "elsewhere.yaml"), valid);
  await symlink(join(root, "elsewhere.yaml"), join(changeRoot, "linked", "issue.yaml"));
  await writeChange(changeRoot, "plain", undefined, { "prompt.md": "# Prompt\n\nRetry\n" });
  const before = await treeFingerprint(root);

  const snap = await scanRepo(newRepoConfig(root, true));
  expect(snap.ok).toBe(true);
  const get = (name: string) => snap.changes.find((c) => c.name === name)!;
  expect(get("retry-webhooks").sourceIssue).toEqual({ github: "acme/alpha-infra", number: 42, title: "Retry webhook delivery" });
  expect(get("old-import").archived).toBeDefined();
  expect(get("old-import").sourceIssue).toEqual({ github: "acme/alpha-infra", number: 7 });
  expect(get("url-ignored").sourceIssue).toEqual({ github: "acme/alpha-infra", number: 5 });
  for (const name of ["negative", "not-yaml", "bad-repo", "oversized", "linked", "plain"]) expect([name, get(name).sourceIssue]).toEqual([name, undefined]);
  expect(get("negative").warnings?.some((w) => w.includes("issue.yaml"))).toBe(true);
  // Not an artifact: same column and artifacts as the same change without the file.
  expect(get("retry-webhooks").column).toBe(get("plain").column);
  expect(get("retry-webhooks").artifacts).toEqual(get("plain").artifacts);
  expect(await treeFingerprint(root)).toEqual(before);
});

/** A repository whose changes carry records, with worktrees on a sibling change's branch and on a recorded branch. */
async function recordRepo(): Promise<{ root: string; repo: string; worktree: (branch: string) => Promise<string> }> {
  const root = await tempDir();
  const repo = join(root, "alpha-infra");
  const marker = (extra = "") => `schema: spec-driven\ncreated: 2026-10-20\n${extra}`;
  const files: Record<string, string> = {
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec/changes/add-validate/.openspec.yaml": marker(),
    "openspec/changes/add-validate/proposal.md": "# Proposal\n",
    "openspec/changes/rotate-keys/.openspec.yaml": marker("spec-control:\n  branch: fix/rotate-keys\n"),
    "openspec/changes/rotate-keys/proposal.md": "# Proposal\n",
    "openspec/changes/archive/2026-10-20-trim-logs/.openspec.yaml": marker("spec-control:\n  branch: feat/trim-logs\n  archive-branch: chore/archive-trim-logs\n"),
    "openspec/changes/archive/2026-10-20-trim-logs/proposal.md": "# Proposal\n",
  };
  for (const [path, text] of Object.entries(files)) await Bun.write(join(repo, path), text);
  await gitIn(repo, "init", "-q");
  await gitIn(repo, "add", "-A");
  await gitIn(repo, "commit", "-qm", "init");
  const worktree = async (branch: string) => {
    const path = join(root, branch.replaceAll("/", "-"));
    await gitIn(repo, "worktree", "add", "-q", "-b", branch, path);
    return path;
  };
  return { root, repo, worktree };
}

test("records: active and archived changes report what their .openspec.yaml records", async () => {
  const { root, repo } = await recordRepo();
  try {
    const snap = await scanRepo(newRepoConfig(repo, true));
    const byName = new Map(snap.changes.map((c) => [c.name, c]));
    expect(byName.get("rotate-keys")?.recorded).toEqual({ branch: "fix/rotate-keys" });
    expect(byName.get("trim-logs")?.recorded).toEqual({ branch: "feat/trim-logs", archiveBranch: "chore/archive-trim-logs" });
    expect(byName.get("add-validate")?.recorded).toBeUndefined();
    expect(byName.get("rotate-keys")?.warnings).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("branch matching: exact candidates only — no sibling branch, no containing name; recorded and session branches match", async () => {
  const { root, repo, worktree } = await recordRepo();
  try {
    await worktree("feat/add-validate-phase");
    await worktree("fix/rotate-keys");
    const snap = await scanRepo(newRepoConfig(repo, true));
    const byName = new Map(snap.changes.map((c) => [c.name, c]));
    // Both changes lead from the main checkout: every worktree only carries main's copy along.
    expect(byName.get("add-validate")?.checkout?.isMain).toBe(true);
    expect(byName.get("add-validate")?.branchMatch).toBeUndefined();
    expect(byName.get("rotate-keys")?.branchMatch).toBe("fix/rotate-keys");
    expect(byName.get("trim-logs")?.branchMatch).toBeUndefined();

    await gitIn(repo, "checkout", "-q", "-b", "wip/add-validate-tweaks");
    const tweaks = await scanRepo(newRepoConfig(repo, true));
    expect(tweaks.changes.find((c) => c.name === "add-validate")?.branchMatch).toBeUndefined();

    await gitIn(repo, "checkout", "-q", "-b", "feat/add-validate");
    const session = await scanRepo(newRepoConfig(repo, true));
    expect(session.changes.find((c) => c.name === "add-validate")?.branchMatch).toBe("feat/add-validate");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("branch matching: a change that leads from a linked worktree keeps that worktree's branch, whatever its name", async () => {
  const { root, repo, worktree } = await recordRepo();
  try {
    const path = await worktree("wip/compliance");
    await Bun.write(join(path, "openspec/changes/audit-trail/.openspec.yaml"), "schema: spec-driven\ncreated: 2026-10-21\n");
    await Bun.write(join(path, "openspec/changes/audit-trail/proposal.md"), "# Proposal\n");
    const snap = await scanRepo(newRepoConfig(repo, true));
    expect(snap.changes.find((c) => c.name === "audit-trail")?.branchMatch).toBe("wip/compliance");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
