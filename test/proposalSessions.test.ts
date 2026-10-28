// Draft ships its proposal (ship-proposals-as-docs-prs): in a docs auto-merge project a Draft session works on
// `docs/<change>` with the proposal instruction; Implement starts on `feat/<change>` only by ending it first
// (one-console-per-change), and its pull request is then handed to the change's running session to merge. Fake agent, temp git repositories, no network.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFetchHandler, type AppState } from "../src/server/api.ts";
import { worktreesDir } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { mergePrompt, openingPrompt } from "../src/server/sessions/agents.ts";
import type { SessionManager } from "../src/server/sessions/manager.ts";
import { ensureWorktree } from "../src/server/sessions/worktree.ts";
import { AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION, type ChangeSession, type PullRequest } from "../src/shared/types.ts";
import { nextStepFor } from "../src/ui/sessionState.ts";
import { installFakeGh, type GhHarness } from "./ghHelpers.ts";
import { useTempHome } from "./helpers.ts";
import { git, harness, waitFor, watch, type Harness } from "./sessionHelpers.ts";

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

/** `Ready` in the fixture, so both Draft and Implement are available for it. */
const CHANGE = "trim-log-noise";
const DRAFTS = "add-health-endpoint";
const PROMPTS = { draft: "draft {change}", implement: "implement {change}", validate: "validate {change}", archive: "archive {change}" };
const FAST = { submitTimings: { echoTimeoutMs: 600, settleMs: 20 } };

async function project(opts: { autoMergeDocs?: boolean; conventional?: boolean } = {}) {
  const h = await harness({ agent: { prompts: PROMPTS } });
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: opts.autoMergeDocs ?? true };
  if (opts.conventional) h.config.repos[0].prTitleConvention = "conventional-commits";
  const manager = h.newManager(FAST);
  managers.push(manager);
  return { h, manager, agent: h.config.agentSessions.agents[0] };
}

async function started(manager: SessionManager, id: string, prompt: string) {
  const seen = await watch(manager, id);
  await waitFor(() => seen.text().includes(`args=${JSON.stringify([prompt])}`), "the opening prompt");
  return seen;
}

async function commit(worktree: string, files: Record<string, string>): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(worktree, path, ".."), { recursive: true });
    await writeFile(join(worktree, path), content);
  }
  git(worktree, "add", "-A");
  git(worktree, "commit", "-q", "-m", "work");
  return git(worktree, "rev-parse", "HEAD");
}

const asked = (manager: SessionManager, id: string) => (manager.get(id) as ChangeSession).autoMergeAskedAt;
const draftPrompt = (h: Harness, proposal: boolean) => openingPrompt(h.config.agentSessions.agents[0], "draft", CHANGE, { proposal, convention: h.config.repos[0].prTitleConvention }) as string;

test("Draft in a docs auto-merge project works on docs/<change> and asks for the proposal pull request", async () => {
  for (const conventional of [true, false]) {
    const { h, manager } = await project({ conventional });
    const mainHead = git(h.repoPath, "rev-parse", "HEAD");
    const status = git(h.repoPath, "status", "--porcelain");
    const s = await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" });
    expect([s.branch, s.worktreePath, s.autoMerge]).toEqual([`docs/${CHANGE}`, join(worktreesDir(), h.repoId, `docs-${CHANGE}`), true]);
    expect(asked(manager, s.id)).toBeDefined();
    expect(git(s.worktreePath, "rev-parse", "HEAD")).toBe(mainHead);
    const prompt = draftPrompt(h, true);
    expect(prompt).toStartWith(`draft ${CHANGE} This project lets`);
    expect(prompt).toContain(conventional ? `titled docs(openspec): add ${CHANGE},` : `titled Add OpenSpec proposal ${CHANGE},`);
    await started(manager, s.id, prompt);
    // The main checkout is unchanged: same branch, same commit, same status.
    expect([git(h.repoPath, "rev-parse", "--abbrev-ref", "HEAD"), git(h.repoPath, "rev-parse", "HEAD"), git(h.repoPath, "status", "--porcelain")]).toEqual(["main", mainHead, status]);
  }
});

