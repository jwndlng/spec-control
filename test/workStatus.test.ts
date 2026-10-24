import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, readFile, realpath, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFetchHandler, type AppState } from "../src/server/api.ts";
import { defaultConfig, loadConfig } from "../src/server/config.ts";
import { configPath, worktreesDir } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { resolveConflictsPrompt, shipPrompt } from "../src/server/sessions/agents.ts";
import { changeOfWorktree, readWorkStatus } from "../src/server/sessions/workStatus.ts";
import { ensureWorktree } from "../src/server/sessions/worktree.ts";
import { CONVENTIONAL_COMMITS_SHIP_SENTENCE, DEFAULT_RESOLVE_CONFLICTS_PROMPT, DEFAULT_SHIP_PROMPT, type Session, type SessionWorktree } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { FAKE_AGENT, fakeProfile, git, harness, recordFor, tempGitRepo, waitFor, watch, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: Harness["manager"][] = [];

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

/** Gives the repository an `origin` (a bare repository next to it) that has `main`, as after a clone. */
async function withOrigin(repoPath: string): Promise<string> {
  const bare = join(await realpath(await tempDir("osd-origin-")), "origin.git");
  git(repoPath, "init", "-q", "--bare", bare);
  git(repoPath, "remote", "add", "origin", bare);
  git(repoPath, "push", "-q", "-u", "origin", "main");
  git(repoPath, "remote", "set-head", "origin", "main");
  return bare;
}

async function worktree(repoPath: string, name: string): Promise<string> {
  const path = join(worktreesDir(), `t-${Math.random().toString(36).slice(2, 8)}`, name);
  await ensureWorktree(repoPath, path, `feat/${name}`);
  return path;
}

const commit = async (wt: string, file: string, content: string) => {
  await writeFile(join(wt, file), content);
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", `edit ${file}`);
};

test("work status walks from clean over uncommitted, unpushed and pushed to merged", async () => {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  const wt = await worktree(repo, "walk");
  const state = async () => (await readWorkStatus(repo, wt)).work;

  expect(await state()).toEqual({ state: "clean", base: "origin/main" });

  await writeFile(join(wt, "a.txt"), "a");
  await writeFile(join(wt, "b.txt"), "b");
  await writeFile(join(wt, "README.md"), "changed");
  expect(await state()).toEqual({ state: "uncommitted", count: 3, base: "origin/main" });

  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "one");
  await commit(wt, "c.txt", "c");
  expect(await state()).toEqual({ state: "unpushed", count: 2, base: "origin/main" });

  git(wt, "push", "-q", "-u", "origin", "feat/walk");
  expect(await state()).toEqual({ state: "pushed", base: "origin/main" });
  await commit(wt, "d.txt", "d");
  expect(await state()).toEqual({ state: "unpushed", count: 1, base: "origin/main" });
  git(wt, "push", "-q");

  // merged with a merge commit, and the user fetched
  git(repo, "merge", "-q", "--no-ff", "-m", "merge", "feat/walk");
  git(repo, "push", "-q", "origin", "main");
  expect((await state()).state).toBe("merged");
  expect((await readWorkStatus(repo, wt)).branch).toBe("feat/walk");
});

test("a squash merge is recognised by content, also after the remote branch was deleted; a later edit of the base undoes that", async () => {
  const repo = await tempGitRepo();
  await withOrigin(repo);
  const wt = await worktree(repo, "squash");
  await commit(wt, "one.txt", "1");
  await commit(wt, "two.txt", "2");
  await commit(wt, "one.txt", "1b");
  git(wt, "push", "-q", "-u", "origin", "feat/squash");
  expect((await readWorkStatus(repo, wt)).work.state).toBe("pushed");

  git(repo, "merge", "-q", "--squash", "feat/squash");
  git(repo, "commit", "-q", "-m", "feat: squash (#1)");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "push", "-q", "origin", "--delete", "feat/squash"); // GitHub's "delete branch", then `fetch --prune`
  expect((await readWorkStatus(repo, wt)).work.state).toBe("merged");

  await writeFile(join(repo, "two.txt"), "rewritten on main");
  git(repo, "commit", "-q", "-am", "later");
  git(repo, "push", "-q", "origin", "main");
  expect((await readWorkStatus(repo, wt)).work.state).toBe("unpushed"); // safe direction: never "merged" by mistake
});

test("without a remote the main checkout is the base; a missing directory is missing", async () => {
  const repo = await tempGitRepo();
  const wt = await worktree(repo, "local");
  await commit(wt, "x.txt", "x");
  expect((await readWorkStatus(repo, wt)).work).toEqual({ state: "unpushed", count: 1, base: "the main checkout" });
  expect((await readWorkStatus(repo, join(wt, "nope"))).work.state).toBe("missing");
  expect(changeOfWorktree("archive-add-x")).toEqual({ change: "add-x", action: "archive" });
  expect(changeOfWorktree("add-x")).toEqual({ change: "add-x", action: "implement" });
});

