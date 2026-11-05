import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFetchHandler, type AppState } from "../src/server/api.ts";
import { worktreesDir } from "../src/server/paths.ts";
import { Scanner } from "../src/server/scanner.ts";
import { CLAUDE_PROFILE } from "../src/shared/agentDefaults.ts";
import type { AgentAvailability, ChangeSession, ChangeSnapshot, Session } from "../src/shared/types.ts";
import { nextStepFor, startersFor } from "../src/ui/sessionState.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { fakeProfile, FAKE_AGENT, harness, waitFor, watch, type Harness } from "./sessionHelpers.ts";

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

const changeOf = (h: Harness, name: string) => h.snapshot.repos[0].changes.find((c) => c.name === name) as ChangeSnapshot;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("change overrides choose the new session's profile and its available prompts", async () => {
  const h = await harness();
  managers.push(h.manager);
  h.config.agentSessions.agents.push(fakeProfile({ id: "other", name: "Other", prompts: { implement: "other {change}" } }));
  h.config.repos[0].agent = { enabled: true, changeAgents: { "upgrade-runtime": "other" } };
  const change = changeOf(h, "upgrade-runtime");
  const s = await h.manager.open({ repoId: h.repoId, change: change.name, action: "implement" });
  expect(s.agentId).toBe("other");
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("other upgrade-runtime"), "the overridden prompt");
  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  delete h.config.repos[0].agent?.changeAgents;
  const resumed = await h.manager.resume(s.id);
  expect(resumed.agentId).toBe("other");
  h.manager.write(resumed.id, "exit\r");
  await waitFor(() => h.manager.get(resumed.id).state === "exited", "resumed exit");
  h.config.repos[0].agent = { enabled: true, changeAgents: { "upgrade-runtime": "other" } };
  const { session: consoleSession } = await h.manager.openProjectConsole(h.repoId);
  expect(consoleSession.agentId).toBe("fake");
  Object.assign(change, { stage: "done" });
  await expect(h.manager.open({ repoId: h.repoId, change: change.name, action: "archive" })).rejects.toThrow(/no "archive" prompt configured/);
});

test("the next step is submitted to the running session with no key press from the user", async () => {
  const h = await harness();
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");

  const result = await h.manager.prompt(s.id, { action: "implement" });
  expect(result.id).toBe(s.id);
  expect(result.submitted).toBe(true);
  // The agent has it: nobody wrote an Enter into the terminal, the submission did.
  await waitFor(() => seen.text().includes("you said: implement upgrade-runtime"), "the prompt the agent received");
  expect(h.manager.list().filter((x) => x.state === "running")).toHaveLength(1);
});

test("a next step an agent never shows is left typed: no Enter, nothing confirmed, and the action is still recorded", async () => {
  const h = await harness({ agent: { command: [FAKE_AGENT, "--menu", "{prompt}"] } });
  const manager = h.newManager({ submitTimings: { echoTimeoutMs: 600, settleMs: 20 } });
  managers.push(manager);
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(manager, s.id);
  await waitFor(() => seen.text().includes("Enter to confirm"), "the menu");

  const result = await manager.prompt(s.id, { action: "implement" });
  expect(result.submitted).toBe(false);
  expect(result.action).toBe("implement"); // what the user asked for, whether or not it was submitted
  await sleep(200);
  expect(seen.text()).not.toContain("menu confirmed by Enter");
  expect(manager.get(s.id).state).toBe("running");
});

test("prompt refusals: stage, unknown action, not running, feature off", async () => {
  const h = await harness();
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const refused = async (action: unknown, id = s.id) => {
    try {
      await h.manager.prompt(id, { action });
    } catch (err) {
      return (err as { status?: number }).status;
    }
    return 0;
  };
  expect(await refused("draft")).toBe(400); // every artifact of the fixture's change is done
  expect(await refused("archive")).toBe(400); // not because it is Archive: the change is not `Done` yet
  expect(await refused("ship")).toBe(400);
  expect(await refused("implement", "nope")).toBe(404);

  h.config.agentSessions.enabled = false;
  expect(await refused("implement")).toBe(403);
  h.config.agentSessions.enabled = true;

  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  expect(await refused("implement")).toBe(409);
});

test("the next step carries the profile's additional instructions for that action", async () => {
  const h = await harness({ agent: { promptSuffixes: { implement: "Run the linter before you finish." } } });
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  // The opening prompt already carried it, as one argument.
  expect(seen.text()).toContain("implement upgrade-runtime Run the linter before you finish.");

  expect((await h.manager.prompt(s.id, { action: "implement" })).submitted).toBe(true);
  await waitFor(() => seen.text().includes("you said: implement upgrade-runtime Run the linter before you finish."), "the composed prompt the agent received");
});

