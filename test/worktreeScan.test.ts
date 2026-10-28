import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { newRepoConfig } from "../src/server/config.ts";
import { discoverRepos } from "../src/server/discover.ts";
import { scanRepo, WORKTREE_LIMIT } from "../src/server/scanner.ts";
import { LocalRepoSource, type RepoSource } from "../src/server/source.ts";
import type { RepoSnapshot } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";

const COMMIT_DATE = "2026-03-01T10:00:00+01:00";
const at = (iso: string | undefined) => Date.parse(iso ?? "");

let cleanup: () => Promise<void>;
const temps: string[] = [];
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterAll(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
  await cleanup();
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_AUTHOR_DATE: COMMIT_DATE, GIT_COMMITTER_DATE: COMMIT_DATE },
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")}: ${await new Response(proc.stderr).text()}`);
  return out;
}

interface ChangeSpec {
  artifacts?: ("proposal" | "design" | "specs" | "tasks")[];
  tasks?: string;
  created?: string;
  delta?: string;
}

/** Writes a spec-driven change directory with the given artifacts present. */
async function writeChange(root: string, name: string, { artifacts = ["proposal"], tasks = "- [ ] 1.1 a\n- [ ] 1.2 b\n", created = "2026-02-01", delta }: ChangeSpec = {}): Promise<string> {
  const dir = join(root, "openspec", "changes", name);
  await mkdir(join(dir, "specs", "auth"), { recursive: true });
  await writeFile(join(dir, ".openspec.yaml"), `schema: spec-driven\ncreated: ${created}\n`);
  if (artifacts.includes("proposal")) await writeFile(join(dir, "proposal.md"), "# p\n");
  if (artifacts.includes("design")) await writeFile(join(dir, "design.md"), "# d\n");
  if (artifacts.includes("specs")) await writeFile(join(dir, "specs", "auth", "spec.md"), delta ?? "## ADDED Requirements\n\n### Requirement: Two-factor\nSHALL 2FA.\n\n#### Scenario: works\n- **WHEN** x\n- **THEN** y\n");
  if (artifacts.includes("tasks")) await writeFile(join(dir, "tasks.md"), tasks);
  return dir;
}

/** A committed repository with `openspec/` and a main spec; returns its root (inside a temp dir registered for clean-up). */
async function repo(): Promise<string> {
  const base = await tempDir("osd-wt-");
  temps.push(base);
  const root = join(base, "alpha-infra");
  await mkdir(join(root, "openspec", "specs", "auth"), { recursive: true });
  await mkdir(join(root, "openspec", "changes"), { recursive: true });
  await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  await writeFile(join(root, "openspec", "specs", "auth", "spec.md"), "# auth\n\n## Purpose\nx\n\n## Requirements\n\n### Requirement: Login\nUsers SHALL log in.\n\n#### Scenario: works\n- **WHEN** x\n- **THEN** y\n");
  await writeFile(join(root, "openspec", "changes", ".gitkeep"), "");
  await git(root, "init", "-q");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "init");
  return root;
}

async function worktree(root: string, path: string, branch?: string): Promise<string> {
  await git(root, "worktree", "add", "-q", ...(branch ? ["-b", branch] : ["--detach"]), path);
  // git reports resolved paths (/private/var on macOS); use what git says so comparisons are exact
  const listed = (await git(root, "worktree", "list", "--porcelain")).split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
  return listed.find((p) => p.endsWith(path.split("/").slice(-2).join("/"))) ?? path;
}

/** Sets the mtime of a directory tree, files and directories alike. */
async function backdate(dir: string, when: Date): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await backdate(p, when);
    else await utimes(p, when, when);
  }
  await utimes(dir, when, when);
}

const ALL = ["proposal", "design", "specs", "tasks"] as const;
const byName = (snap: RepoSnapshot, name: string) => snap.changes.filter((c) => c.name === name);
const scan = (root: string, source?: RepoSource) => scanRepo(newRepoConfig(root, true), source);

