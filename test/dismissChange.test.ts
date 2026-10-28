import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newRepoConfig } from "../src/server/config.ts";
import { isChangeDirName } from "../src/shared/changeNames.ts";
import { dismissChange, DismissError, isDismissing, previewDismiss } from "../src/server/dismissChange.ts";
import { scanRepo } from "../src/server/scanner.ts";
import type { RepoConfig, RepoSnapshot } from "../src/shared/types.ts";
import { tempDir, treeFingerprint, useTempHome } from "./helpers.ts";
import { hookLog, writeHooks } from "./hookHelpers.ts";
import { git, harness, tempGitRepo, tempPlainRepo, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: Harness["manager"][] = [];

// A commit may start `git maintenance run --auto` in the background, which writes into `.git/objects` while a test
// compares the repository byte for byte (see test/cleanup.test.ts).
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
  scan: () => Promise<RepoSnapshot>;
}

async function repoAt(path: string): Promise<Repo> {
  const repo = newRepoConfig(path, true);
  return { repo, path, scan: () => scanRepo(repo) };
}

const gitRepo = async () => repoAt(await tempGitRepo());
const changeDir = (r: Repo, name: string) => join(r.path, "openspec", "changes", name);
const stagedNames = (r: Repo) => git(r.path, "diff", "--cached", "--name-status").split("\n").filter(Boolean);

async function refused(promise: Promise<unknown>): Promise<DismissError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DismissError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

test("names that could leave openspec/changes are not dismissable", () => {
  for (const bad of ["..", ".", "archive", "Archive", "a/b", "", "../x"]) expect(isChangeDirName(bad)).toBe(false);
  expect(isChangeDirName("add-health-endpoint")).toBe(true);
});

test("committed files are restorable; modified, untracked and ignored files are lost", async () => {
  const r = await gitRepo();
  const dir = changeDir(r, "structured-logs");
  await appendFile(join(dir, "design.md"), "\nedited\n");
  await writeFile(join(dir, "tasks.md"), "- [ ] 1.1 draft\n");
  await writeFile(join(r.path, ".gitignore"), "*.local\n");
  await writeFile(join(dir, "notes.local"), "scratch\n");
  const p = await previewDismiss(r.repo, await r.scan(), "structured-logs");
  const state = Object.fromEntries(p.files.map((f) => [f.path, f.state]));
  expect(p.isGit).toBe(true);
  expect(state["proposal.md"]).toBe("restorable");
  expect(state[".openspec.yaml"]).toBe("restorable");
  expect(state["design.md"]).toBe("lost");
  expect(state["tasks.md"]).toBe("lost");
  expect(state["notes.local"]).toBe("lost");
  expect(p.files.some((f) => f.path.startsWith("specs/"))).toBe(true);
  expect(p.copies).toEqual([]);
  expect(p.fingerprint).toMatch(/^[0-9a-f]{64}$/);
});

test("a tracked file already deleted from the working tree is listed as restorable", async () => {
  const r = await gitRepo();
  await Bun.file(join(changeDir(r, "structured-logs"), "design.md")).delete();
  const p = await previewDismiss(r.repo, await r.scan(), "structured-logs");
  expect(p.files.find((f) => f.path === "design.md")?.state).toBe("restorable");
});

test("the preview writes nothing", async () => {
  const r = await gitRepo();
  await writeFile(join(changeDir(r, "structured-logs"), "tasks.md"), "- [ ] untracked\n");
  // Stale stat information: `git status` would rewrite the index to refresh it, were optional locks allowed.
  const touched = join(changeDir(r, "structured-logs"), "proposal.md");
  await writeFile(touched, await readFile(touched));
  const scanned = await r.scan();
  const before = { tree: await treeFingerprint(r.path), index: await readFile(join(r.path, ".git", "index")), refs: git(r.path, "for-each-ref") };
  await previewDismiss(r.repo, scanned, "structured-logs");
  expect({ tree: await treeFingerprint(r.path), index: await readFile(join(r.path, ".git", "index")), refs: git(r.path, "for-each-ref") }).toEqual(before);
});

