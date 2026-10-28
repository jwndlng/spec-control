// Where an implementation branch starts (ship-proposals-as-docs-prs D4): read-only git against temp repositories; and
// that creating and removing a session worktree runs no hook.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { worktreesDir } from "../src/server/paths.ts";
import { ensureWorktree, implementStartPoint, removeWorktree } from "../src/server/sessions/worktree.ts";
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