test("a change that exists only, uncommitted, in a worktree is on the board with that worktree's progress and branch", async () => {
  const root = await repo();
  const wt = await worktree(root, join(root, ".claude", "worktrees", "audit"), "wip/compliance");
  const dir = await writeChange(wt, "audit-trail", { artifacts: [...ALL], tasks: "- [x] 1.1 a\n- [ ] 1.2 b\n- [ ] 1.3 c\n" });
  // Backdate everything, then move one file: the expectation must not depend on when the test runs.
  await backdate(dir, new Date("2026-09-01T00:00:00Z"));
  const mtime = new Date("2026-09-10T08:00:00Z");
  await utimes(join(dir, "tasks.md"), mtime, mtime);

  const snap = await scan(root);
  expect([snap.ok, snap.warnings]).toEqual([true, undefined]);
  const [change, ...rest] = byName(snap, "audit-trail");
  expect(rest).toEqual([]);
  expect([change.column, change.tasks, change.branchMatch]).toEqual(["Implementing", { done: 1, awaiting: 0, total: 3 }, "wip/compliance"]);
  expect(change.checkout).toEqual({ path: wt, branch: "wip/compliance", isMain: false });
  expect(change.otherCheckouts).toBeUndefined();
  // untracked files count: the change's time, and the repository's, is that edit — not the old commit
  expect(at(change.lastActivityAt)).toBe(mtime.getTime());
  expect(at(snap.lastUpdatedAt)).toBe(mtime.getTime());
});

test("copies are merged: further along in a worktree leads; a stale worktree copy does not", async () => {
  const root = await repo();
  await writeChange(root, "audit-trail");
  await writeChange(root, "upgrade-runtime", { artifacts: [...ALL], tasks: "- [x] 1.1 a\n- [x] 1.2 b\n- [ ] 1.3 c\n" });
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "proposals");
  const ahead = await worktree(root, join(root, ".claude", "worktrees", "audit-trail"), "feat/audit-trail");
  const stale = await worktree(root, join(root, "..", "sibling-upgrade"), "feat/upgrade-runtime"); // outside the repository directory
  await writeChange(ahead, "audit-trail", { artifacts: [...ALL], tasks: "- [x] 1.1 a\n- [ ] 1.2 b\n" });
  await writeChange(stale, "upgrade-runtime", { artifacts: ["proposal"] }); // behind main: the branch never got the later artifacts
  for (const f of ["design.md", "tasks.md"]) await rm(join(stale, "openspec", "changes", "upgrade-runtime", f), { force: true });
  await rm(join(stale, "openspec", "changes", "upgrade-runtime", "specs"), { recursive: true, force: true });

  const snap = await scan(root);
  const [audit] = byName(snap, "audit-trail");
  expect(byName(snap, "audit-trail")).toHaveLength(1);
  expect([audit.column, audit.checkout?.path, audit.branchMatch]).toEqual(["Implementing", ahead, "feat/audit-trail"]);
  expect(audit.otherCheckouts).toEqual([{ path: root, branch: "main", isMain: true, column: "Drafts" }]);

  const [upgrade] = byName(snap, "upgrade-runtime");
  expect(byName(snap, "upgrade-runtime")).toHaveLength(1);
  expect([upgrade.column, upgrade.checkout?.isMain, upgrade.tasks]).toEqual(["Implementing", true, { done: 2, awaiting: 0, total: 3 }]);
  expect(upgrade.otherCheckouts).toEqual([{ path: stale, branch: "feat/upgrade-runtime", isMain: false, column: "Drafts" }]);
  // a clean copy reports the commit date, not the moment the worktree was checked out
  expect(at(upgrade.lastActivityAt)).toBeGreaterThanOrEqual(at(COMMIT_DATE));
});

