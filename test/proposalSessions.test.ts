// Draft ships its proposal (ship-proposals-as-docs-prs): in a docs auto-merge project a Draft session works on
// `docs/<change>` with the proposal instruction, Implement starts beside it on `feat/<change>`, and the existing ready-merge
// and merged-ends-session flows take the proposal pull request unchanged. Fake agent, temp git repositories, no network.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { worktreesDir } from "../src/server/paths.ts";
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

test("Implement starts beside the running proposal session, from the proposal, and never adopts its worktree", async () => {
  const { h, manager } = await project();
  // The proposal is not on the default branch yet: the change exists only uncommitted in the main checkout.
  git(h.repoPath, "rm", "-r", "-q", "--cached", `openspec/changes/${CHANGE}`);
  git(h.repoPath, "commit", "-q", "-m", "without the change");
  const draft = await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" });
  await started(manager, draft.id, draftPrompt(h, true));
  const proposalTip = await commit(draft.worktreePath, { [`openspec/changes/${CHANGE}/design.md`]: "# Design\n" });
  const draftHead = git(draft.worktreePath, "rev-parse", "--abbrev-ref", "HEAD");

  // The board routes Implement to a new session, Draft to the proposal session; the server agrees.
  const sessions = manager.list() as ChangeSession[];
  expect(nextStepFor(sessions, h.repoId, CHANGE, "implement")).toEqual({ promptSessionId: undefined });
  expect(nextStepFor(sessions, h.repoId, CHANGE, "draft")).toEqual({ promptSessionId: draft.id });
  await expect(manager.prompt(draft.id, { action: "implement" })).rejects.toThrow(/drafts the proposal/);

  const impl = await manager.open({ repoId: h.repoId, change: CHANGE, action: "implement" });
  expect(impl.id).not.toBe(draft.id);
  expect([impl.branch, impl.worktreePath, impl.adopted]).toEqual([`feat/${CHANGE}`, join(worktreesDir(), h.repoId, CHANGE), undefined]);
  expect(git(impl.worktreePath, "rev-parse", "HEAD")).toBe(proposalTip);
  await started(manager, impl.id, `implement ${CHANGE}`);
  // The proposal's worktree is neither adopted nor changed.
  expect([git(draft.worktreePath, "rev-parse", "--abbrev-ref", "HEAD"), git(draft.worktreePath, "rev-parse", "HEAD"), git(draft.worktreePath, "status", "--porcelain")]).toEqual([draftHead, proposalTip, ""]);
  // Both run; a further Implement or Draft returns the matching one.
  expect((await manager.open({ repoId: h.repoId, change: CHANGE, action: "implement" })).id).toBe(impl.id);
  expect((await manager.open({ repoId: h.repoId, change: CHANGE, action: "draft" })).id).toBe(draft.id);
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