test("dismissing a committed change deletes it and stages its removal, without committing", async () => {
  const r = await gitRepo();
  const head = git(r.path, "rev-parse", "HEAD");
  const scanned = await r.scan();
  const p = await previewDismiss(r.repo, scanned, "structured-logs");
  expect(await dismissChange(r.repo, scanned, "structured-logs", p.fingerprint)).toEqual({ name: "structured-logs", staged: true });
  expect(existsSync(changeDir(r, "structured-logs"))).toBe(false);
  const staged = stagedNames(r);
  expect(staged.length).toBe(p.files.length);
  expect(staged.every((l) => /^D\topenspec\/changes\/structured-logs\//.test(l))).toBe(true);
  expect(git(r.path, "rev-parse", "HEAD")).toBe(head);
  expect((await r.scan()).changes.some((c) => c.name === "structured-logs")).toBe(false);
});

test("an untracked change is deleted and reported as not staged", async () => {
  const r = await gitRepo();
  await mkdir(changeDir(r, "lint-rules"));
  await writeFile(join(changeDir(r, "lint-rules"), ".openspec.yaml"), "schema: spec-driven\n");
  const scanned = await r.scan();
  const p = await previewDismiss(r.repo, scanned, "lint-rules");
  expect(p.files).toEqual([{ path: ".openspec.yaml", state: "lost" }]);
  expect(await dismissChange(r.repo, scanned, "lint-rules", p.fingerprint)).toEqual({ name: "lint-rules", staged: false });
  expect(existsSync(changeDir(r, "lint-rules"))).toBe(false);
  expect(stagedNames(r)).toEqual([]);
});

test("an existing change whose name a new change may not have, such as .draft, can still be dismissed", async () => {
  const r = await gitRepo();
  await mkdir(changeDir(r, ".draft"));
  await writeFile(join(changeDir(r, ".draft"), "proposal.md"), "# Draft\n");
  const scanned = await r.scan();
  expect(scanned.changes.some((c) => c.name === ".draft")).toBe(true);
  const p = await previewDismiss(r.repo, scanned, ".draft");
  expect(await dismissChange(r.repo, scanned, ".draft", p.fingerprint)).toEqual({ name: ".draft", staged: false });
  expect(existsSync(changeDir(r, ".draft"))).toBe(false);
});

test("in a folder without git every file is lost, the directory is deleted and no git runs", async () => {
  const r = await repoAt(await tempPlainRepo());
  const scanned = await r.scan();
  expect(scanned.isGit).toBe(false);
  const p = await previewDismiss(r.repo, scanned, "add-health-endpoint");
  expect(p.isGit).toBe(false);
  expect(p.files.every((f) => f.state === "lost")).toBe(true);
  expect(await dismissChange(r.repo, scanned, "add-health-endpoint", p.fingerprint)).toEqual({ name: "add-health-endpoint", staged: false });
  expect(existsSync(changeDir(r, "add-health-endpoint"))).toBe(false);
  expect(existsSync(join(r.path, ".git"))).toBe(false);
});

test("a symbolic link as the change directory is refused and neither link nor target is deleted", async () => {
  const r = await gitRepo();
  const target = join(await tempDir("osd-target-"), "lint-rules");
  await mkdir(target);
  await writeFile(join(target, "proposal.md"), "# elsewhere\n");
  await symlink(target, changeDir(r, "lint-rules"));
  const err = await refused(previewDismiss(r.repo, await r.scan(), "lint-rules"));
  expect(err.status).toBe(409);
  await expect(dismissChange(r.repo, await r.scan(), "lint-rules", "x")).rejects.toThrow("symbolic link");
  expect(existsSync(changeDir(r, "lint-rules"))).toBe(true);
  expect(await readFile(join(target, "proposal.md"), "utf8")).toBe("# elsewhere\n");
});

test("archived, unknown and worktree-only changes are refused with their reason", async () => {
  const r = await gitRepo();
  const scanned = await r.scan();
  const archived = scanned.changes.find((c) => c.archived && !scanned.changes.some((a) => a.name === c.name && !a.archived));
  expect(archived).toBeDefined();
  expect((await refused(previewDismiss(r.repo, scanned, archived!.name))).message).toContain("archived");
  expect((await refused(previewDismiss(r.repo, scanned, "no-such-change"))).status).toBe(404);
  const withWorktreeOnly: RepoSnapshot = {
    ...scanned,
    changes: [...scanned.changes, { ...scanned.changes[0], name: "only-there", archived: undefined, checkout: { path: "/w/acme/wt", branch: "feat/only-there", isMain: false }, otherCheckouts: [] }],
  };
  const err = await refused(previewDismiss(r.repo, withWorktreeOnly, "only-there"));
  expect(err.status).toBe(404);
  expect(err.message).toContain("feat/only-there");
});

test("a file written after the preview makes the dismissal refuse and delete nothing", async () => {
  const r = await gitRepo();
  const scanned = await r.scan();
  const p = await previewDismiss(r.repo, scanned, "structured-logs");
  await writeFile(join(changeDir(r, "structured-logs"), "tasks.md"), "- [ ] new\n");
  const before = await treeFingerprint(r.path);
  const err = await refused(dismissChange(r.repo, scanned, "structured-logs", p.fingerprint));
  expect(err.status).toBe(409);
  expect(err.message).toContain("changed since");
  expect(await treeFingerprint(r.path)).toBe(before);
  expect(stagedNames(r)).toEqual([]);
});

test("an open session refuses the dismissal; a second dismissal of the same change is refused", async () => {
  const r = await gitRepo();
  const scanned = await r.scan();
  const p = await previewDismiss(r.repo, scanned, "structured-logs");
  expect((await refused(dismissChange(r.repo, scanned, "structured-logs", p.fingerprint, () => true))).message).toContain("session");
  expect(existsSync(changeDir(r, "structured-logs"))).toBe(true);

  const first = dismissChange(r.repo, scanned, "structured-logs", p.fingerprint);
  expect(isDismissing(r.repo.id, "structured-logs")).toBe(true);
  expect((await refused(dismissChange(r.repo, scanned, "structured-logs", p.fingerprint))).message).toContain("already");
  await first;
  expect(isDismissing(r.repo.id, "structured-logs")).toBe(false);
});

test("only the change directory is deleted and staged; unrelated work, link targets and a worktree's copy stay", async () => {
  const r = await gitRepo();
  // A linked worktree holding its own copy of the change.
  const wt = join(await tempDir("osd-wt-"), "structured-logs");
  git(r.path, "worktree", "add", "-q", "-b", "feat/structured-logs", wt);
  await appendFile(join(wt, "openspec", "changes", "structured-logs", "design.md"), "\nin the worktree\n");
  // Unrelated modified and untracked work in the main checkout, and a link inside the change to a file outside it.
  await appendFile(join(r.path, "openspec", "changes", "audit-trail", "proposal.md"), "\nunrelated edit\n");
  await writeFile(join(r.path, "scratch.txt"), "untracked\n");
  const outside = join(await tempDir("osd-outside-"), "keep.md");
  await writeFile(outside, "keep me\n");
  await symlink(outside, join(changeDir(r, "structured-logs"), "linked.md"));

  const scanned = await r.scan();
  const p = await previewDismiss(r.repo, scanned, "structured-logs");
  expect(p.copies).toEqual([{ path: wt, branch: "feat/structured-logs" }]);
  expect(p.files.find((f) => f.path === "linked.md")?.state).toBe("lost");

  const before = { wt: await treeFingerprint(wt), wtStatus: git(wt, "status", "--porcelain"), refs: git(r.path, "for-each-ref"), head: git(r.path, "rev-parse", "HEAD"), branch: git(r.path, "symbolic-ref", "HEAD") };
  await dismissChange(r.repo, scanned, "structured-logs", p.fingerprint);

  expect(stagedNames(r).every((l) => l.startsWith("D\topenspec/changes/structured-logs/"))).toBe(true);
  expect(git(r.path, "diff", "--name-only")).toBe("openspec/changes/audit-trail/proposal.md");
  expect(git(r.path, "status", "--porcelain")).toContain("?? scratch.txt");
  expect(await readFile(outside, "utf8")).toBe("keep me\n");
  expect({ wt: await treeFingerprint(wt), wtStatus: git(wt, "status", "--porcelain"), refs: git(r.path, "for-each-ref"), head: git(r.path, "rev-parse", "HEAD"), branch: git(r.path, "symbolic-ref", "HEAD") }).toEqual(before);
  // The card stays, now read from the worktree.
  expect((await r.scan()).changes.find((c) => c.name === "structured-logs")?.checkout?.isMain).toBe(false);
});

test("sessions cannot start for a change while it is being dismissed; open sessions are reported", async () => {
  const h = await harness();
  managers.push(h.manager);
  const repo = h.config.repos[0];
  const scanned = h.snapshot.repos[0];
  const p = await previewDismiss(repo, scanned, "upgrade-runtime");
  // Held open by a stale fingerprint: the lock is taken before the first await and released on refusal.
  const pending = dismissChange(repo, scanned, "upgrade-runtime", p.fingerprint.replace(/./, "x")).catch((e) => e);
  await expect(h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).rejects.toThrow("being dismissed");
  expect(await pending).toBeInstanceOf(DismissError);

  expect(h.manager.hasOpenSession(h.repoId, "upgrade-runtime")).toBe(false);
  await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(h.manager.hasOpenSession(h.repoId, "upgrade-runtime")).toBe(true);
  expect(h.manager.hasOpenSession(h.repoId, "structured-logs")).toBe(false);
});

test("a change directory replaced by a file is not treated as a change", async () => {
  const r = await gitRepo();
  const dir = changeDir(r, "add-health-endpoint");
  await rename(dir, `${dir}.bak`);
  await writeFile(dir, "not a directory\n");
  expect((await refused(previewDismiss(r.repo, await r.scan(), "add-health-endpoint"))).status).toBe(404);
  expect(await readFile(dir, "utf8")).toBe("not a directory\n");
});

test("the user's global hooks folder never runs for the staging `git add --all`", async () => {
  const r = await gitRepo();
  const base = await tempDir("osd-hooks-");
  const log = join(base, "hook-log.txt");
  await writeHooks(join(base, "hooks"), log);
  await writeFile(join(base, "gitconfig"), `[core]\n\thooksPath = ${join(base, "hooks")}\n`);
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
  try {
    const scanned = await r.scan();
    const p = await previewDismiss(r.repo, scanned, "structured-logs");
    expect(await dismissChange(r.repo, scanned, "structured-logs", p.fingerprint)).toEqual({ name: "structured-logs", staged: true });
    expect(stagedNames(r).length).toBe(p.files.length);
    expect(await hookLog(log)).toEqual([]);
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved;
  }
});

// --- No symbolic link on the way to the change directory (contain-repository-reads design D6). ---

/** Moves `rel` (`openspec` or `openspec/changes`) of the repository out to a folder elsewhere and links it back. */
async function linkOut(r: Repo, rel: string): Promise<string> {
  const target = join(await tempDir("osd-shared-changes-"), "shared");
  await rename(join(r.path, rel), target);
  await symlink(target, join(r.path, rel));
  return target;
}

for (const rel of ["openspec/changes", "openspec"]) {
  test(`with ${rel} a symbolic link, preview and dismissal are refused and the link's target is unchanged`, async () => {
    const r = await repoAt(await tempPlainRepo());
    const target = await linkOut(r, rel);
    const scanned = await r.scan();
    expect(scanned.changes.some((c) => c.name === "cloud-deployment" && !c.archived)).toBe(true);
    const before = await treeFingerprint(target);
    const err = await refused(previewDismiss(r.repo, scanned, "cloud-deployment"));
    expect([err.status, err.message.startsWith(`${rel} is a symbolic link`)]).toEqual([409, true]);
    const again = await refused(dismissChange(r.repo, scanned, "cloud-deployment", "x"));
    expect(again.status).toBe(409);
    expect(await treeFingerprint(target)).toEqual(before);
  });
}

test("a link that replaces openspec/changes after the preview makes the dismissal refuse and delete nothing", async () => {
  const r = await repoAt(await tempPlainRepo());
  const scanned = await r.scan();
  const preview = await previewDismiss(r.repo, scanned, "cloud-deployment");
  const target = await linkOut(r, "openspec/changes");
  const before = await treeFingerprint(target);
  const err = await refused(dismissChange(r.repo, scanned, "cloud-deployment", preview.fingerprint));
  expect(err.status).toBe(409);
  expect(await treeFingerprint(target)).toEqual(before);
});