test("archived on main wins over a stale active copy; a later-created change of the same name is a new change", async () => {
  const root = await repo();
  await writeChange(root, "audit-trail", { created: "2026-09-10" });
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "proposal");
  const stale = await worktree(root, join(root, ".claude", "worktrees", "stale"), "feat/stale");
  // main archives it afterwards; the worktree's branch still has it as active
  await mkdir(join(root, "openspec", "changes", "archive"), { recursive: true });
  await git(root, "mv", "openspec/changes/audit-trail", "openspec/changes/archive/2026-09-20-audit-trail");
  await git(root, "commit", "-q", "-m", "archive");

  let snap = await scan(root);
  expect(byName(snap, "audit-trail").map((c) => [c.column, c.archived])).toEqual([["Archived", "2026-09-20"]]);
  expect((await readdir(join(stale, "openspec", "changes"))).includes("audit-trail")).toBe(true); // the stale copy is really there

  const reused = await worktree(root, join(root, ".claude", "worktrees", "reused"), "feat/audit-trail-v2");
  await rm(join(reused, "openspec", "changes", "audit-trail"), { recursive: true, force: true });
  await writeChange(reused, "audit-trail", { created: "2026-10-02", artifacts: ["proposal", "design"] });
  snap = await scan(root);
  expect(byName(snap, "audit-trail").map((c) => [c.column, c.checkout?.path ?? "main-archive"]).sort()).toEqual([["Archived", "main-archive"], ["Drafts", reused]].sort());

  // that worktree's branch carries main's archive along: it is reported once, from main (asserted above); an
  // archive only the worktree has is a pending archive
  await mkdir(join(reused, "openspec", "changes", "archive", "2026-01-01-ghost"), { recursive: true });
  await writeFile(join(reused, "openspec", "changes", "archive", "2026-01-01-ghost", "proposal.md"), "# x\n");
  expect(byName(await scan(root), "ghost").map((c) => [c.column, c.archived, c.checkout?.path])).toEqual([["Archived", "2026-01-01", reused]]);
});

test("spec sync is judged in the change's own checkout", async () => {
  const root = await repo();
  const wt = await worktree(root, join(root, ".claude", "worktrees", "two-factor"), "feat/two-factor");
  await writeChange(wt, "two-factor", { artifacts: [...ALL], tasks: "- [x] 1.1 a\n" });
  expect((await scan(root)).changes.find((c) => c.name === "two-factor")?.column).toBe("Done");
  const spec = join(wt, "openspec", "specs", "auth", "spec.md");
  await writeFile(spec, `${await readFile(spec, "utf8")}\n### Requirement: Two-factor\nSHALL 2FA.\n\n#### Scenario: works\n- **WHEN** x\n- **THEN** y\n`);
  const change = (await scan(root)).changes.find((c) => c.name === "two-factor")!;
  expect([change.specsSynced, change.column]).toEqual([true, "Done"]); // main's specs still lack it
});

test("detached, prunable and failing worktrees: read, skipped, warned about — never fatal", async () => {
  const root = await repo();
  const detached = await worktree(root, join(root, ".claude", "worktrees", "detached"));
  const gone = await worktree(root, join(root, ".claude", "worktrees", "gone"), "feat/gone");
  const broken = await worktree(root, join(root, ".claude", "worktrees", "broken"), "feat/broken");
  await writeChange(detached, "from-detached");
  await writeChange(gone, "from-gone");
  await writeChange(broken, "from-broken");
  await writeChange(root, "from-main");
  await rm(gone, { recursive: true, force: true });

  class OneBroken extends LocalRepoSource {
    override forCheckout(path: string): RepoSource {
      if (path !== broken) return new OneBroken(path);
      return new (class extends LocalRepoSource {
        override listChanges(): ReturnType<LocalRepoSource["listChanges"]> {
          return Promise.reject(new Error("disk says no"));
        }
      })(path);
    }
  }
  const snap = await scan(root, new OneBroken(root));
  expect(snap.ok).toBe(true);
  expect(snap.changes.map((c) => c.name).sort()).toEqual(["from-detached", "from-main"]);
  const fromDetached = snap.changes.find((c) => c.name === "from-detached")!;
  expect([fromDetached.checkout?.branch, fromDetached.branchMatch]).toEqual([undefined, undefined]);
  expect(snap.warnings).toEqual(["worktree feat/broken: disk says no"]);
  expect(snap.worktrees.find((w) => w.path === gone)?.prunable).toBe(true);
});

test(`at most ${WORKTREE_LIMIT} worktrees are read, the most recently changed first, and the rest are counted in a warning`, async () => {
  const root = await repo();
  const total = WORKTREE_LIMIT + 3;
  for (let i = 0; i < total; i++) {
    const wt = await worktree(root, join(root, ".claude", "worktrees", `w${i}`), `feat/w${i}`);
    await writeChange(wt, `change-${String(i).padStart(2, "0")}`);
    const when = new Date(Date.UTC(2026, 8, 1 + i)); // w0 oldest … newest last
    await utimes(join(wt, "openspec", "changes"), when, when);
  }
  const snap = await scan(root);
  const names = snap.changes.map((c) => c.name).sort();
  expect(names).toHaveLength(WORKTREE_LIMIT);
  expect(names[0]).toBe("change-03"); // the three oldest were left out
  expect(snap.warnings).toEqual([`3 of ${total} worktrees were not read (limit ${WORKTREE_LIMIT}; the most recently changed ones are)`]);
}, 60_000);