test("reading the status writes nothing: a stale index stays byte for byte", async () => {
  const repo = await tempGitRepo();
  const wt = await worktree(repo, "readonly");
  const gitDir = git(wt, "rev-parse", "--absolute-git-dir");
  const old = new Date(Date.now() - 3_600_000);
  await utimes(join(wt, "openspec", "config.yaml"), old, old); // stat info no longer matches the index; plain `git status` would rewrite it
  const before = await readFile(join(gitDir, "index"));
  const objects = git(repo, "count-objects", "-v");
  await readWorkStatus(repo, wt);
  expect(Buffer.compare(before, await readFile(join(gitDir, "index")))).toBe(0);
  expect(git(repo, "count-objects", "-v")).toBe(objects);
});

const worktreeOf = async (h: Harness, s: Session) => (await h.manager.worktrees()).find((w) => w.path === s.worktreePath) as SessionWorktree;

test("worktrees are listed per directory, survive their session record, and are not read with the feature off", async () => {
  const h = await harness();
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  await writeFile(join(s.worktreePath, "new.txt"), "x");
  const listed = await worktreeOf(h, s);
  expect(listed).toMatchObject({ repoId: h.repoId, name: "upgrade-runtime", change: "upgrade-runtime", action: "implement", branch: "feat/upgrade-runtime", sessionId: s.id });
  expect(listed.work.state).toBe("uncommitted");

  await h.manager.close(s.id); // ending a session drops the cache
  await h.manager.remove(s.id);
  const orphan = (await h.newManager().worktrees()).find((w) => w.path === s.worktreePath);
  expect(orphan?.sessionId).toBeUndefined();
  expect(orphan?.work.state).toBe("uncommitted");

  h.config.agentSessions.enabled = false;
  expect(await h.newManager().worktrees()).toEqual([]);
});

test("ship types the prompt into a running agent, and starts an ended one again with it", async () => {
  const h = await harness({ agent: { prompts: { ...fakeProfile().prompts, ship: "ship {change} now" } } });
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  await writeFile(join(s.worktreePath, "work.txt"), "x");

  expect((await h.manager.ship(s.id)).submitted).toBe(true);
  await waitFor(() => seen.text().includes("you said: ship upgrade-runtime now"), "the submitted ship prompt");
  expect(h.manager.list().filter((x) => x.state === "running")).toHaveLength(1);

  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  const again = await h.manager.ship(s.id);
  expect(again.id).toBe(s.id);
  expect(again.state).toBe("running");
  await waitFor(() => seen.text().includes('args=["--resumed"]') && seen.text().split("you said: ship upgrade-runtime now").length === 3, "resume command plus typed prompt");
});

test("ship submits the default prompt plus the profile's additional Ship instructions", async () => {
  // The case the feature exists for: a standing instruction about pull requests, without restating the whole prompt.
  const extra = "Add the checklist from CONTRIBUTING.md to the PR body.";
  const h = await harness({ agent: { promptSuffixes: { ship: `  ${extra}\n  Then tell me the URL.  ` } } });
  managers.push(h.manager);
  const record = recordFor("upgrade-runtime");
  const composed = `${DEFAULT_SHIP_PROMPT} ${record} ${extra} Then tell me the URL.`;
  expect(shipPrompt(h.config.agentSessions.agents[0], "upgrade-runtime", { record })).toBe(composed);

  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  await writeFile(join(s.worktreePath, "work.txt"), "x");

  expect((await h.manager.ship(s.id)).submitted).toBe(true);
  await waitFor(() => seen.text().includes(`you said: ${composed}`), "the composed ship prompt");
});

test("ship for a project with Conventional Commits titles carries the sentence, running and resumed; Implement does not", async () => {
  const h = await harness({ agent: { prompts: { ...fakeProfile().prompts, ship: "ship {change} now" } } });
  managers.push(h.manager);
  h.config.repos[0].prTitleConvention = "conventional-commits";
  const composed = `ship upgrade-runtime now ${CONVENTIONAL_COMMITS_SHIP_SENTENCE}`;
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  expect(seen.text()).not.toContain(CONVENTIONAL_COMMITS_SHIP_SENTENCE);
  await writeFile(join(s.worktreePath, "work.txt"), "x");

  expect((await h.manager.ship(s.id)).submitted).toBe(true);
  await waitFor(() => seen.text().includes(`you said: ${composed}`), "the ship prompt with the convention");

  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  await h.manager.ship(s.id);
  await waitFor(() => seen.text().includes('args=["--resumed"]') && seen.text().split(`you said: ${composed}`).length === 3, "resumed with the convention");
});