test("additional instructions for an action with no prompt leave it unavailable, and are sent nowhere", async () => {
  const h = await harness({ agent: { prompts: { draft: "draft {change}" }, promptSuffixes: { implement: "Run the linter before you finish." } } });
  managers.push(h.manager);
  // Implement is available for the fixture's change, but the agent has no Implement prompt: the suffix does not stand in for one.
  expect(h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).rejects.toThrow(/no "implement" prompt configured/);
  expect(h.manager.list()).toHaveLength(0);
  expect(startersFor(h.config, changeOf(h, "upgrade-runtime"))).toEqual([]);
});

test("a draft session takes the implement prompt once the change is ready, and records it", async () => {
  const h = await harness();
  managers.push(h.manager);
  const change = changeOf(h, "upgrade-runtime");
  const artifacts = change.artifacts;
  Object.assign(change, { stage: "drafts", artifacts: artifacts.map((a, i) => (i === 0 ? { ...a, status: "ready" } : a)) });
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "draft" });
  expect(s.action).toBe("draft");
  Object.assign(change, { stage: "ready", artifacts }); // the agent finished drafting; the scanner noticed
  expect((await h.manager.prompt(s.id, { action: "implement" })).action).toBe("implement");
});

test("one open session per change: opening any action returns the running session, and Archive gets no worktree of its own", async () => {
  const h = await harness();
  managers.push(h.manager);
  const a = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect((await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).id).toBe(a.id);
  Object.assign(changeOf(h, "upgrade-runtime"), { stage: "done" });
  // The action asked for makes no difference: Archive used to open a second session in a worktree of its own.
  expect((await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "archive" })).id).toBe(a.id);
  expect(h.manager.list().filter((x) => x.state === "running")).toHaveLength(1);
  expect(existsSync(join(worktreesDir(), h.repoId, "archive-upgrade-runtime"))).toBe(false);
});

test("Archive goes into the running session: submitted there, one session, no archive worktree", async () => {
  const h = await harness();
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");

  Object.assign(changeOf(h, "upgrade-runtime"), { stage: "done" });
  const result = await h.manager.prompt(s.id, { action: "archive" });
  expect([result.id, result.submitted, result.action]).toEqual([s.id, true, "archive"]);
  await waitFor(() => seen.text().includes("you said: archive upgrade-runtime"), "the prompt the agent received");
  expect(h.manager.list().filter((x) => x.state === "running")).toHaveLength(1);
  expect(existsSync(join(worktreesDir(), h.repoId, "archive-upgrade-runtime"))).toBe(false);
});

test("a session that was started as Archive takes the next step the stage allows", async () => {
  const h = await harness({ agent: { prompts: { implement: "implement {change}", validate: "validate {change}", archive: "archive {change}" } } });
  managers.push(h.manager);
  // `confirm-retention` is Done with a task awaiting confirmation, so both Archive and Validate are available for it.
  const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "archive" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");

  const result = await h.manager.prompt(s.id, { action: "validate" });
  expect([result.id, result.submitted, result.action]).toEqual([s.id, true, "validate"]);
  expect(h.manager.list().filter((x) => x.state === "running")).toHaveLength(1);
});

test("a folder without git keeps one agent: the running session is returned, with no second agent in the folder", async () => {
  const h = await harness({ git: false });
  managers.push(h.manager);
  const a = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(a.inPlace).toBe(true);
  expect(a.worktreePath).toBe(h.repoPath);
  Object.assign(changeOf(h, "upgrade-runtime"), { stage: "done" });
  // Nothing about an in-place session is a worktree, so only the per-change rule keeps a second agent out of the folder.
  expect((await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "archive" })).id).toBe(a.id);
  expect(h.manager.list().filter((x) => x.state === "running")).toHaveLength(1);
});

