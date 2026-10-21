// Merge (agent-merges-docs-prs): the manual action, which hands the agent of a running session a prompt naming its
// ready pull request and head commit, and the automatic one, which sends the same prompt on its own once a completed
// pull-request query shows a session's docs-only pull request ready. The dashboard merges nothing either way.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionActivity } from "../src/server/activity/events.ts";
import { mergePrompt } from "../src/server/sessions/agents.ts";
import type { SessionManager } from "../src/server/sessions/manager.ts";
import { SessionStore } from "../src/server/sessions/store.ts";
import { sessionBranch } from "../src/shared/sessionBranch.ts";
import type { ChangeSession, PullRequest } from "../src/shared/types.ts";
import { installFakeGh, type GhHarness } from "./ghHelpers.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { FAKE_AGENT, git, harness, waitFor, watch, type Harness } from "./sessionHelpers.ts";

setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
let gh: GhHarness;
const managers: SessionManager[] = [];

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
  // On PATH for every test, so a `gh` started by mistake would show up in its log.
  gh = await installFakeGh({});
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(async () => {
  gh.restore();
  await cleanup();
});

const ARCHIVE = "confirm-retention";
const IMPLEMENT = "upgrade-runtime";
const FAST = { submitTimings: { echoTimeoutMs: 600, settleMs: 20 } };
const PROMPTS = { draft: "draft {change}", implement: "implement {change}", validate: "validate {change}", archive: "archive {change}" };

function pr(patch: Partial<PullRequest> & { head: string }): PullRequest {
  return { number: 88, title: "archive", url: "https://github.com/acme/demo-ops/pull/88", author: "octo", base: "main", draft: false, state: "open", createdAt: new Date().toISOString(), review: "none", reviewRequestedFromViewer: false, checks: "passing", mergeable: "mergeable", docsOnly: true, ...patch };
}

/** A project with docs auto-merge as given, and a manager whose activity reports are collected. */
async function project(opts: { autoMergeDocs?: boolean; menu?: boolean } = {}) {
  const h = await harness({ agent: { prompts: PROMPTS, ...(opts.menu ? { command: [FAKE_AGENT, "--menu", "{prompt}"] } : {}) } });
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: opts.autoMergeDocs ?? true };
  const events: SessionActivity[] = [];
  const manager = h.newManager({ ...FAST, onActivity: (_session, activity) => events.push(activity) });
  managers.push(manager);
  return { h, manager, events };
}

/** Commits `files` in the session's worktree and answers the new head commit. */
function commit(worktree: string, files: Record<string, string>): Promise<string> {
  return (async () => {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(worktree, path, ".."), { recursive: true });
      await writeFile(join(worktree, path), content);
    }
    git(worktree, "add", "-A");
    git(worktree, "commit", "-q", "-m", "work");
    return git(worktree, "rev-parse", "HEAD");
  })();
}

/** An Archive session given the docs auto-merge instruction, whose worktree holds one committed OpenSpec change. */
async function archiveSession(manager: SessionManager, h: Harness, opts: { menu?: boolean } = {}) {
  const started = await manager.open({ repoId: h.repoId, change: ARCHIVE, action: "archive" });
  expect(started.autoMerge).toBe(true);
  const seen = await watch(manager, started.id);
  await waitFor(() => seen.text().includes(opts.menu ? "Enter to confirm" : "fake-agent ready"), "the agent");
  const head = await commit(started.worktreePath, { [`openspec/changes/${ARCHIVE}/notes.md`]: "archived\n" });
  return { s: manager.get(started.id) as ChangeSession, seen, head, ready: (patch: Partial<PullRequest> = {}) => [pr({ head: sessionBranch("archive", ARCHIVE), headOid: head, ...patch })] };
}

/** Typed lines the fake agent echoed back that carry a Merge prompt. */
const merges = (text: string) => text.split("\n").filter((line) => line.includes("you said: ") && line.includes("head commit is"));

// ---- manual Merge (4.1) ----