test("ship into a running agent that shows a menu is typed, not confirmed, and says so", async () => {
  const h = await harness({ agent: { command: [FAKE_AGENT, "--menu", "{prompt}"] } });
  const manager = h.newManager({ submitTimings: { echoTimeoutMs: 600, settleMs: 20 } });
  managers.push(manager);
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(manager, s.id);
  await waitFor(() => seen.text().includes("Enter to confirm"), "the menu");
  await writeFile(join(s.worktreePath, "work.txt"), "x");
  const result = await manager.ship(s.id);
  expect(result.submitted).toBe(false);
  expect(result.id).toBe(s.id);
  await new Promise((r) => setTimeout(r, 200));
  expect(seen.text()).not.toContain("menu confirmed by Enter");
});

test("ship without a resume command starts the agent with the default prompt; nothing to ship is refused", async () => {
  const h = await harness({ agent: { resumeCommand: undefined } });
  managers.push(h.manager);
  const shipped = `${DEFAULT_SHIP_PROMPT} ${recordFor("upgrade-runtime")}`;
  expect(shipPrompt(h.config.agentSessions.agents[0], "upgrade-runtime", { record: recordFor("upgrade-runtime") })).toBe(shipped);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  await expect(h.manager.ship(s.id)).rejects.toMatchObject({ status: 409 }); // clean: the change is committed in the fixture

  await writeFile(join(s.worktreePath, "work.txt"), "x");
  await h.manager.ship(s.id);
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes(JSON.stringify([shipped])), "the default prompt as the opening argument");
});