test("scanning writes nothing: main checkout, linked worktrees and the shared .git are byte-for-byte untouched", async () => {
  const root = await repo();
  const wt = await worktree(root, join(root, ".claude", "worktrees", "dirty"), "feat/dirty");
  await writeChange(wt, "audit-trail", { artifacts: [...ALL] });
  await writeChange(root, "from-main");
  // stale stat info in both indexes: exactly the situation in which an unguarded `git status` rewrites them
  const old = new Date("2026-01-01T00:00:00Z");
  await utimes(join(root, "openspec", "config.yaml"), old, old);
  await utimes(join(wt, "openspec", "config.yaml"), old, old);

  const fingerprint = async (dir: string): Promise<Record<string, string>> => {
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
  };
  const indexes = [join(root, ".git", "index"), join(root, ".git", "worktrees", "dirty", "index")];
  const before = { tree: await fingerprint(root), indexes: await Promise.all(indexes.map((p) => readFile(p))) };
  const snap = await scan(root);
  expect(snap.changes.map((c) => c.name).sort()).toEqual(["audit-trail", "from-main"]);
  expect(await fingerprint(root)).toEqual(before.tree); // includes .git and the in-repo worktree
  for (const [i, p] of indexes.entries()) expect(Buffer.compare(before.indexes[i], await readFile(p))).toBe(0);
});

test("unchanged elsewhere: non-git repositories scan as before, and discovery still does not offer worktrees as repositories", async () => {
  const plain = await tempDir("osd-plain-");
  temps.push(plain);
  await writeChange(plain, "solo");
  await writeFile(join(plain, "openspec", "config.yaml"), "schema: spec-driven\n");
  const snap = await scan(plain);
  if (!snap.isGit) expect(snap.changes.map((c) => [c.name, c.checkout])).toEqual([["solo", undefined]]);

  const root = await repo();
  await worktree(root, join(root, "..", "sibling-worktree"), "feat/sibling");
  const found = await discoverRepos([], [join(root, "..")]);
  expect(found.candidates.map((c) => c.path.split("/").pop())).toEqual(["alpha-infra"]);
});

test("archived in a worktree leads over the main checkout's stale active copy", async () => {
  const root = await repo();
  await writeChange(root, "audit-trail", { created: "2026-09-10", artifacts: ["proposal", "design", "specs", "tasks"], tasks: "- [x] 1.1 a\n- [x] 1.2 b\n- [ ] 1.3 c\n" });
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "work");
  const archive = await worktree(root, join(root, ".claude", "worktrees", "archive-audit-trail"), "chore/archive-audit-trail");
  await mkdir(join(archive, "openspec", "changes", "archive"), { recursive: true });
  await git(archive, "mv", "openspec/changes/audit-trail", "openspec/changes/archive/2026-09-20-audit-trail");
  await git(archive, "commit", "-q", "-m", "archive");

  const cards = byName(await scan(root), "audit-trail");
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ column: "Archived", archived: "2026-09-20", checkout: { path: archive, branch: "chore/archive-audit-trail", isMain: false } });
  expect(cards[0].otherCheckouts).toEqual([{ path: root, branch: "main", isMain: true, column: "Implementing" }]);

  // once main has the archive too, it is an ordinary archived change again
  await git(root, "merge", "-q", "chore/archive-audit-trail");
  const merged = byName(await scan(root), "audit-trail");
  expect(merged.map((c) => [c.column, c.checkout, c.otherCheckouts])).toEqual([["Archived", undefined, undefined]]);
});