test("Merge by hand submits the default prompt and the sentence, records it, and starts no gh or git", async () => {
  const { h, manager, events } = await project({ autoMergeDocs: false });
  const s = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  const seen = await watch(manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  const head = "c0ffee0000000000000000000000000000000041";
  const list = [pr({ number: 41, head: s.branch as string, headOid: head, docsOnly: undefined, checks: "none" })];
  const shim = await recordGit();
  await gh.forget();
  let result: Awaited<ReturnType<SessionManager["merge"]>>;
  try {
    result = await manager.merge(s.id, list);
  } finally {
    shim.restore();
  }
  expect(result.submitted).toBe(true);
  const expected = mergePrompt(h.config.agentSessions.agents[0], IMPLEMENT, { pr: 41, head });
  await waitFor(() => seen.text().includes(`you said: ${expected}`), "the Merge prompt");
  expect((manager.get(s.id) as ChangeSession).mergeAsked).toMatchObject({ pr: 41, head, submitted: true, by: "user" });
  expect(events.filter((e) => e.kind === "session-merge")).toEqual([{ kind: "session-merge", pr: 41, by: "user", submitted: true }]);
  expect(await gh.calls()).toEqual([]);
  expect(await shim.calls()).toEqual([]);
  // Stored with the session, and the automatic record is untouched.
  const stored = (await new SessionStore().loadAll()).find((x) => x.id === s.id) as ChangeSession;
  expect([stored.mergeAsked?.pr, stored.autoMergeAskedAt]).toEqual([41, undefined]);
});

test("Merge while the agent shows a menu is typed but not sent, and recorded as such", async () => {
  const { h, manager, events } = await project({ autoMergeDocs: false, menu: true });
  const s = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  const seen = await watch(manager, s.id);
  await waitFor(() => seen.text().includes("Enter to confirm"), "the menu");
  const result = await manager.merge(s.id, [pr({ number: 41, head: s.branch as string, headOid: "c0ffee0000000000000000000000000000000041" })]);
  expect(result.submitted).toBe(false);
  await Bun.sleep(200);
  expect(seen.text()).not.toContain("menu confirmed by Enter");
  expect((manager.get(s.id) as ChangeSession).mergeAsked).toMatchObject({ pr: 41, submitted: false, by: "user" });
  expect(events.filter((e) => e.kind === "session-merge")).toEqual([{ kind: "session-merge", pr: 41, by: "user", submitted: false }]);
});

test("Merge refusals: ended session, not ready, no pull request, no head commit, in place, sessions off", async () => {
  const { h, manager, events } = await project({ autoMergeDocs: false });
  const s = await manager.open({ repoId: h.repoId, change: IMPLEMENT, action: "implement" });
  const seen = await watch(manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  const branch = s.branch as string;
  const head = "c0ffee0000000000000000000000000000000041";
  const status = async (list: PullRequest[], id = s.id) => {
    try {
      await manager.merge(id, list);
    } catch (err) {
      return [(err as { status?: number }).status, (err as Error).message];
    }
    return [0, ""];
  };
  expect(await status([pr({ head: branch, headOid: head, checks: "pending" })])).toEqual([409, expect.stringContaining("not ready")]);
  expect(await status([pr({ head: branch, headOid: head, draft: true })])).toEqual([409, expect.stringContaining("not ready")]);
  expect(await status([pr({ head: branch, headOid: head, mergeable: "conflicting" })])).toEqual([409, expect.stringContaining("not ready")]);
  expect(await status([pr({ head: branch })])).toEqual([409, expect.stringContaining("no head commit")]);
  expect(await status([pr({ head: "feat/other", headOid: head })])).toEqual([409, expect.stringContaining("no open pull request")]);
  expect(await status([pr({ head: branch, headOid: head, state: "merged" })])).toEqual([409, expect.stringContaining("no open pull request")]);
  expect(await status([])).toEqual([409, expect.stringContaining("no open pull request")]);
  h.config.agentSessions.enabled = false;
  expect((await status([pr({ head: branch, headOid: head })]))[0]).toBe(403);
  h.config.agentSessions.enabled = true;
  await manager.close(s.id);
  const procs = manager.list().filter((x) => x.state === "running").length;
  expect(await status([pr({ head: branch, headOid: head })])).toEqual([409, expect.stringContaining("resume it to merge")]);
  expect(manager.list().filter((x) => x.state === "running").length).toBe(procs);
  expect(manager.get(s.id).state).toBe("exited");
  expect(merges(seen.text())).toEqual([]);
  expect(events.filter((e) => e.kind === "session-merge")).toEqual([]);

  // A folder without git has no branch, so nothing to merge.
  const plain = await harness({ git: false, agent: { prompts: PROMPTS } });
  const m = plain.newManager(FAST);
  managers.push(m);
  const inPlace = await m.open({ repoId: plain.repoId, change: IMPLEMENT, action: "implement" });
  await expect(m.merge(inPlace.id, [pr({ head: "anything", headOid: head })])).rejects.toMatchObject({ status: 400 });
});

// ---- automatic Merge (4.2) ----

test("a ready docs-only pull request at the worktree's commit is handed to the agent once", async () => {
  const { h, manager, events } = await project();
  const { s, seen, head, ready } = await archiveSession(manager, h);
  const askedAt = s.autoMergeAskedAt;
  await gh.forget();
  await manager.requestReadyMerges(h.repoId, ready());
  const expected = mergePrompt(h.config.agentSessions.agents[0], ARCHIVE, { pr: 88, head });
  await waitFor(() => seen.text().includes(`you said: ${expected}`), "the Merge prompt");
  const after = manager.get(s.id) as ChangeSession;
  expect(after.mergeAsked).toMatchObject({ pr: 88, head, submitted: true, by: "dashboard" });
  // A Merge prompt does not change the auto-merge record.
  expect(after.autoMergeAskedAt).toBe(askedAt);
  expect(events.filter((e) => e.kind === "session-merge")).toEqual([{ kind: "session-merge", pr: 88, by: "dashboard", submitted: true }]);
  expect(await gh.calls()).toEqual([]);

  // Seen again at the same head commit: nothing more is typed.
  await manager.requestReadyMerges(h.repoId, ready());
  await Bun.sleep(150);
  expect(merges(seen.text())).toHaveLength(1);
  expect(events.filter((e) => e.kind === "session-merge")).toHaveLength(1);

  // A fix was pushed: the new head commit is sent once.
  const next = await commit(s.worktreePath, { [`openspec/changes/${ARCHIVE}/notes.md`]: "fixed\n" });
  await manager.requestReadyMerges(h.repoId, ready({ headOid: next }));
  await manager.requestReadyMerges(h.repoId, ready({ headOid: next }));
  await waitFor(() => merges(seen.text()).length === 2, "the second Merge prompt");
  await Bun.sleep(150);
  expect(merges(seen.text())).toHaveLength(2);
  expect(merges(seen.text())[1]).toContain(next);
  expect((manager.get(s.id) as ChangeSession).mergeAsked).toMatchObject({ head: next, by: "dashboard" });
});

test("nothing is sent unless every condition holds", async () => {
  const { h, manager, events } = await project();
  const { s, seen, head, ready } = await archiveSession(manager, h);
  const cases: [string, PullRequest[]][] = [
    ["no checks at all", ready({ checks: "none" })],
    ["checks running", ready({ checks: "pending" })],
    ["not docs-only", ready({ docsOnly: false })],
    ["docs-only unknown", ready({ docsOnly: undefined })],
    ["a draft", ready({ draft: true })],
    ["a conflict", ready({ mergeable: "conflicting" })],
    ["another base", ready({ base: "release" })],
    ["no head commit", ready({ headOid: undefined })],
    ["another head commit", ready({ headOid: "c0ffee0000000000000000000000000000000099" })],
    ["another branch", ready({ head: "feat/other" })],
    ["merged", ready({ state: "merged" })],
  ];
  for (const [, list] of cases) await manager.requestReadyMerges(h.repoId, list);
  // Another repository's list says nothing about this one.
  await manager.requestReadyMerges("another-repo", ready());

  // The worktree is ahead of the pull request: a local commit not pushed yet.
  await commit(s.worktreePath, { [`openspec/changes/${ARCHIVE}/more.md`]: "more\n" });
  await manager.requestReadyMerges(h.repoId, ready({ headOid: head }));

  await Bun.sleep(150);
  expect(merges(seen.text())).toEqual([]);
  expect((manager.get(s.id) as ChangeSession).mergeAsked).toBeUndefined();
  expect(events.filter((e) => e.kind === "session-merge")).toEqual([]);
});

test("a file outside openspec only the worktree shows — a rename out of src/ — sends nothing", async () => {
  const { h, manager } = await project();
  // The base carries a code file the archive branch then moves into openspec/: GitHub lists only the new path.
  await mkdir(join(h.repoPath, "src"), { recursive: true });
  await writeFile(join(h.repoPath, "src", "keys.ts"), Array.from({ length: 40 }, (_, i) => `export const k${i} = ${i};`).join("\n"));
  git(h.repoPath, "add", "-A");
  git(h.repoPath, "commit", "-q", "-m", "code");
  const { s, seen } = await archiveSession(manager, h);
  await mkdir(join(s.worktreePath, "openspec", "keys"), { recursive: true });
  git(s.worktreePath, "mv", "src/keys.ts", "openspec/keys/keys.ts");
  git(s.worktreePath, "commit", "-q", "-m", "move");
  const head = git(s.worktreePath, "rev-parse", "HEAD");
  await manager.requestReadyMerges(h.repoId, [pr({ head: s.branch as string, headOid: head })]);
  // An uncommitted file outside openspec/ holds it back as well.
  const { h: h2, manager: m2 } = await project();
  const other = await archiveSession(m2, h2);
  await writeFile(join(other.s.worktreePath, "notes.txt"), "left behind");
  await m2.requestReadyMerges(h2.repoId, other.ready());
  await Bun.sleep(150);
  expect([merges(seen.text()), merges(other.seen.text())]).toEqual([[], []]);
  expect([(manager.get(s.id) as ChangeSession).mergeAsked, (m2.get(other.s.id) as ChangeSession).mergeAsked]).toEqual([undefined, undefined]);
});

test("an agent that exited gets nothing, and nothing is started for it", async () => {
  const { h, manager, events } = await project();
  const { s, ready } = await archiveSession(manager, h);
  await manager.close(s.id);
  const running = manager.list().filter((x) => x.state === "running").length;
  await manager.requestReadyMerges(h.repoId, ready());
  expect(manager.get(s.id).state).toBe("exited");
  expect(manager.list().filter((x) => x.state === "running").length).toBe(running);
  expect((manager.get(s.id) as ChangeSession).mergeAsked).toBeUndefined();
  expect(events.filter((e) => e.kind === "session-merge")).toEqual([]);
});

test("the opt-in off, sessions disabled, no record, or a Fast-forward session: nothing is sent", async () => {
  const { h, manager } = await project();
  const { s, seen, ready } = await archiveSession(manager, h);
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: false };
  await manager.requestReadyMerges(h.repoId, ready());
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
  h.config.agentSessions.enabled = false;
  await manager.requestReadyMerges(h.repoId, ready());
  h.config.agentSessions.enabled = true;
  await Bun.sleep(150);
  expect(merges(seen.text())).toEqual([]);
  expect((manager.get(s.id) as ChangeSession).mergeAsked).toBeUndefined();

  // An Implement session was never given the instruction, so it carries no record.
  const { h: h2, manager: m2 } = await project();
  const impl = await m2.open({ repoId: h2.repoId, change: IMPLEMENT, action: "implement" });
  const implSeen = await watch(m2, impl.id);
  await waitFor(() => implSeen.text().includes("fake-agent ready"), "the agent");
  const implHead = await commit(impl.worktreePath, { [`openspec/changes/${IMPLEMENT}/notes.md`]: "x\n" });
  await m2.requestReadyMerges(h2.repoId, [pr({ head: impl.branch as string, headOid: implHead })]);
  // A session recorded as Fast-forward never gets one on its own, whatever else it carries.
  const ff = m2.get(impl.id) as ChangeSession;
  ff.action = "fastForward";
  ff.autoMergeAskedAt = new Date().toISOString();
  await m2.requestReadyMerges(h2.repoId, [pr({ head: impl.branch as string, headOid: implHead })]);
  await Bun.sleep(150);
  expect(merges(implSeen.text())).toEqual([]);
  expect(ff.mergeAsked).toBeUndefined();
});

test("two queries completing together send one Merge prompt", async () => {
  const { h, manager, events } = await project();
  const { s, seen, ready } = await archiveSession(manager, h);
  await Promise.all([manager.requestReadyMerges(h.repoId, ready()), manager.requestReadyMerges(h.repoId, ready()), manager.requestReadyMerges(h.repoId, ready())]);
  await waitFor(() => merges(seen.text()).length === 1, "the Merge prompt");
  await Bun.sleep(150);
  expect(merges(seen.text())).toHaveLength(1);
  expect(events.filter((e) => e.kind === "session-merge")).toHaveLength(1);
  expect((manager.get(s.id) as ChangeSession).mergeAsked?.by).toBe("dashboard");
});

test("typed but not confirmed is recorded and never typed again", async () => {
  const { h, manager, events } = await project({ menu: true });
  const { s, seen, ready } = await archiveSession(manager, h, { menu: true });
  await manager.requestReadyMerges(h.repoId, ready());
  const asked = (manager.get(s.id) as ChangeSession).mergeAsked;
  expect(asked).toMatchObject({ pr: 88, submitted: false, by: "dashboard" });
  await manager.requestReadyMerges(h.repoId, ready());
  await Bun.sleep(200);
  expect(seen.text()).not.toContain("menu confirmed by Enter");
  expect((manager.get(s.id) as ChangeSession).mergeAsked).toEqual(asked);
  expect(events.filter((e) => e.kind === "session-merge")).toEqual([{ kind: "session-merge", pr: 88, by: "dashboard", submitted: false }]);
});

// ---- helpers ----

/** Puts a `git` first on PATH that logs each call before running the real one, so a test can prove none ran. */
async function recordGit(): Promise<{ calls(): Promise<string[]>; restore(): void }> {
  const real = Bun.which("git") as string;
  const dir = await tempDir("osd-git-shim-");
  const log = join(dir, "calls.log");
  await writeFile(log, "");
  await writeFile(join(dir, "git"), `#!/bin/sh\necho "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(real)} "$@"\n`);
  await chmod(join(dir, "git"), 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${dir}:${before ?? ""}`;
  return {
    calls: async () => (await readFile(log, "utf8")).split("\n").filter(Boolean),
    restore: () => {
      process.env.PATH = before;
    },
  };
}
