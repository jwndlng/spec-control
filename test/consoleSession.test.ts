import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consoleDir } from "../src/server/paths.ts";
import { launchWithoutPrompt } from "../src/server/sessions/agents.ts";
import { consoleFolderProblem } from "../src/server/sessions/consoleFolder.ts";
import type { SessionManager } from "../src/server/sessions/manager.ts";
import type { ChangeSession } from "../src/shared/types.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { FAKE_AGENT, fakeProfile, harness, waitFor, watch } from "./sessionHelpers.ts";

// Real processes in pseudo-terminals; slow CI runners need more than the 5 s default.
setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: SessionManager[] = [];
const track = (m: SessionManager) => {
  managers.push(m);
  return m;
};

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

test("the console's command leaves out every argument that would carry a prompt", () => {
  expect(launchWithoutPrompt(fakeProfile({ command: ["claude", "{prompt}"] }))).toEqual(["claude"]);
  expect(launchWithoutPrompt(fakeProfile({ command: ["my-agent-cli", "--task={prompt}", "--color"] }))).toEqual(["my-agent-cli", "--color"]);
  expect(launchWithoutPrompt(fakeProfile({ command: ["plain-agent"] }))).toEqual(["plain-agent"]);
});

test("opens in the default console folder without a prompt, once, and never as change work", async () => {
  const reported: unknown[] = [];
  const h = await harness();
  const manager = track(h.newManager({ onActivity: (_s, what) => reported.push(what) }));
  const { session, created } = await manager.openConsole();
  expect(created).toBe(true);
  expect(session).toMatchObject({ console: true, state: "running", agentId: "fake" });
  expect(session.repoId).toBeUndefined();
  expect(session.branch).toBeUndefined();
  expect(session.worktreePath).toBe(consoleDir());
  expect(existsSync(consoleDir())).toBe(true);

  const view = await watch(manager, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  // The fake agent prints its arguments: none, because the only `{prompt}` argument was left out and nothing is typed.
  expect(view.text()).toContain("args=[]");
  expect(view.text()).toContain(`cwd=${await realpath(consoleDir())}`);

  // One at a time: a second open attaches instead of starting another process.
  const again = await manager.openConsole();
  expect(again).toEqual({ session, created: false });
  expect(manager.list().filter((s) => s.console)).toHaveLength(1);

  // Change-only requests are refused, and nothing is typed into the terminal because of them.
  await expect(manager.ship(session.id)).rejects.toMatchObject({ status: 409 });
  await expect(manager.prompt(session.id, { action: "implement" })).rejects.toMatchObject({ status: 409 });
  await expect(manager.worktreeStatus(session.id)).rejects.toMatchObject({ status: 409 });
  expect(await manager.worktrees()).toEqual([]);

  // Ending it ends the agent and nothing else.
  const closed = await manager.close(session.id, { removeWorktree: true });
  expect(closed.session.state).toBe("exited");
  expect(closed.worktree).toBeUndefined();
  expect(existsSync(consoleDir())).toBe(true);
  expect(reported).toEqual([]); // the activity log is about changes; the console never reaches it
  view.detach();
});

test("resumes in the same folder and starts a new console after the previous one ended", async () => {
  const h = await harness();
  const manager = track(h.manager);
  const { session } = await manager.openConsole();
  await manager.close(session.id);
  const resumed = await manager.resume(session.id);
  expect(resumed.state).toBe("running");
  const view = await watch(manager, session.id);
  await waitFor(() => view.text().includes('args=["--resumed"]'), "resume command");
  view.detach();

  // While it runs, opening returns it; once ended, a new one starts and the old record stays.
  expect((await manager.openConsole()).session.id).toBe(session.id);
  await manager.close(session.id);
  const next = await manager.openConsole();
  expect(next.created).toBe(true);
  expect(next.session.id).not.toBe(session.id);
  expect(manager.get(session.id).state).toBe("exited");
  // Resuming the ended one now would make two consoles run.
  await expect(manager.resume(session.id)).rejects.toMatchObject({ status: 409 });
});

test("launch arguments go after the executable of the console and of its resume command", async () => {
  const h = await harness({ agent: { launchArgs: ["--mode", "auto"] } });
  const manager = track(h.manager);
  const { session } = await manager.openConsole();
  const view = await watch(manager, session.id);
  await waitFor(() => view.text().includes('args=["--mode","auto"]'), "console start with launch arguments");
  view.detach();
  await manager.close(session.id);
  await manager.resume(session.id);
  const resumed = await watch(manager, session.id);
  await waitFor(() => resumed.text().includes('args=["--mode","auto","--resumed"]'), "resume with launch arguments");
  resumed.detach();
});

test("runs the console agent when one is chosen, and the default agent otherwise", async () => {
  const h = await harness();
  const manager = track(h.manager);
  h.config.agentSessions.agents.push(fakeProfile({ id: "second", name: "Second Agent", command: [FAKE_AGENT, "--second", "--task={prompt}"] }));
  h.config.agentSessions.consoleAgent = "second";
  const { session } = await manager.openConsole();
  expect(session).toMatchObject({ agentId: "second", agentName: "Second Agent" });
  const view = await watch(manager, session.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent start");
  expect(view.text()).toContain('args=["--second"]');
  view.detach();
  // Change sessions of a project without an agent of its own still start the default.
  const change = (await manager.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" })) as ChangeSession;
  expect(change.agentId).toBe("fake");
  await manager.close(session.id);

  h.config.agentSessions.consoleAgent = undefined;
  expect((await manager.openConsole()).session.agentId).toBe("fake");
});

test("a chosen console agent that is not installed is refused by its name", async () => {
  const h = await harness();
  const manager = track(h.manager);
  h.config.agentSessions.agents.push(fakeProfile({ id: "absent", name: "Absent Agent", command: ["no-such-agent-osd", "{prompt}"] }));
  h.config.agentSessions.consoleAgent = "absent";
  await expect(manager.openConsole()).rejects.toMatchObject({ status: 503, message: expect.stringContaining("Absent Agent was not found (no-such-agent-osd)") });
  expect(manager.list()).toEqual([]);
});

test("a running console keeps its agent, and Resume continues with it after the choice changed", async () => {
  const h = await harness();
  const manager = track(h.manager);
  h.config.agentSessions.agents.push(fakeProfile({ id: "second", name: "Second Agent", command: [FAKE_AGENT, "--second", "{prompt}"], resumeCommand: [FAKE_AGENT, "--second-resumed"] }));
  const { session } = await manager.openConsole();
  expect(session.agentId).toBe("fake");
  h.config.agentSessions.consoleAgent = "second";
  // Still the same console, with the agent it was started with.
  expect((await manager.openConsole())).toMatchObject({ session: { id: session.id, agentId: "fake" }, created: false });
  await manager.close(session.id);
  const resumed = await manager.resume(session.id);
  expect(resumed.agentId).toBe("fake");
  const view = await watch(manager, session.id);
  await waitFor(() => view.text().includes('args=["--resumed"]'), "the original agent's resume command");
  view.detach();
  await manager.close(session.id);
  // The choice applies to the next console started.
  expect((await manager.openConsole()).session.agentId).toBe("second");
});

test("runs next to change sessions without touching them", async () => {
  const h = await harness();
  const manager = track(h.manager);
  const change = (await manager.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" })) as ChangeSession;
  const { session } = await manager.openConsole();
  expect(manager.get(change.id).state).toBe("running");
  expect(session.worktreePath).not.toBe(change.worktreePath);
  // The change session is found by its change, never by the console.
  expect((await manager.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" })).id).toBe(change.id);
});

test("refused while agent sessions are off, when the agent is missing, and for an unusable folder", async () => {
  const off = await harness({ enabled: false });
  await expect(track(off.manager).openConsole()).rejects.toMatchObject({ status: 403 });

  const missing = await harness({ agent: { command: ["no-such-agent-osd", "{prompt}"] } });
  await expect(track(missing.manager).openConsole()).rejects.toMatchObject({ status: 503 });

  const h = await harness();
  const manager = track(h.manager);
  h.config.agentSessions.consoleDir = join(h.repoPath, "openspec");
  await expect(manager.openConsole()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("inside a tracked repository") });
  h.config.agentSessions.consoleDir = join(await tempDir("osd-gone-"), "deleted");
  await expect(manager.openConsole()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("does not exist") });
  expect(manager.list()).toEqual([]); // nothing was started or recorded
});

test("a configured folder may hold repositories but may not be inside one", async () => {
  const h = await harness();
  const parent = join(h.repoPath, "..");
  expect(consoleFolderProblem(parent, h.config)).toBeUndefined();
  expect(consoleFolderProblem(h.repoPath, h.config)).toContain("demo-ops");
  expect(consoleFolderProblem(join(h.repoPath, "openspec"), h.config)).toContain("inside a tracked repository");
  expect(consoleFolderProblem(join(parent, "nope"), h.config)).toContain("does not exist");
  const file = join(parent, "a-file");
  await writeFile(file, "x");
  expect(consoleFolderProblem(file, h.config)).toContain("not a directory");
  // A repository that is not tracked does not count.
  expect(consoleFolderProblem(h.repoPath, { repos: h.config.repos.map((r) => ({ ...r, enabled: false })) })).toBeUndefined();

  const manager = track(h.manager);
  h.config.agentSessions.consoleDir = parent;
  const { session } = await manager.openConsole();
  expect(session.worktreePath).toBe(parent);
});

test("no git command runs for the console, and stopping the dashboard ends it", async () => {
  const bin = await tempDir("osd-fake-git-");
  const log = join(bin, "calls.log");
  await writeFile(join(bin, "git"), `#!/bin/sh\necho "$@" >> "${log}"\nexit 1\n`);
  await chmod(join(bin, "git"), 0o755);
  const h = await harness(); // the fixture repository is set up with the real git first
  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  try {
    const manager = h.manager;
    const { session } = await manager.openConsole();
    await manager.close(session.id);
    await manager.resume(session.id);
    await manager.shutdown();
    expect(manager.get(session.id)).toMatchObject({ state: "exited", error: expect.stringContaining("dashboard was stopped") });
  } finally {
    process.env.PATH = previous;
  }
  expect(existsSync(log) ? await readFile(log, "utf8") : "").toBe("");
  await rm(bin, { recursive: true, force: true });
});

test("a console record is stored like any session and survives a restart as ended", async () => {
  const h = await harness();
  const manager = track(h.manager);
  const { session } = await manager.openConsole();
  const second = track(h.newManager());
  await second.init();
  expect(second.get(session.id)).toMatchObject({ console: true, worktreePath: consoleDir(), state: "exited" });
});
