// Where an implementation branch starts (ship-proposals-as-docs-prs D4): read-only git against temp repositories; and
// that creating and removing a session worktree runs no hook.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { worktreesDir } from "../src/server/paths.ts";
import { ensureWorktree, implementStartPoint, removeWorktree, WorktreeMismatchError } from "../src/server/sessions/worktree.ts";
import { useTempHome } from "./helpers.ts";
import { hookLog, installRepoHooks } from "./hookHelpers.ts";
import { git, tempGitRepo } from "./sessionHelpers.ts";

let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterAll(() => cleanup());

/** A `docs/<change>` branch with the change's proposal committed on it, made without touching the main checkout. */
async function proposal(repo: string, change: string): Promise<string> {
  const path = join(worktreesDir(), `t-${Math.random().toString(36).slice(2, 8)}`, `docs-${change}`);
  await ensureWorktree(repo, path, `docs/${change}`);
  await mkdir(join(path, "openspec/changes", change), { recursive: true });
  await writeFile(join(path, "openspec/changes", change, "proposal.md"), "# Proposal\n");
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "proposal");
  return git(path, "rev-parse", "HEAD");
}

test("an unmerged proposal is where the implementation branch starts", async () => {
  const repo = await tempGitRepo();
  const tip = await proposal(repo, "rotate-keys");
  const refs = git(repo, "for-each-ref");
  expect(await implementStartPoint(repo, "rotate-keys", "docs/rotate-keys")).toBe("docs/rotate-keys");
  expect(git(repo, "for-each-ref")).toBe(refs); // read-only
  const path = join(worktreesDir(), "t-impl", "rotate-keys");
  expect(await ensureWorktree(repo, path, "feat/rotate-keys", { startPoint: "docs/rotate-keys" })).toEqual({ created: true, base: "docs/rotate-keys" });
  expect(git(path, "rev-parse", "HEAD")).toBe(tip);
  expect(git(path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feat/rotate-keys");
});

test("a merged proposal leaves the default branch as the start point", async () => {
  const repo = await tempGitRepo();
  await proposal(repo, "rotate-keys");
  git(repo, "merge", "-q", "--ff-only", "docs/rotate-keys");
  expect(await implementStartPoint(repo, "rotate-keys", "docs/rotate-keys")).toBeUndefined();
  // The fixture's own changes are on the default branch from the start.
  git(repo, "branch", "docs/trim-log-noise");
  expect(await implementStartPoint(repo, "trim-log-noise", "docs/trim-log-noise")).toBeUndefined();
});

test("without a proposal branch the default branch stays the start point", async () => {
  const repo = await tempGitRepo();
  expect(await implementStartPoint(repo, "rotate-keys", "docs/rotate-keys")).toBeUndefined();
  const path = join(worktreesDir(), "t-none", "rotate-keys");
  expect(await ensureWorktree(repo, path, "feat/rotate-keys")).toEqual({ created: true, base: "HEAD" });
  expect(git(path, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "HEAD"));
});

test("an existing implementation branch is checked out whatever start point is offered", async () => {
  const repo = await tempGitRepo();
  await proposal(repo, "rotate-keys");
  git(repo, "branch", "feat/rotate-keys");
  const path = join(worktreesDir(), "t-existing", "rotate-keys");
  expect(await ensureWorktree(repo, path, "feat/rotate-keys", { startPoint: "docs/rotate-keys" })).toEqual({ created: true });
  expect(git(path, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "main"));
});

test("hooks do not run when a session worktree is created and removed", async () => {
  const repo = await tempGitRepo();
  const log = await installRepoHooks(repo);
  const path = join(worktreesDir(), `t-${Math.random().toString(36).slice(2, 8)}`, "rotate-keys");
  expect(await ensureWorktree(repo, path, "feat/rotate-keys")).toMatchObject({ created: true });
  expect(git(path, "symbolic-ref", "--short", "HEAD")).toBe("feat/rotate-keys");
  expect(await removeWorktree(repo, path)).toEqual({ removable: true });
  expect(existsSync(path)).toBe(false);
  expect(await hookLog(log)).toEqual([]);
});

// ---- a reused directory is verified (harden-session-lifecycle D5) ----

test("a reused worktree on another branch is refused for a new session and accepted for its own restart", async () => {
  const repo = await tempGitRepo();
  const path = join(worktreesDir(), "t-reuse", "rotate-keys");
  await ensureWorktree(repo, path, "feat/rotate-keys");
  git(path, "checkout", "-q", "-b", "feat/rotate-keys-v2");
  const refs = git(repo, "for-each-ref");
  await expect(ensureWorktree(repo, path, "feat/rotate-keys", { verify: "branch" })).rejects.toThrow(/is on feat\/rotate-keys-v2, not on feat\/rotate-keys/);
  await expect(ensureWorktree(repo, path, "feat/rotate-keys")).rejects.toBeInstanceOf(WorktreeMismatchError); // the default
  expect(await ensureWorktree(repo, path, "feat/rotate-keys", { verify: "repository" })).toEqual({ created: false });
  git(path, "checkout", "-q", "--detach");
  await expect(ensureWorktree(repo, path, "feat/rotate-keys")).rejects.toThrow(/is on no branch/);
  expect([git(repo, "for-each-ref"), git(path, "status", "--porcelain")]).toEqual([refs, ""]); // nothing changed
});

test("a leftover folder inside another repository, or another repository's worktree, is not reused", async () => {
  const repo = await tempGitRepo();
  const other = await tempGitRepo();
  const leftover = join(other, "leftover");
  await mkdir(leftover);
  await expect(ensureWorktree(repo, leftover, "feat/rotate-keys")).rejects.toThrow(/is not a worktree of this repository/);
  await expect(ensureWorktree(repo, leftover, "feat/rotate-keys", { verify: "repository" })).rejects.toBeInstanceOf(WorktreeMismatchError);
  const theirs = join(worktreesDir(), "t-theirs", "rotate-keys");
  await ensureWorktree(other, theirs, "feat/rotate-keys");
  await expect(ensureWorktree(repo, theirs, "feat/rotate-keys")).rejects.toThrow(/is not a worktree of this repository/);
  expect(git(repo, "worktree", "list", "--porcelain").includes("rotate-keys")).toBe(false); // nothing created
});