test("API: the prompt route is guarded, and the worktree route reports the work status as it is now", async () => {
  const h = await harness();
  managers.push(h.manager);
  const state: AppState = { config: h.config, scanner: new Scanner(() => h.config, { persist: false }, h.snapshot), sessions: h.manager };
  const handle = createFetchHandler({ state, indexHtml: "" });
  const post = (path: string, body: unknown, origin = "http://127.0.0.1:4173") => handle(new Request(`http://127.0.0.1:4173${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }));

  const s = (await (await post("/api/sessions", { repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).json()) as Session;
  expect((await post(`/api/sessions/${s.id}/prompt`, { action: "implement" }, "https://evil.example")).status).toBe(403);
  expect((await post(`/api/sessions/${s.id}/prompt`, { action: "implement" })).status).toBe(200);
  Object.assign(changeOf(h, "upgrade-runtime"), { stage: "done" });
  expect((await post(`/api/sessions/${s.id}/prompt`, { action: "archive" })).status).toBe(200);

  await h.manager.worktrees(); // fill the list's cache, which must not be what the dialog sees
  await writeFile(join(s.worktreePath, "fresh.txt"), "x");
  const status = (await (await handle(new Request(`http://127.0.0.1:4173/api/sessions/${s.id}/worktree`))).json()) as { removable: boolean; work: { state: string; count: number } };
  expect(status.work).toMatchObject({ state: "uncommitted", count: 1 });
  expect(status.removable).toBe(false);
});

test("Validate is the next step of a validating change: typed into its running session, and Implement is not offered", async () => {
  const h = await harness({ agent: { prompts: { implement: "implement {change}", validate: "validate {change}", archive: "archive {change}" } } });
  managers.push(h.manager);
  const card = changeOf(h, "confirm-retention");
  expect([card.column, card.subState]).toEqual(["Done", "validate"]);

  const cfg = { ...h.config, agentSessions: { ...h.config.agentSessions, agents: [fakeProfile({ prompts: { implement: "i {change}", validate: "v {change}", archive: "a {change}" } })] } };
  expect(startersFor(cfg, card)).toEqual(["validate", "archive"]);
  // Without a Validate prompt the card is left with Archive alone.
  const noValidate = { ...cfg, agentSessions: { ...cfg.agentSessions, agents: [fakeProfile({ prompts: { implement: "i {change}", archive: "a {change}" } })] } };
  expect(startersFor(noValidate, card)).toEqual(["archive"]);

  // Whatever the starter, it goes into the change's running session.
  const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "validate" });
  expect(nextStepFor(h.manager.list().filter((x) => !x.console) as ChangeSession[], h.repoId, "confirm-retention")).toEqual({ promptSessionId: s.id });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  expect((await h.manager.prompt(s.id, { action: "validate" })).submitted).toBe(true);
  await waitFor(() => seen.text().includes("you said: validate confirm-retention"), "the prompt the agent received");
  // Nothing is left to implement in `Done`, so that step is refused even into a running session.
  expect(h.manager.prompt(s.id, { action: "implement" })).rejects.toThrow(/not available/);
});

test("API: the session list marks the presets that are not configured with whether their executable was found", async () => {
  const h = await harness();
  managers.push(h.manager);
  const state: AppState = { config: h.config, scanner: new Scanner(() => h.config, { persist: false }, h.snapshot), sessions: h.manager };
  const handle = createFetchHandler({ state, indexHtml: "" });
  const presets = async () => ((await (await handle(new Request("http://127.0.0.1:4173/api/sessions"))).json()) as { presets: AgentAvailability[] }).presets;

  // A PATH holding only a fake `agy`, so what else is installed on this machine does not matter.
  const bin = await tempDir("osd-bin-");
  await writeFile(join(bin, "agy"), "#!/bin/sh\nexit 0\n");
  await chmod(join(bin, "agy"), 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = bin;
  try {
    h.config.agentSessions.agents.push(structuredClone(CLAUDE_PROFILE));
    expect(await presets()).toEqual([
      { id: "codex", name: "Codex", available: false },
      { id: "agy", name: "Antigravity", available: true, path: join(bin, "agy") },
    ]);
    // Found is only a mark: nothing was added to the configuration.
    expect(h.config.agentSessions.agents.map((a) => a.id)).toEqual(["fake", "claude"]);

    h.config.agentSessions.agents.pop();
    expect((await presets()).map((p) => p.id)).toEqual(["claude", "codex", "agy"]);
  } finally {
    process.env.PATH = savedPath;
  }
});

test("an Archive sent into a running session that cannot be typed is refused: nothing typed, action and auto-merge record unchanged", async () => {
  const h = await harness({ agent: { prompts: { draft: "draft {change}", implement: "implement {change}", validate: "validate {change}", archive: "archive {change}" } } });
  h.config.repos[0].agent = { enabled: true, autoMergeDocs: true };
  managers.push(h.manager);
  const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "validate" });
  const seen = await watch(h.manager, s.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  // Docs-only so far, so the composed Archive prompt would carry the auto-merge instruction — and is too long to type.
  h.config.agentSessions.agents[0].promptSuffixes = { archive: "x ".repeat(2100) };
  await expect(h.manager.prompt(s.id, { action: "archive" })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/4096/) });
  const after = h.manager.get(s.id) as ChangeSession;
  expect([after.action, after.autoMergeAskedAt, after.state]).toEqual(["validate", undefined, "running"]);
  await sleep(300);
  expect(seen.text()).not.toContain("you said:");
});
