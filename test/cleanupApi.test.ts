import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppState, createFetchHandler } from "../src/server/api.ts";
import { defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { Scanner } from "../src/server/scanner.ts";
import { pullRequestsCachePath } from "../src/server/paths.ts";
import { parsePullRequest, PullRequests } from "../src/server/pullRequests.ts";
import { ghPr, installFakeGh } from "./ghHelpers.ts";
import type { CleanupPreview, CleanupResult, RepoConfig } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { git, tempGitRepo } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let state: AppState;
let active: RepoConfig;
let disabled: RepoConfig;
let plain: RepoConfig;
let merged: string;

const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

/** A clean worktree whose branch is merged into main, next to the repository. */
async function mergedWorktree(repoPath: string, branch: string): Promise<string> {
  const path = join(await tempDir("osd-wt-"), branch.replace(/\//g, "-"));
  git(repoPath, "worktree", "add", "-q", "-b", branch, path, "main");
  await writeFile(join(path, "done.txt"), branch);
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "done");
  git(repoPath, "merge", "-q", "--ff-only", branch);
  return path;
}

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  const activePath = await tempGitRepo();
  merged = await mergedWorktree(activePath, "feat/finished");
  active = newRepoConfig(activePath, true);
  disabled = newRepoConfig(await tempGitRepo(), false);
  const plainRoot = join(await tempDir("osd-plain-"), "plain-notes");
  await mkdir(join(plainRoot, "openspec", "changes"), { recursive: true });
  plain = newRepoConfig(plainRoot, true);
  // No session manager: agent sessions are disabled, and cleanup must work regardless.
  state = { config: { ...defaultConfig(), repos: [active, disabled, plain] }, scanner: undefined as unknown as Scanner };
  state.scanner = new Scanner(() => state.config, { persist: false });
  await state.scanner.trigger().done;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createFetchHandler({ state, indexHtml: "" }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  state.scanner.stop();
  server.stop(true);
  await cleanup();
});

test("unknown repositories are 404; disabled and non-git ones are 409", async () => {
  expect((await send("GET", "/api/repos/nope/cleanup")).status).toBe(404);
  expect((await send("POST", "/api/repos/nope/cleanup", { worktrees: [], prune: false, branches: [] })).status).toBe(404);
  for (const repo of [disabled, plain]) {
    expect((await send("GET", `/api/repos/${repo.id}/cleanup`)).status).toBe(409);
    expect((await send("POST", `/api/repos/${repo.id}/cleanup`, { worktrees: [], prune: false, branches: [] })).status).toBe(409);
  }
});

test("malformed bodies are 400", async () => {
  const path = `/api/repos/${active.id}/cleanup`;
  expect((await send("POST", path, "{not json")).status).toBe(400);
  expect((await send("POST", path, { worktrees: "all", prune: false, branches: [] })).status).toBe(400);
  expect((await send("POST", path, { worktrees: [], prune: "yes", branches: [] })).status).toBe(400);
  expect((await send("POST", path, { worktrees: [], prune: false, branches: [{ name: "x", commit: "HEAD" }] })).status).toBe(400);
});

test("a foreign origin is refused and nothing is removed", async () => {
  const res = await send("POST", `/api/repos/${active.id}/cleanup`, { worktrees: [merged], prune: false, branches: [] }, { origin: "https://example.com" });
  expect(res.status).toBe(403);
  expect(existsSync(merged)).toBe(true);
});

test("preview, then apply, with agent sessions disabled", async () => {
  const path = `/api/repos/${active.id}/cleanup`;
  const preview = (await send("GET", path)).body as CleanupPreview;
  expect(preview.worktrees).toEqual([expect.objectContaining({ path: merged, removable: true, managed: false })]);
  const branch = preview.branches.find((b) => b.name === "feat/finished")!;
  expect(branch).toMatchObject({ removable: true, worktreePath: merged });

  const res = await send("POST", path, {
    worktrees: [merged],
    prune: false,
    branches: [
      { name: branch.name, commit: branch.commit },
      { name: "--all", commit: branch.commit },
    ],
  });
  expect(res.status).toBe(200);
  expect((res.body as CleanupResult).items).toEqual([
    { kind: "worktree", id: merged, outcome: "removed" },
    { kind: "branch", id: "feat/finished", outcome: "deleted", commit: branch.commit },
    { kind: "branch", id: "--all", outcome: "kept", reason: "not a valid branch name" },
  ]);
  expect(existsSync(merged)).toBe(false);
  expect(git(active.path, "branch", "--list", "feat/finished")).toBe("");
});

test("cleanup API consumes the existing PR cache without refreshing it, including after a cache-only restart", async () => {
  const wt = join(await tempDir("osd-cached-proof-"), "proof");
  git(active.path, "worktree", "add", "-q", "-b", "feat/cache-proof", wt, "main");
  await writeFile(join(wt, "proof.txt"), "merged work");
  git(wt, "add", "-A");
  git(wt, "commit", "-qm", "branch work");
  const headOid = git(wt, "rev-parse", "HEAD");
  git(active.path, "merge", "--squash", "feat/cache-proof");
  git(active.path, "commit", "-qm", "squash");
  const mergeOid = git(active.path, "rev-parse", "HEAD");
  await writeFile(join(active.path, "proof.txt"), "later base edits");
  git(active.path, "commit", "-qam", "base edits");
  git(active.path, "remote", "add", "origin", "https://github.com/acme/alpha-infra.git");
  const fetchedAt = new Date().toISOString();
  await writeFile(pullRequestsCachePath(), JSON.stringify({ version: 1, repos: { "acme/alpha-infra": { fetchedAt, pullRequests: [parsePullRequest(ghPr({
    number: 81, state: "MERGED", headRefName: "feat/cache-proof", headRefOid: headOid,
    mergeCommit: { oid: mergeOid }, isCrossRepository: false,
  }))] } } }));
  state.pullRequests = new PullRequests();
  const gh = await installFakeGh({ mode: "fail" });
  try {
    const path = `/api/repos/${active.id}/cleanup`;
    const preview = (await send("GET", path)).body as CleanupPreview;
    expect(preview.branches.find((b) => b.name === "feat/cache-proof")).toMatchObject({ removable: true, mergedBy: "pull-request", pullRequest: 81, evidenceFetchedAt: fetchedAt });
    const result = await send("POST", path, { worktrees: [wt], prune: false, branches: [{ name: "feat/cache-proof", commit: headOid }] });
    expect(result.status).toBe(200);
    expect((result.body as CleanupResult).items.map((i) => i.outcome)).toEqual(["removed", "deleted"]);
    expect(await gh.calls()).toEqual([]);
  } finally { gh.restore(); }
});