test("a name reused after a pending archive stays a separate active change", async () => {
  const root = await repo();
  await writeChange(root, "audit-trail", { created: "2026-10-02" });
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "v2");
  const old = await worktree(root, join(root, ".claude", "worktrees", "old"), "chore/old-archive");
  await rm(join(old, "openspec", "changes", "audit-trail"), { recursive: true, force: true });
  await mkdir(join(old, "openspec", "changes", "archive", "2026-09-20-audit-trail"), { recursive: true });
  await writeFile(join(old, "openspec", "changes", "archive", "2026-09-20-audit-trail", "proposal.md"), "# x\n");
  const cards = byName(await scan(root), "audit-trail");
  expect(cards.map((c) => [c.column, c.checkout?.isMain]).sort()).toEqual([["Archived", false], ["Drafts", true]].sort());
});

test("a project in a subdirectory of its repository is read from the same subdirectory of each worktree", async () => {
  const root = await repo(); // has its own openspec/ at the top level, which must not leak into the nested project
  const project = join(root, "services", "billing");
  await mkdir(join(project, "openspec", "changes"), { recursive: true });
  await writeFile(join(project, "openspec", "config.yaml"), "schema: spec-driven\n");
  await writeChange(project, "invoice-export", { created: "2026-09-01" });
  await writeChange(root, "outer-change");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "nested project");
  const wt = await worktree(root, join(root, ".claude", "worktrees", "invoice-export"), "feat/invoice-export");
  await writeChange(join(wt, "services", "billing"), "invoice-export", { created: "2026-09-01", artifacts: ["proposal", "design"] });

  const snap = await scan(project);
  expect(snap.changes.map((c) => c.name)).toEqual(["invoice-export"]); // nothing from the repository's top-level openspec/
  expect(byName(snap, "invoice-export")[0]).toMatchObject({ column: "Drafts", checkout: { path: join(wt, "services", "billing"), isMain: false } });
});

const TWO_FACTOR = "\n### Requirement: Two-factor\nSHALL 2FA.\n\n#### Scenario: works\n- **WHEN** x\n- **THEN** y\n";

test("an uncommitted change left behind in the main checkout next to its merged archive is reported once, as archived", async () => {
  // The recommended workflow: created uncommitted in main, copied into a worktree, archived there, merged back.
  const root = await repo();
  await writeChange(root, "audit-trail", { created: "2026-09-10", artifacts: [...ALL], tasks: "- [x] 1.1 a\n" });
  const work = await worktree(root, join(root, ".claude", "worktrees", "audit-trail"), "feat/audit-trail");
  await writeChange(work, "audit-trail", { created: "2026-09-10", artifacts: [...ALL], tasks: "- [x] 1.1 a\n" });
  await mkdir(join(work, "openspec", "changes", "archive"), { recursive: true });
  await Bun.$`mv ${join(work, "openspec", "changes", "audit-trail")} ${join(work, "openspec", "changes", "archive", "2026-09-20-audit-trail")}`.quiet();
  const spec = join(work, "openspec", "specs", "auth", "spec.md");
  await writeFile(spec, `${await readFile(spec, "utf8")}${TWO_FACTOR}`);
  await git(work, "add", "-A");
  await git(work, "commit", "-q", "-m", "archive");
  await git(root, "merge", "-q", "feat/audit-trail");

  expect((await readdir(join(root, "openspec", "changes"))).includes("audit-trail")).toBe(true); // the leftover is really there
  const cards = byName(await scan(root), "audit-trail");
  expect(cards.map((c) => [c.column, c.archived, c.checkout])).toEqual([["Archived", "2026-09-20", undefined]]);
  expect(cards[0].otherCheckouts).toEqual([{ path: root, branch: "main", isMain: true, column: "Done" }]);
});

test("a leftover next to its archive in a folder without git is reported once, as archived", async () => {
  class NotGit extends LocalRepoSource {
    override isGit() {
      return Promise.resolve(false);
    }
  }
  const plain = await tempDir("osd-plain-");
  temps.push(plain);
  await mkdir(join(plain, "openspec", "specs", "auth"), { recursive: true });
  await writeFile(join(plain, "openspec", "config.yaml"), "schema: spec-driven\n");
  await writeFile(join(plain, "openspec", "specs", "auth", "spec.md"), `# auth\n\n## Purpose\nx\n\n## Requirements\n${TWO_FACTOR}`);
  await writeChange(plain, "audit-trail", { created: "2026-09-10", artifacts: [...ALL], tasks: "- [x] 1.1 a\n" });
  const archived = await writeChange(plain, "archive/2026-09-20-audit-trail", { created: "2026-09-10", artifacts: [...ALL], tasks: "- [x] 1.1 a\n" });
  expect(archived.endsWith(join("archive", "2026-09-20-audit-trail"))).toBe(true);
  await writeChange(plain, "solo", { created: "2026-09-21" });

  const snap = await scan(plain, new NotGit(plain));
  expect(snap.isGit).toBe(false);
  expect(byName(snap, "audit-trail").map((c) => [c.column, c.checkout, c.otherCheckouts])).toEqual([["Archived", undefined, [{ path: plain, branch: undefined, isMain: true, column: "Done" }]]]);
  // active changes of a folder without git still carry no checkout
  expect(byName(snap, "solo").map((c) => [c.column, c.checkout])).toEqual([["Drafts", undefined]]);
});