test("without docs auto-merge Draft works on feat/<change> as before, with no instruction", async () => {
  const { h, manager } = await project({ autoMergeDocs: false });
  const s = await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" });
  expect([s.branch, s.worktreePath, s.autoMerge]).toEqual([`feat/${CHANGE}`, join(worktreesDir(), h.repoId, CHANGE), false]);
  expect(asked(manager, s.id)).toBeUndefined();
  const seen = await started(manager, s.id, draftPrompt(h, false));
  expect(seen.text()).not.toContain("open a pull request against the default branch titled");
});

test("a reused proposal worktree that holds code gets no instruction", async () => {
  const { h, manager } = await project();
  const path = join(worktreesDir(), h.repoId, `docs-${CHANGE}`);
  await ensureWorktree(h.repoPath, path, `docs/${CHANGE}`);
  await mkdir(join(path, "src"), { recursive: true });
  await writeFile(join(path, "src/app.ts"), "export {};\n");
  const s = await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" });
  expect([await realpath(s.worktreePath), s.autoMerge]).toEqual([await realpath(path), false]);
  expect(asked(manager, s.id)).toBeUndefined();
  await started(manager, s.id, draftPrompt(h, false));
});

test("Draft sent into an Implement session carries no proposal instruction", async () => {
  const { h, manager } = await project();
  const s = await manager.open({ repoId: h.repoId, change: CHANGE, action: "implement" });
  expect(s.branch).toBe(`feat/${CHANGE}`);
  const seen = await started(manager, s.id, `implement ${CHANGE}`);
  // A Draft starter goes into the running Implement session: there is no proposal session to take it.
  expect(await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" })).toMatchObject({ id: s.id, autoMerge: false });
  const result = await manager.prompt(s.id, { action: "draft" });
  expect([result.submitted, result.autoMerge]).toEqual([true, false]);
  expect(asked(manager, s.id)).toBeUndefined();
  await waitFor(() => seen.text().includes(`you said: draft ${CHANGE}`), "the draft prompt");
  expect(seen.text()).not.toContain(AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION.slice(0, 60));
});

test("Draft sent again into the proposal session carries the instruction again", async () => {
  const { h, manager } = await project();
  const s = await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" });
  const seen = await started(manager, s.id, draftPrompt(h, true));
  await commit(s.worktreePath, { [`openspec/changes/${CHANGE}/design.md`]: "# Design\n" });
  const result = await manager.prompt(s.id, { action: "draft" });
  expect([result.submitted, result.autoMerge]).toEqual([true, true]);
  await waitFor(() => seen.text().includes(`you said: ${draftPrompt(h, true)}`), "the draft prompt with the instruction");
});

test("Fast-forward keeps feat/<change> and never carries the instruction or the record", async () => {
  const { h, manager } = await project();
  const s = await manager.open({ repoId: h.repoId, change: DRAFTS, action: "fastForward" });
  expect([s.branch, s.autoMerge]).toEqual([`feat/${DRAFTS}`, false]);
  expect(asked(manager, s.id)).toBeUndefined();
  const seen = await watch(manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  expect(seen.text()).toContain(`draft ${DRAFTS}`);
  expect(seen.text()).not.toContain("titled docs(openspec)");
  expect(seen.text()).not.toContain("titled Add OpenSpec proposal");
});

/** A Draft session on docs/<change> that committed its proposal and "pushed" it: what Implement follows. */
async function proposalSession(h: Harness, manager: SessionManager) {
  const draft = await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" });
  await started(manager, draft.id, draftPrompt(h, true));
  const tip = await commit(draft.worktreePath, { [`openspec/changes/${CHANGE}/design.md`]: "# Design\n" });
  git(draft.worktreePath, "update-ref", `refs/remotes/origin/docs/${CHANGE}`, tip);
  return { draft, tip };
}

const runningOf = (manager: SessionManager) => (manager.list() as ChangeSession[]).filter((s) => s.change === CHANGE && s.state === "running");

test("Implement beside the running proposal session is refused, and nothing is created", async () => {
  const { h, manager } = await project();
  const { draft } = await proposalSession(h, manager);
  const implPath = join(worktreesDir(), h.repoId, CHANGE);

  // The board sends Draft to the proposal session and nothing else anywhere; the server agrees.
  const sessions = manager.list() as ChangeSession[];
  expect(nextStepFor(sessions, h.repoId, CHANGE, "implement")).toEqual({ promptSessionId: undefined });
  expect(nextStepFor(sessions, h.repoId, CHANGE, "draft")).toEqual({ promptSessionId: draft.id });
  await expect(manager.prompt(draft.id, { action: "implement" })).rejects.toThrow(`drafts the proposal on docs/${CHANGE}`);

  await expect(manager.open({ repoId: h.repoId, change: CHANGE, action: "implement" })).rejects.toThrow(`docs/${CHANGE}`);
  expect(await stat(implPath).catch(() => undefined)).toBeUndefined();
  expect(runningOf(manager).map((s) => s.id)).toEqual([draft.id]);
  // Draft still goes into it.
  expect((await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" })).id).toBe(draft.id);
});

test("asking to end the proposal session first ends it, keeps its worktree, and starts Implement from the proposal", async () => {
  // The proposal is not on the default branch yet: the change exists only uncommitted in the main checkout.
  const { h, manager } = await project();
  git(h.repoPath, "rm", "-r", "-q", "--cached", `openspec/changes/${CHANGE}`);
  git(h.repoPath, "commit", "-q", "-m", "without the change");
  const { draft, tip } = await proposalSession(h, manager);
  const draftHead = git(draft.worktreePath, "rev-parse", "--abbrev-ref", "HEAD");

  const impl = await manager.open({ repoId: h.repoId, change: CHANGE, action: "implement", endProposal: true });
  expect(impl.id).not.toBe(draft.id);
  expect([impl.branch, impl.worktreePath, impl.adopted]).toEqual([`feat/${CHANGE}`, join(worktreesDir(), h.repoId, CHANGE), undefined]);
  expect(git(impl.worktreePath, "rev-parse", "HEAD")).toBe(tip);
  await started(manager, impl.id, `implement ${CHANGE}`);

  // Exactly one session runs; the proposal session ended with its record, worktree and branch kept.
  expect(runningOf(manager).map((s) => s.id)).toEqual([impl.id]);
  const ended = manager.get(draft.id) as ChangeSession;
  expect(ended.state).toBe("exited");
  expect(ended.autoMergeAskedAt).toBeDefined();
  expect([git(draft.worktreePath, "rev-parse", "--abbrev-ref", "HEAD"), git(draft.worktreePath, "rev-parse", "HEAD"), git(draft.worktreePath, "status", "--porcelain")]).toEqual([draftHead, tip, ""]);
  expect(git(h.repoPath, "rev-parse", `refs/heads/docs/${CHANGE}`)).toBe(tip);

  // Resuming the proposal session now would bring back a second console.
  await expect(manager.resume(draft.id)).rejects.toThrow(`another session of ${CHANGE} is running on feat/${CHANGE}`);
  expect(manager.get(draft.id).state).toBe("exited");
  // A further Implement returns the running one.
  expect((await manager.open({ repoId: h.repoId, change: CHANGE, action: "implement" })).id).toBe(impl.id);
});

test("ending first applies every opening refusal before it ends anything", async () => {
  const { h, manager } = await project();
  const draft = await manager.open({ repoId: h.repoId, change: DRAFTS, action: "draft" });
  expect(draft.branch).toBe(`docs/${DRAFTS}`);
  // Implement is not available while the change is in Drafts.
  await expect(manager.open({ repoId: h.repoId, change: DRAFTS, action: "implement", endProposal: true })).rejects.toThrow("not available");
  // Draft and Fast-forward never end it; the flag is a boolean or nothing.
  await expect(manager.open({ repoId: h.repoId, change: DRAFTS, action: "draft", endProposal: true })).rejects.toThrow("does not end the proposal session");
  await expect(manager.open({ repoId: h.repoId, change: DRAFTS, action: "fastForward", endProposal: true })).rejects.toThrow("does not end the proposal session");
  await expect(manager.open({ repoId: h.repoId, change: DRAFTS, action: "implement", endProposal: "yes" })).rejects.toThrow("endProposal must be a boolean");
  expect(manager.get(draft.id).state).toBe("running");
});

test("when the proposal session's agent does not end, nothing is started", async () => {
  const { h, manager } = await project();
  const { draft } = await proposalSession(h, manager);
  // An agent that survives End session: `close` returns with the session still running.
  const stuck = manager as unknown as { close: (id: string) => Promise<unknown> };
  const close = stuck.close;
  stuck.close = async (id: string) => ({ session: manager.get(id) });
  try {
    await expect(manager.open({ repoId: h.repoId, change: CHANGE, action: "implement", endProposal: true })).rejects.toThrow("did not end; nothing was started");
  } finally {
    stuck.close = close;
  }
  expect(await stat(join(worktreesDir(), h.repoId, CHANGE)).catch(() => undefined)).toBeUndefined();
  expect(runningOf(manager).map((s) => s.id)).toEqual([draft.id]);
});

test("Implement after the proposal merged starts from the default branch", async () => {
  const { h, manager } = await project();
  git(h.repoPath, "branch", `docs/${CHANGE}`);
  git(h.repoPath, "commit", "-q", "--allow-empty", "-m", "later on main");
  const impl = await manager.open({ repoId: h.repoId, change: CHANGE, action: "implement" });
  expect(git(impl.worktreePath, "rev-parse", "HEAD")).toBe(git(h.repoPath, "rev-parse", "main"));
});

function pr(patch: Partial<PullRequest> & { head: string }): PullRequest {
  return { number: 90, title: `docs(openspec): add ${CHANGE}`, url: "https://github.com/acme/demo-ops/pull/90", author: "octo", base: "main", draft: false, state: "open", createdAt: new Date().toISOString(), review: "none", reviewRequestedFromViewer: false, checks: "passing", mergeable: "mergeable", docsOnly: true, ...patch };
}

test("the proposal pull request is handed back to merge once ready, and its merge ends the session", async () => {
  const { h, manager, agent } = await project();
  const s = await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" });
  const seen = await started(manager, s.id, draftPrompt(h, true));
  const head = await commit(s.worktreePath, { [`openspec/changes/${CHANGE}/design.md`]: "# Design\n" });
  // What the agent's push would leave: the branch on the remote, so the worktree holds nothing that exists nowhere else.
  git(s.worktreePath, "update-ref", `refs/remotes/origin/docs/${CHANGE}`, head);
  await gh.forget();

  await manager.requestReadyMerges(h.repoId, [pr({ head: `docs/${CHANGE}`, headOid: head })]);
  const expected = mergePrompt(agent, CHANGE, { pr: 90, head });
  await waitFor(() => seen.text().includes(`you said: ${expected}`), "the Merge prompt");
  expect((manager.get(s.id) as ChangeSession).mergeAsked).toMatchObject({ pr: 90, head, by: "dashboard" });

  const mergedAt = new Date(Date.now() + 1000).toISOString();
  await manager.endMergedAutoMerge(h.repoId, [pr({ head: `docs/${CHANGE}`, headOid: head, state: "merged", mergedAt })]);
  const ended = manager.get(s.id) as ChangeSession;
  expect(ended.state).not.toBe("running");
  expect(ended.autoEnded).toMatchObject({ pr: 90, removed: true });
  expect(await stat(s.worktreePath).catch(() => undefined)).toBeUndefined();
  expect(git(h.repoPath, "rev-parse", `refs/heads/docs/${CHANGE}`)).toBe(head); // the branch is kept
  expect(await gh.calls()).toEqual([]);
});

/** Draft, then Implement asking to end it: the ended proposal session and the running Implement session. */
async function handedOver() {
  const { h, manager, agent } = await project();
  const { draft, tip } = await proposalSession(h, manager);
  const impl = await manager.open({ repoId: h.repoId, change: CHANGE, action: "implement", endProposal: true });
  const seen = await started(manager, impl.id, `implement ${CHANGE}`);
  await gh.forget();
  return { h, manager, agent, draft, impl, tip, seen };
}

test("an ended proposal session's ready pull request is handed to the Implement session, once per head commit", async () => {
  const { h, manager, agent, draft, impl, tip, seen } = await handedOver();
  const list = [pr({ head: `docs/${CHANGE}`, headOid: tip })];
  await manager.requestReadyMerges(h.repoId, list);
  const expected = mergePrompt(agent, CHANGE, { pr: 90, head: tip, proposal: true });
  expect(expected).toEndWith(`This pull request is the change's proposal from branch docs/${CHANGE}, not the branch of this worktree.`);
  await waitFor(() => seen.text().includes(`you said: ${expected}`), "the handed-over Merge prompt");
  // Recorded on the proposal session, not on the session that received it.
  expect((manager.get(draft.id) as ChangeSession).mergeAsked).toMatchObject({ pr: 90, head: tip, by: "dashboard", submitted: true });
  expect((manager.get(impl.id) as ChangeSession).mergeAsked).toBeUndefined();

  // Seen again at the same head commit: nothing more is typed.
  await manager.requestReadyMerges(h.repoId, list);
  await new Promise((r) => setTimeout(r, 300));
  expect(seen.text().split(`you said: ${expected}`).length - 1).toBe(1);
  expect(await gh.calls()).toEqual([]);
});

test("with no running session of the change the handed-over pull request is not sent anywhere", async () => {
  const { h, manager, draft, impl, tip } = await handedOver();
  await manager.close(impl.id);
  await manager.requestReadyMerges(h.repoId, [pr({ head: `docs/${CHANGE}`, headOid: tip })]);
  expect((manager.get(draft.id) as ChangeSession).mergeAsked).toBeUndefined();
  expect(runningOf(manager)).toEqual([]);
  // And Merge by hand is refused for an ended session, as for any other.
  await expect(manager.merge(impl.id, [pr({ head: `docs/${CHANGE}`, headOid: tip })])).rejects.toThrow("not running");
});

test("Merge in the Implement session's panel targets the handed-over proposal pull request", async () => {
  const { manager, agent, draft, impl, tip, seen } = await handedOver();
  const result = await manager.merge(impl.id, [pr({ head: `docs/${CHANGE}`, headOid: tip })]);
  expect(result.id).toBe(impl.id);
  await waitFor(() => seen.text().includes(`you said: ${mergePrompt(agent, CHANGE, { pr: 90, head: tip, proposal: true })}`), "the Merge prompt");
  expect((manager.get(draft.id) as ChangeSession).mergeAsked).toMatchObject({ pr: 90, head: tip, by: "user" });
  // Its own branch's pull request comes first once there is one.
  const own = pr({ number: 91, head: `feat/${CHANGE}`, headOid: "b".repeat(40) });
  await manager.merge(impl.id, [own, pr({ head: `docs/${CHANGE}`, headOid: tip })]);
  expect((manager.get(impl.id) as ChangeSession).mergeAsked).toMatchObject({ pr: 91, by: "user" });
});

test("once the handed-over proposal pull request merged, its worktree is removed, its branch kept, and Implement keeps running", async () => {
  const { h, manager, draft, impl, tip } = await handedOver();
  const mergedAt = new Date(Date.now() + 1000).toISOString();
  await manager.endMergedAutoMerge(h.repoId, [pr({ head: `docs/${CHANGE}`, headOid: tip, state: "merged", mergedAt })]);
  expect((manager.get(draft.id) as ChangeSession).autoEnded).toMatchObject({ pr: 90, removed: true });
  expect(await stat(draft.worktreePath).catch(() => undefined)).toBeUndefined();
  expect(git(h.repoPath, "rev-parse", `refs/heads/docs/${CHANGE}`)).toBe(tip);
  expect(manager.get(impl.id).state).toBe("running");
  expect(await gh.calls()).toEqual([]);
});

test("API: endProposal is accepted as a boolean only", async () => {
  const { h, manager } = await project();
  const { draft } = await proposalSession(h, manager);
  const state: AppState = { config: h.config, scanner: new Scanner(() => h.config, { persist: false }, h.snapshot), sessions: manager };
  const handle = createFetchHandler({ state, indexHtml: "" });
  const post = (body: unknown) => handle(new Request("http://127.0.0.1:4173/api/sessions", { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:4173" }, body: JSON.stringify(body) }));
  const open = { repoId: h.repoId, change: CHANGE, action: "implement" };

  for (const endProposal of ["true", 1, null, {}]) {
    const refused = await post({ ...open, endProposal });
    expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([400, "endProposal must be a boolean"]);
  }
  expect((await post({ ...open, endProposal: false })).status).toBe(409);
  expect(manager.get(draft.id).state).toBe("running");
  const started = await post({ ...open, endProposal: true });
  expect(started.status).toBe(201);
  expect(((await started.json()) as ChangeSession).branch).toBe(`feat/${CHANGE}`);
  expect(manager.get(draft.id).state).toBe("exited");
});