test("API: worktrees ride along with the sessions; removal validates its input, spares running sessions and accepts merged work without a record", async () => {
  const h = await harness();
  managers.push(h.manager);
  await withOrigin(h.repoPath);
  const state: AppState = { config: h.config, scanner: new Scanner(() => h.config, { persist: false }, h.snapshot), sessions: h.manager };
  const handle = createFetchHandler({ state, indexHtml: "" });
  const call = (path: string, body?: unknown) =>
    handle(new Request(`http://127.0.0.1:4173${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:4173" }, body: JSON.stringify(body) }));

  const s = (await (await call("/api/sessions", { repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).json()) as Session;
  const list = (await (await call("/api/sessions")).json()) as { worktrees: SessionWorktree[] };
  expect(list.worktrees.map((w) => [w.name, w.sessionId])).toEqual([["upgrade-runtime", s.id]]);

  expect((await call("/api/worktrees/remove", { repoId: h.repoId, name: "../x" })).status).toBe(400);
  expect((await call("/api/worktrees/remove", { repoId: "nope", name: "upgrade-runtime" })).status).toBe(404);
  expect((await call("/api/worktrees/remove", { repoId: h.repoId, name: "unknown" })).status).toBe(404);
  expect((await call("/api/worktrees/remove", { repoId: h.repoId, name: "upgrade-runtime" })).status).toBe(409); // running
  expect((await fetchStatus(handle, `/api/sessions/${s.id}/ship`))).toBe(403); // cross-site guard applies to the new routes

  // squash-merge the work, delete the remote branch, drop the record: only the directory is left
  await commit(s.worktreePath, "feature.txt", "f");
  git(s.worktreePath, "push", "-q", "-u", "origin", "feat/upgrade-runtime");
  git(h.repoPath, "merge", "-q", "--squash", "feat/upgrade-runtime");
  git(h.repoPath, "commit", "-q", "-m", "feat: squashed");
  git(h.repoPath, "push", "-q", "origin", "main");
  git(h.repoPath, "push", "-q", "origin", "--delete", "feat/upgrade-runtime");
  await call(`/api/sessions/${s.id}/close`, {});
  expect(await (await call(`/api/sessions/${s.id}/worktree`)).json()).toEqual({ removable: true, work: { state: "merged", base: "origin/main" } });
  await h.manager.remove(s.id);

  await mkdir(join(s.worktreePath, "scratch"));
  await writeFile(join(s.worktreePath, "scratch", "note"), "dirty");
  expect(await (await call("/api/worktrees/remove", { repoId: h.repoId, name: "upgrade-runtime" })).json()).toMatchObject({ removable: false });
  git(s.worktreePath, "clean", "-qfd");
  expect(await (await call("/api/worktrees/remove", { repoId: h.repoId, name: "upgrade-runtime" })).json()).toEqual({ removable: true });
  expect(await stat(s.worktreePath).catch(() => undefined)).toBeUndefined();
  expect(git(h.repoPath, "branch", "--list", "feat/upgrade-runtime")).toContain("feat/upgrade-runtime"); // the branch is never deleted
});

async function fetchStatus(handle: (req: Request) => Promise<Response>, path: string): Promise<number> {
  return (await handle(new Request(`http://127.0.0.1:4173${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" } }))).status;
}

test("config: a ship prompt is optional, need not name the change, and cannot carry a bypass flag", async () => {
  const write = (ship: string) => writeFile(configPath(), JSON.stringify({ ...defaultConfig(), agentSessions: { enabled: true, defaultAgent: "fake", agents: [{ ...fakeProfile(), prompts: { implement: "do {change}", ship } }] } }));
  await mkdir(join(configPath(), ".."), { recursive: true });
  await write("commit, push and open a PR");
  const ok = await loadConfig();
  expect(ok.warning).toBeUndefined();
  expect(ok.config.agentSessions.agents[0].prompts.ship).toBe("commit, push and open a PR");
  await write("push with --dangerously-skip-permissions");
  expect((await loadConfig()).warning).toBeDefined();
});

/** Makes the worktree's branch and the repository's base touch the same line, so the branch no longer merges. */
async function conflictWith(repoPath: string, worktreePath: string): Promise<void> {
  await writeFile(join(worktreePath, "shared.txt"), "branch side\n");
  git(worktreePath, "add", "-A");
  git(worktreePath, "commit", "-q", "-m", "branch edit");
  await writeFile(join(repoPath, "shared.txt"), "main side\n");
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-q", "-m", "main edit");
}

test("resolve conflicts types the prompt into a running agent, and starts an ended one again with it", async () => {
  const h = await harness({ agent: { prompts: { ...fakeProfile().prompts, resolveConflicts: "unstick {change} now" } } });
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");

  // Nothing to resolve while the branch still merges.
  await expect(h.manager.resolveConflicts(s.id)).rejects.toMatchObject({ status: 409 });
  await conflictWith(h.repoPath, s.worktreePath);
  expect((await readWorkStatus(h.repoPath, s.worktreePath)).work.conflicts?.files).toEqual(["shared.txt"]);

  expect((await h.manager.resolveConflicts(s.id)).submitted).toBe(true);
  await waitFor(() => seen.text().includes("you said: unstick upgrade-runtime now"), "the submitted prompt");
  expect(h.manager.list().filter((x) => x.state === "running")).toHaveLength(1);

  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  const again = await h.manager.resolveConflicts(s.id);
  expect(again.id).toBe(s.id);
  expect(again.state).toBe("running");
  await waitFor(() => seen.text().includes('args=["--resumed"]') && seen.text().split("you said: unstick upgrade-runtime now").length === 3, "resume command plus typed prompt");
});

test("resolve conflicts into an agent showing a menu is typed, not confirmed", async () => {
  const h = await harness({ agent: { command: [FAKE_AGENT, "--menu", "{prompt}"] } });
  const manager = h.newManager({ submitTimings: { echoTimeoutMs: 600, settleMs: 20 } });
  managers.push(manager);
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(manager, s.id);
  await waitFor(() => seen.text().includes("Enter to confirm"), "the menu");
  await conflictWith(h.repoPath, s.worktreePath);

  const result = await manager.resolveConflicts(s.id);
  expect(result.submitted).toBe(false);
  await new Promise((r) => setTimeout(r, 200));
  expect(seen.text()).not.toContain("menu confirmed by Enter");
});

test("resolve conflicts without a resume command starts the agent with the default prompt, and never writes to the repository", async () => {
  const h = await harness({ agent: { resumeCommand: undefined } });
  managers.push(h.manager);
  expect(resolveConflictsPrompt(h.config.agentSessions.agents[0], "upgrade-runtime")).toBe(DEFAULT_RESOLVE_CONFLICTS_PROMPT.replaceAll("{change}", "upgrade-runtime"));
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  await conflictWith(h.repoPath, s.worktreePath);

  // What the dashboard must not do: the repository's HEAD, branch and tree are the same afterwards.
  const head = git(h.repoPath, "rev-parse", "HEAD");
  const branch = git(h.repoPath, "rev-parse", "--abbrev-ref", "HEAD");
  const wtHead = git(s.worktreePath, "rev-parse", "HEAD");

  await h.manager.resolveConflicts(s.id);
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes(JSON.stringify([DEFAULT_RESOLVE_CONFLICTS_PROMPT.replaceAll("{change}", "upgrade-runtime")])), "the default prompt as the opening argument");

  expect(git(h.repoPath, "rev-parse", "HEAD")).toBe(head);
  expect(git(h.repoPath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
  expect(git(s.worktreePath, "rev-parse", "HEAD")).toBe(wtHead); // no rebase, no merge, no commit by the dashboard
});