/**
 * The reproduction of "Another change's worktree carries the change along": `rotate-keys` is `Implementing` in a main
 * checkout that was not pulled and `Done` on `origin/main` (a local ref; no remote is ever contacted).
 */
async function unpulled(): Promise<string> {
  const root = await repo();
  await writeChange(root, "rotate-keys", { artifacts: [...ALL], tasks: "- [x] 1.1 a\n- [ ] 1.2 b\n" });
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "rotate-keys");
  await writeFile(join(root, "openspec", "changes", "rotate-keys", "tasks.md"), "- [x] 1.1 a\n- [x] 1.2 b\n");
  await git(root, "commit", "-q", "-am", "rotate-keys done");
  await git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  await git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  await git(root, "reset", "-q", "--hard", "HEAD~1");
  return root;
}

async function worktreeFrom(root: string, name: string, branch: string, start: string): Promise<string> {
  const path = join(root, ".claude", "worktrees", name);
  await git(root, "worktree", "add", "-q", "-b", branch, path, start);
  const listed = (await git(root, "worktree", "list", "--porcelain")).split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
  return listed.find((p) => p.endsWith(`worktrees/${name}`)) ?? path;
}

test("a worktree made for another change does not give a carried copy its branch", async () => {
  const root = await unpulled();
  const login = await worktreeFrom(root, "add-login", "feat/add-login", "origin/main");
  await writeChange(login, "add-login");

  const snap = await scan(root);
  const [rotate] = byName(snap, "rotate-keys");
  expect([rotate.column, rotate.checkout?.path, rotate.branchMatch]).toEqual(["Done", login, undefined]);
  expect(byName(snap, "add-login")[0].branchMatch).toBe("feat/add-login");

  // the change's own worktree elsewhere is still found, even though the carried copy leads
  await worktreeFrom(root, "rotate-keys", "feat/rotate-keys", "main");
  const again = byName(await scan(root), "rotate-keys")[0];
  expect([again.checkout?.path, again.branchMatch]).toEqual([login, "feat/rotate-keys"]);
});

test("a worktree that holds work on a change gives it its branch, uncommitted or committed since the fork", async () => {
  const root = await unpulled();
  const login = await worktreeFrom(root, "add-login", "feat/add-login", "origin/main");
  await writeFile(join(login, "openspec", "changes", "rotate-keys", "tasks.md"), "- [x] 1.1 a\n- [x] 1.2 b\n\nnote\n");
  expect(byName(await scan(root), "rotate-keys")[0].branchMatch).toBe("feat/add-login");
  await rm(login, { recursive: true, force: true });
  await git(root, "worktree", "prune");

  const keys = await worktreeFrom(root, "keys", "wip/keys", "origin/main");
  expect(byName(await scan(root), "rotate-keys")[0].branchMatch).toBeUndefined();
  await writeFile(join(keys, "openspec", "changes", "rotate-keys", "tasks.md"), "- [x] 1.1 a\n- [x] 1.2 b\n- [x] 1.3 c\n");
  await git(keys, "commit", "-q", "-am", "more keys");
  const source = new LocalRepoSource(keys);
  expect([...((await source.changesTouchedSinceFork("openspec/changes", "origin/main")) ?? [])]).toEqual(["rotate-keys"]);
  expect(await source.changesTouchedSinceFork("openspec/changes", "no-such-ref")).toBeUndefined();
  const [rotate] = byName(await scan(root), "rotate-keys");
  expect([rotate.checkout?.path, rotate.branchMatch]).toEqual([keys, "wip/keys"]);
});
