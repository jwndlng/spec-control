import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionsDir, worktreesDir } from "../src/server/paths.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { SessionError, SessionManager } from "../src/server/sessions/manager.ts";
import { SessionStore } from "../src/server/sessions/store.ts";
import { availableActions, type ChangeSnapshot, type Config, type SessionAction, type Snapshot } from "../src/shared/types.ts";
import { checkWorktreeRemovable, copyChangeIfMissing, ensureWorktree, removeWorktree } from "../src/server/sessions/worktree.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { FAKE_AGENT, git, harness, tempGitRepo, waitFor, watch } from "./sessionHelpers.ts";

// These tests start real processes in pseudo-terminals and open sockets; slow CI runners need more than the 5 s default.
setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: SessionManager[] = [];
const track = <T extends { manager: SessionManager }>(h: T): T => {
  managers.push(h.manager);
  return h;
};

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

test("worktrees: created from the default branch, existing branch reused, existing worktree reused, change copied in", async () => {
  const repo = await tempGitRepo();
  const home = await realpath(await tempDir("osd-wt-"));
  const wt = join(home, "cache-api-calls");
  expect(await ensureWorktree(repo, wt, "feat/cache-api-calls")).toMatchObject({ created: true, base: "HEAD" });
  expect(git(wt, "branch", "--show-current")).toBe("feat/cache-api-calls");
  expect(existsSync(join(wt, "openspec", "changes", "cache-api-calls", "tasks.md"))).toBe(true);
  expect(await ensureWorktree(repo, wt, "feat/cache-api-calls")).toEqual({ created: false });
  expect(git(repo, "branch", "--show-current")).toBe("main"); // the main checkout is not switched
  expect(git(repo, "status", "--porcelain")).toBe(""); // and sees no new files: the worktree lives outside it

  git(repo, "branch", "feat/already-there");
  expect(await ensureWorktree(repo, join(home, "already"), "feat/already-there")).toEqual({ created: true });

  await mkdir(join(home, "plain-dir"));
  await expect(ensureWorktree(repo, join(home, "plain-dir"), "feat/x")).rejects.toThrow(/not a git worktree/);

  // a change that exists only uncommitted in the main checkout
  await mkdir(join(repo, "openspec", "changes", "brand-new"), { recursive: true });
  await writeFile(join(repo, "openspec", "changes", "brand-new", "prompt.md"), "do the thing\n");
  expect(await copyChangeIfMissing(repo, wt, "brand-new")).toBe(true);
  expect(await readFile(join(wt, "openspec", "changes", "brand-new", "prompt.md"), "utf8")).toBe("do the thing\n");
  expect(await copyChangeIfMissing(repo, wt, "brand-new")).toBe(false);
});

test("worktree removal: refused when dirty or holding commits that exist nowhere else, done when clean", async () => {
  const repo = await tempGitRepo();
  const wt = join(await realpath(await tempDir("osd-wt-")), "x");
  await ensureWorktree(repo, wt, "feat/x");
  await writeFile(join(wt, "scratch.txt"), "wip\n");
  expect(await checkWorktreeRemovable(wt)).toMatchObject({ removable: false, reason: expect.stringContaining("uncommitted") });
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "work");
  expect(await checkWorktreeRemovable(wt)).toMatchObject({ removable: false, reason: expect.stringContaining("only on this worktree") });
  expect((await removeWorktree(repo, wt)).removable).toBe(false);
  git(repo, "merge", "-q", "feat/x");
  expect(await removeWorktree(repo, wt)).toEqual({ removable: true });
  expect(existsSync(wt)).toBe(false);
});

test("worktree removal without unlocking leaves a locked worktree alone", async () => {
  const repo = await tempGitRepo();
  const wt = join(await realpath(await tempDir("osd-wt-")), "held");
  await ensureWorktree(repo, wt, "feat/held");
  git(repo, "worktree", "lock", "--reason", "in use", wt);
  expect((await removeWorktree(repo, wt, true, false)).removable).toBe(false);
  expect(existsSync(wt)).toBe(true);
  expect(git(repo, "worktree", "list", "--porcelain")).toContain("locked in use");
});

test("a session is the agent in a terminal, in its own worktree: start, type, exit", async () => {
  const h = track(await harness());
  process.env.ANTHROPIC_API_KEY = "must-not-reach-the-agent";
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(s).toMatchObject({ state: "running", agentName: "Fake Agent", branch: "feat/upgrade-runtime", resumable: true });
  expect(s.worktreePath).toBe(join(worktreesDir(), h.repoId, "upgrade-runtime"));
  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent banner");
  expect(view.text()).toContain('args=["implement upgrade-runtime"]');
  expect(view.text()).toContain(`cwd=${await realpath(s.worktreePath)}`); // the process reports its resolved directory
  expect(view.text()).toContain("tty=true");
  expect(view.text()).toContain("key=false");

  // A resize reaches the agent as an asynchronous signal, so ask until it reports the new width rather than racing it.
  h.manager.resize(s.id, 90, 20);
  await waitFor(async () => {
    h.manager.write(s.id, "width?\r");
    await new Promise((r) => setTimeout(r, 100));
    return view.text().includes("(cols=90)");
  }, "the agent sees the resized terminal");
  h.manager.write(s.id, "hello there\r");
  await waitFor(() => view.text().includes("you said: hello there"), "echo of typed input");
  expect(h.manager.get(s.id).lastOutputAt).toBeTruthy();

  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  expect(h.manager.get(s.id).exitCode).toBe(0);
  await waitFor(() => view.ended(), "viewers are told");
  expect(git(h.repoPath, "branch", "--show-current")).toBe("main");
  expect(git(h.repoPath, "status", "--porcelain")).toBe("");

  // a viewer arriving after the end still sees what happened
  const late = await watch(h.manager, s.id);
  expect(late.text()).toContain("you said: hello there");
});

test("a command without a prompt placeholder gets the prompt typed into it", async () => {
  const h = track(await harness({ agent: { command: [FAKE_AGENT] } }));
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes("you said: implement upgrade-runtime"), "typed prompt");
  expect(view.text()).toContain("args=[]");
});

test("one open session per change; an Archive that opens one gets its own worktree and branch; resume continues in place", async () => {
  const h = track(await harness());
  const a = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect((await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).id).toBe(a.id);

  // A change with no session of its own: Archive opens one, and that is still where the archive worktree comes from.
  const arch = await h.manager.open({ repoId: h.repoId, change: "configurable-builder", action: "archive" });
  expect(arch).toMatchObject({ branch: "chore/archive-configurable-builder" });
  expect(arch.worktreePath.endsWith("archive-configurable-builder")).toBe(true);

  await h.manager.close(a.id);
  expect(h.manager.get(a.id).state).toBe("exited");
  const resumed = await h.manager.resume(a.id);
  expect(resumed.state).toBe("running");
  const view = await watch(h.manager, a.id);
  await waitFor(() => view.text().includes('args=["--resumed"]'), "resumed agent");
  expect(view.text()).toContain(`cwd=${await realpath(a.worktreePath)}`);
});

test("archive is offered once the delta is already in the main specs: the change stays Done", async () => {
  const h = track(await harness());
  const delta = await readFile(join(h.repoPath, "openspec", "changes", "bump-toolchain", "specs", "bump-toolchain", "spec.md"), "utf8");
  await mkdir(join(h.repoPath, "openspec", "specs", "bump-toolchain"), { recursive: true });
  await writeFile(join(h.repoPath, "openspec", "specs", "bump-toolchain", "spec.md"), `# bump-toolchain\n\n## Purpose\n\nToolchain bumps.\n\n${delta.replace("## ADDED Requirements", "## Requirements")}`);
  git(h.repoPath, "add", "-A");
  git(h.repoPath, "commit", "-q", "-m", "sync specs");
  h.snapshot.repos[0] = await scanRepo(h.config.repos[0]);
  expect(h.snapshot.repos[0].changes.find((c) => c.name === "bump-toolchain")).toMatchObject({ specsSynced: true, stage: "done", column: "Done" });

  const arch = await h.manager.open({ repoId: h.repoId, change: "bump-toolchain", action: "archive" });
  expect(arch).toMatchObject({ state: "running", action: "archive", branch: "chore/archive-bump-toolchain" });
  expect(arch.worktreePath.endsWith("archive-bump-toolchain")).toBe(true);
});

test("refusals", async () => {
  const open = (h: { manager: SessionManager; repoId: string }, change: unknown, action: unknown = "implement") => h.manager.open({ repoId: h.repoId, change, action });
  await expect(open(track(await harness({ enabled: false })), "upgrade-runtime")).rejects.toMatchObject({ status: 403 });
  await expect(open(track(await harness({ repoOff: true })), "upgrade-runtime")).rejects.toMatchObject({ status: 403 });
  await expect(open(track(await harness({ agent: { command: ["/nonexistent/agent", "{prompt}"] } })), "upgrade-runtime")).rejects.toMatchObject({ status: 503 });
  await expect(open(track(await harness({ agent: { prompts: { draft: "d {change}" } } })), "upgrade-runtime")).rejects.toMatchObject({ status: 400 }); // no implement prompt
  const h = track(await harness());
  await expect(open(h, "no-such-change")).rejects.toMatchObject({ status: 404 });
  await expect(open(h, "x; rm -rf ~")).rejects.toMatchObject({ status: 400 });
  await expect(open(h, "add-health-endpoint")).rejects.toMatchObject({ status: 400 }); // proposal only
  await expect(open(h, "upgrade-runtime", "archive")).rejects.toMatchObject({ status: 400 }); // not Done
  await expect(open(h, "runbook-repo-field")).rejects.toMatchObject({ status: 404 }); // archived
  // The sub-state decides too: `validate` needs `Done` with an awaiting task, and `Done` has nothing left to implement.
  await expect(open(h, "upgrade-runtime", "validate")).rejects.toThrow(/"validate" is not available/);
  await expect(open(h, "confirm-retention", "implement")).rejects.toThrow(/"implement" is not available/);
  await expect(open(h, "configurable-builder", "validate")).rejects.toMatchObject({ status: 400 }); // Done, but nothing awaits
  expect(h.manager.list()).toEqual([]);
  expect(existsSync(join(worktreesDir(), h.repoId))).toBe(false); // a refused request creates no worktree
});

test("Draft is refused once implementation started, naming the change as past drafting", async () => {
  const h = track(await harness({ agent: { prompts: { draft: "draft {change}", implement: "implement {change}", archive: "archive {change}" } } }));
  const changes = h.snapshot.repos[0].changes.filter((c) => !c.archived);
  for (const stage of ["implementing", "done"] as const) {
    const change = changes.find((c) => c.stage === stage)!;
    // An optional artifact left unwritten is no reason to send an agent back to planning.
    change.artifacts = [...change.artifacts, { id: "design", status: "ready", required: false }];
    await expect(h.manager.open({ repoId: h.repoId, change: change.name, action: "draft" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("past drafting") });
  }
  expect(h.manager.list()).toEqual([]);
  expect(existsSync(join(worktreesDir(), h.repoId))).toBe(false); // a refused request creates no worktree
});

test("a change awaiting validation starts a Validate session and refuses Implement", async () => {
  const h = track(await harness({ agent: { prompts: { implement: "implement {change}", validate: "validate {change}", archive: "archive {change}" } } }));
  const s = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "validate" });
  expect(s).toMatchObject({ state: "running", action: "validate", change: "confirm-retention" });
  await expect(h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "implement" })).rejects.toMatchObject({ status: 400 });
  // Archive is offered for the whole Done column, validating or not — but this change already has a session, so it
  // is that session Archive comes back with, and its prompt goes in through `prompt`, not through a second console.
  const arch = await h.manager.open({ repoId: h.repoId, change: "confirm-retention", action: "archive" });
  expect(arch.id).toBe(s.id);
  expect(existsSync(join(worktreesDir(), h.repoId, "archive-confirm-retention"))).toBe(false);
});

test("a blocked change is refused Implement, naming what it waits for, and may still be drafted", async () => {
  const h = track(await harness({ agent: { prompts: { draft: "draft {change}", implement: "implement {change}" } } }));
  const changes = h.snapshot.repos[0].changes;
  const block = (name: string) => Object.assign(changes.find((c) => c.name === name && !c.archived)!, {
    blocked: true,
    dependsOn: [
      { name: "add-billing-api", state: "waiting" },
      { name: "add-billing-schema", state: "met" },
      { name: "add-billing-scheme", state: "missing" },
    ],
  });
  block("upgrade-runtime");
  block("add-health-endpoint");
  await expect(h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).rejects.toMatchObject({
    status: 400,
    message: "Implement is held back: waits for add-billing-api (waiting), add-billing-scheme (missing)",
  });
  expect(h.manager.list()).toEqual([]);
  expect(existsSync(join(worktreesDir(), h.repoId))).toBe(false); // a refused request creates no worktree
  const draft = await h.manager.open({ repoId: h.repoId, change: "add-health-endpoint", action: "draft" });
  expect(draft).toMatchObject({ state: "running", action: "draft", change: "add-health-endpoint" });
});

test("Fast-forward: one session on the change's branch whose prompt drafts, implements and ships; refused when blocked or planned", async () => {
  const h = track(await harness({ agent: { prompts: { draft: "draft {change}", implement: "implement {change}" } } }));
  h.config.repos[0] = { ...h.config.repos[0], prTitleConvention: "conventional-commits", agent: { enabled: true, autoMergeDocs: true } };
  const changes = h.snapshot.repos[0].changes;
  const drafting = changes.find((c) => !c.archived && availableActions(c).includes("fastForward"))!;
  const planned = changes.find((c) => !c.archived && c.stage === "ready")!;
  await expect(h.manager.open({ repoId: h.repoId, change: planned.name, action: "fastForward" })).rejects.toMatchObject({ status: 400 });

  Object.assign(drafting, { blocked: true, dependsOn: [{ name: "add-billing-api", state: "waiting" }] });
  await expect(h.manager.open({ repoId: h.repoId, change: drafting.name, action: "fastForward" })).rejects.toMatchObject({
    status: 400,
    message: "Fast-forward is held back: waits for add-billing-api (waiting)",
  });
  expect(h.manager.list()).toEqual([]);
  expect(existsSync(join(worktreesDir(), h.repoId))).toBe(false); // a refused request creates no worktree
  Object.assign(drafting, { blocked: false, dependsOn: undefined });

  const s = await h.manager.open({ repoId: h.repoId, change: drafting.name, action: "fastForward" });
  expect(s).toMatchObject({ state: "running", action: "fastForward", branch: `feat/${drafting.name}`, autoMerge: false });
  expect(s.worktreePath).toBe(join(worktreesDir(), h.repoId, drafting.name));
  expect(h.manager.get(s.id)).not.toHaveProperty("autoMergeAskedAt");
  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent banner");
  const args = view.text().replace(/\r?\n/g, "");
  expect(args).toContain(`args=["draft ${drafting.name} This change is fast-forwarded`);
  expect(args).toContain(`implement ${drafting.name} When every task is settled, ship the work without asking me: Ship the work`);
  expect(args).toContain("Title the pull request as a Conventional Commit");
  expect(args).not.toContain("auto-merge");
});

test("a crash is recorded; shutdown ends agents; a restarted dashboard knows nothing is running", async () => {
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "banner");
  h.manager.write(s.id, "crash\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "crash");
  expect(h.manager.get(s.id).exitCode).toBe(3);

  const t = await h.manager.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" });
  await h.manager.shutdown();
  expect(h.manager.get(t.id)).toMatchObject({ state: "exited", error: expect.stringContaining("stopped") });

  const store = new SessionStore();
  const stale = { ...h.manager.get(t.id), id: "00000000-0000-4000-8000-000000000009", state: "running" as const, error: undefined };
  await store.saveMeta(stale);
  const next = h.newManager();
  managers.push(next);
  await next.init();
  expect(next.get(stale.id)).toMatchObject({ state: "exited", error: expect.stringContaining("restarted") });
  await expect(next.remove(stale.id)).resolves.toBeUndefined();
});

test("a change that lives only in a worktree on another branch is copied into the session's worktree from there", async () => {
  const h = track(await harness());
  const theirs = join(h.repoPath, ".claude", "worktrees", "compliance");
  git(h.repoPath, "worktree", "add", "-q", "-b", "wip/compliance", theirs);
  await mkdir(join(theirs, "openspec", "changes", "ledger-export"), { recursive: true });
  await writeFile(join(theirs, "openspec", "changes", "ledger-export", ".openspec.yaml"), "schema: spec-driven\ncreated: 2026-09-01\n");
  await writeFile(join(theirs, "openspec", "changes", "ledger-export", "proposal.md"), "# only here\n");
  h.snapshot.repos[0] = await scanRepo(h.config.repos[0]);
  expect(h.snapshot.repos[0].changes.find((c) => c.name === "ledger-export")?.checkout?.path).toBe(await realpath(theirs));

  const s = await h.manager.open({ repoId: h.repoId, change: "ledger-export", action: "draft" });
  expect([s.adopted, s.branch, s.worktreePath]).toEqual([undefined, "feat/ledger-export", join(worktreesDir(), h.repoId, "ledger-export")]);
  expect(await readFile(join(s.worktreePath, "openspec", "changes", "ledger-export", "proposal.md"), "utf8")).toBe("# only here\n");
  expect(existsSync(join(h.repoPath, "openspec", "changes", "ledger-export"))).toBe(false); // the main checkout is left alone
});

test("when the session's branch is already checked out in someone's worktree, the session adopts it and never removes it", async () => {
  const h = track(await harness());
  const theirs = await realpath(await tempDir("osd-theirs-")).then((d) => join(d, "upgrade-runtime")); // outside the repository
  git(h.repoPath, "worktree", "add", "-q", "-b", "feat/upgrade-runtime", theirs);
  const listedBefore = git(h.repoPath, "worktree", "list", "--porcelain");

  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect([s.adopted, s.worktreePath, s.branch]).toEqual([true, theirs, "feat/upgrade-runtime"]);
  expect(existsSync(join(worktreesDir(), h.repoId, "upgrade-runtime"))).toBe(false); // none was created
  expect(git(h.repoPath, "worktree", "list", "--porcelain")).toBe(listedBefore);
  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes(`cwd=${theirs}`), "agent running in the adopted worktree");

  // clean and fully merged — and still not ours to remove
  expect(await h.manager.worktreeStatus(s.id)).toMatchObject({ removable: false });
  const closed = await h.manager.close(s.id, { removeWorktree: true });
  expect(closed.worktree).toMatchObject({ removable: false });
  expect(closed.worktree?.reason).toContain("not created by the dashboard");
  expect(existsSync(theirs)).toBe(true);

  // survives a restart of the dashboard, and resume continues there
  const again = h.newManager();
  managers.push(again);
  await again.init();
  expect(again.get(s.id).adopted).toBe(true);
  expect((await again.resume(s.id)).worktreePath).toBe(theirs);

  // once its owner removed it, there is nowhere to continue — and nothing is re-created at their path
  await again.close(s.id);
  git(h.repoPath, "worktree", "remove", "--force", theirs);
  await expect(again.resume(s.id)).rejects.toThrow("no longer exists");
  expect(existsSync(theirs)).toBe(false);
});

test("archive never adopts, and the main checkout is never adopted", async () => {
  const h = track(await harness());
  const theirs = join(h.repoPath, ".claude", "worktrees", "arch");
  git(h.repoPath, "worktree", "add", "-q", "-b", "chore/archive-configurable-builder", theirs);
  await expect(h.manager.open({ repoId: h.repoId, change: "configurable-builder", action: "archive" })).rejects.toThrow(); // git's refusal, as before

  git(h.repoPath, "checkout", "-q", "-b", "feat/upgrade-runtime"); // the main checkout itself sits on the session's branch
  await expect(h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).rejects.toThrow();
  expect(h.manager.list().some((s) => s.worktreePath === h.repoPath)).toBe(false);
});

const FAST_SUBMIT = { submitTimings: { echoTimeoutMs: 600, settleMs: 20 } };

test("submitted text reaches an agent that shows it, with Enter as a separate write", async () => {
  const h = await harness();
  const manager = h.newManager(FAST_SUBMIT);
  managers.push(manager);
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const view = await watch(manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent banner");
  expect(await manager.submit(s.id, "Yes, go ahead")).toEqual({ submitted: true });
  await waitFor(() => view.text().includes("you said: Yes, go ahead"), "the agent received the submitted line");
});

test("an agent showing a menu gets the text but never an Enter, and keeps running", async () => {
  const h = await harness({ agent: { command: [FAKE_AGENT, "--menu", "{prompt}"] } });
  const manager = h.newManager(FAST_SUBMIT);
  managers.push(manager);
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const view = await watch(manager, s.id);
  await waitFor(() => view.text().includes("Enter to confirm"), "the menu");
  expect(await manager.submit(s.id, "Yes, go ahead")).toEqual({ submitted: false });
  await new Promise((r) => setTimeout(r, 200));
  expect(view.text()).not.toContain("menu confirmed by Enter");
  expect(manager.get(s.id).state).toBe("running");
  // a real Enter from the keyboard still confirms: only the blind one is withheld
  manager.write(s.id, "\r");
  await waitFor(() => view.text().includes("menu confirmed by Enter"), "a typed Enter reaches the menu");
});

test("an opening prompt typed after start-up is not sent into a dialog", async () => {
  const h = await harness({ agent: { command: [FAKE_AGENT, "--menu"] } });
  const manager = h.newManager(FAST_SUBMIT);
  managers.push(manager);
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const view = await watch(manager, s.id);
  await waitFor(() => view.text().includes("Enter to confirm"), "the menu");
  await new Promise((r) => setTimeout(r, 150 + 600 + 300)); // start-up delay + echo timeout + margin
  expect(view.text()).not.toContain("menu confirmed by Enter");
  expect(manager.get(s.id).state).toBe("running");
});

test("submissions to one session run one after another", async () => {
  const h = await harness();
  const manager = h.newManager(FAST_SUBMIT);
  managers.push(manager);
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const view = await watch(manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent banner");
  const results = await Promise.all([manager.submit(s.id, "first message"), manager.submit(s.id, "second message")]);
  expect(results).toEqual([{ submitted: true }, { submitted: true }]);
  await waitFor(() => view.text().includes("you said: second message"), "both lines");
  expect(view.text()).toContain("you said: first message (");
  expect(view.text()).toContain("you said: second message (");
});

test("a text longer than the terminal's input queue reaches a paste-detecting agent whole, shown as typed, and is submitted", async () => {
  const h = await harness({ agent: { command: [FAKE_AGENT, "--paste-threshold", "512", "{prompt}"] } });
  const manager = h.newManager(FAST_SUBMIT);
  managers.push(manager);
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const view = await watch(manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent banner");
  // Over 1024 bytes with multi-byte characters, like an Archive prompt with the docs auto-merge and record instructions.
  const text = Array.from({ length: 24 }, (_, i) => `Sentence ${i} — of a long prompt;`).join(" ").repeat(2);
  expect(new TextEncoder().encode(text).length).toBeGreaterThan(1024);
  expect(await manager.submit(s.id, text)).toEqual({ submitted: true });
  await waitFor(() => view.text().includes("received line of"), "the agent received the submitted line");
  expect(view.text()).toContain(`received line of ${text.length} characters, hash ${Bun.hash(text).toString(16)}`);
  expect(view.text()).not.toContain("[pasted");
});

test("submit refuses what is not plain text, and sessions that are not running", async () => {
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  // Always a rejected promise, never a synchronous throw: thrown from the typed-prompt timer it would end the dashboard.
  for (const bad of ["", "two\rlines", `esc${String.fromCharCode(27)}[A`, 7, undefined]) await expect(h.manager.submit(s.id, bad)).rejects.toMatchObject({ status: 400 });
  h.manager.write(s.id, "exit\r");
  await waitFor(() => h.manager.get(s.id).state === "exited", "exit");
  await expect(h.manager.submit(s.id, "Yes, go ahead")).rejects.toMatchObject({ status: 409 });
  await expect(h.manager.submit("no-such-session", "Yes, go ahead")).rejects.toMatchObject({ status: 404 });
});

test("a typed opening prompt is typed as one line; one that cannot be typed starts nothing and stops nothing", async () => {
  const h = await harness({ agent: { command: [FAKE_AGENT], prompts: { draft: "draft {change}", implement: "implement {change}\nand run the tests", archive: "archive {change}" } } });
  const manager = h.newManager(FAST_SUBMIT);
  managers.push(manager);
  // A second session, running all along, that must not notice anything.
  const other = await manager.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" });
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const view = await watch(manager, s.id);
  await waitFor(() => view.text().includes("you said: implement upgrade-runtime and run the tests ("), "the one-line prompt");

  // Over 4096 characters even as one line: refused before anything is registered or started.
  h.config.agentSessions.agents[0].promptSuffixes = { implement: "x ".repeat(2100) };
  const before = manager.list().length;
  const third = h.snapshot.repos[0].changes.find((c) => !c.archived && !["upgrade-runtime", "cache-api-calls"].includes(c.name) && availableActions(c).includes("implement") && !c.dependsOn?.length) as ChangeSnapshot;
  await expect(manager.open({ repoId: h.repoId, change: third.name, action: "implement" })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/4096/) });
  expect(manager.list()).toHaveLength(before);
  expect([manager.get(other.id).state, manager.get(s.id).state]).toEqual(["running", "running"]);
  const otherView = await watch(manager, other.id);
  expect(await manager.submit(other.id, "still here")).toEqual({ submitted: true });
  await waitFor(() => otherView.text().includes("you said: still here"), "the other session answering");
});

test("an agent that ends before its typed prompt is typed leaves the dashboard and every other session running", async () => {
  const h = await harness({ agent: { command: [FAKE_AGENT] } });
  const manager = h.newManager({ ...FAST_SUBMIT, typePromptDelayMs: 400 });
  managers.push(manager);
  const other = await manager.open({ repoId: h.repoId, change: "cache-api-calls", action: "implement" });
  const s = await manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  manager.write(s.id, "exit\r");
  await waitFor(() => manager.get(s.id).state === "exited", "the early exit");
  await new Promise((r) => setTimeout(r, 600)); // past the moment the prompt would have been typed
  expect(manager.get(other.id).state).toBe("running");
});

/** Agent processes on this machine whose command line holds `token`. */
const agentProcesses = (token: string) =>
  Bun.spawnSync(["ps", "-axo", "command"], { stdout: "pipe" })
    .stdout.toString()
    .split("\n")
    .filter((line) => line.includes(FAKE_AGENT) && line.includes(token)).length;

test("two opens at once start one agent in the kept worktree and return the same session (D3)", async () => {
  const h = track(await harness());
  const first = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  await h.manager.close(first.id);
  const [a, b] = await Promise.all([h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" }), h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" })]);
  expect(a.id).toBe(b.id);
  const path = await realpath(first.worktreePath); // macOS temp folders sit behind a symlink
  expect(await realpath(a.worktreePath)).toBe(path);
  expect(h.manager.list().filter((s) => s.state === "running")).toHaveLength(1);
});

test("two resumes at once start one process, and ending the session leaves none of it running (D3)", async () => {
  const token = `--resume-token-${Math.random().toString(36).slice(2, 10)}`;
  const h = track(await harness({ agent: { resumeCommand: [FAKE_AGENT, "--resumed", token] } }));
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  await h.manager.close(s.id);
  const [a, b] = await Promise.all([h.manager.resume(s.id), h.manager.resume(s.id)]);
  expect([a.id, b.id, a.state]).toEqual([s.id, s.id, "running"]);
  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes(token), "the resumed agent");
  expect(agentProcesses(token)).toBe(1);
  await h.manager.close(s.id);
  await waitFor(() => agentProcesses(token) === 0, "no agent process left");
});

test("bookkeeping nobody waits for cannot take the dashboard down, and shutdown leaves no write behind", async () => {
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const dir = join(sessionsDir(), s.id);
  try {
    // Make the session's record unwritable: a file where its directory should be.
    await rm(dir, { recursive: true, force: true });
    await writeFile(dir, "in the way");
    // `prompt` records the action in the background (nobody awaits that write). It fails now.
    expect((await h.manager.prompt(s.id, { action: "implement" })).action).toBe("implement");
    await new Promise((r) => setTimeout(r, 150));
    expect(unhandled).toEqual([]);
  } finally {
    await rm(dir, { force: true });
    process.off("unhandledRejection", onUnhandled);
  }

  // After shutdown nothing is still being written: the record is complete on disk the moment it returns.
  await h.manager.shutdown();
  const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
  expect(meta.state).not.toBe("running");
});

test("ending a session, worktree removal included, never reaches a remote — only the pull action does", async () => {
  const h = track(await harness());
  // Every access to this remote goes through a fake ssh that leaves a marker before failing.
  const dir = await realpath(await tempDir("osd-remote-"));
  const marker = join(dir, "contacted");
  const fakeSsh = join(dir, "fake-ssh.sh");
  await writeFile(fakeSsh, `#!/bin/sh\necho contacted >> "${marker}"\nexit 1\n`);
  await chmod(fakeSsh, 0o755);
  git(h.repoPath, "remote", "add", "origin", "ssh://git.example.invalid/team/repo.git");
  const previousSsh = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = fakeSsh;

  try {
    const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
    const view = await watch(h.manager, s.id);
    await waitFor(() => view.text().includes("fake-agent ready"), "the agent running"); // its cwd wraps in the terminal; the worktree is asserted below

    // What the end-session dialog does: read the status it warns on, then end and remove.
    expect(await h.manager.worktreeStatus(s.id)).toMatchObject({ removable: true });
    const closed = await h.manager.close(s.id, { removeWorktree: true });
    expect(closed.worktree).toEqual({ removable: true });
    expect(existsSync(s.worktreePath)).toBe(false);

    // Catching the main checkout up is a separate action the user asks for; ending a session is not one.
    expect(existsSync(marker)).toBe(false);
  } finally {
    if (previousSsh === undefined) delete process.env.GIT_SSH_COMMAND;
    else process.env.GIT_SSH_COMMAND = previousSsh;
  }
});

test("a folder that is not a git repository: the session runs in it, with no worktree, no branch and no git", async () => {
  const h = track(await harness({ git: false }));
  expect(h.snapshot.repos[0].isGit).toBe(false);

  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(s).toMatchObject({ state: "running", inPlace: true, worktreePath: h.repoPath });
  expect(s.branch).toBeUndefined();
  expect(existsSync(join(h.repoPath, ".git"))).toBe(false); // nothing turned it into a repository
  expect(existsSync(join(worktreesDir(), h.repoId))).toBe(false); // and no worktree was made for it

  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes("implement upgrade-runtime"), "the agent to receive its prompt");
  view.detach();
});

test("a folder that is not a git repository: archiving works there, and Ship is refused", async () => {
  const h = track(await harness({ git: false }));
  const done = h.snapshot.repos[0].changes.find((c) => c.stage === "done");
  expect(done).toBeDefined();

  const arch = await h.manager.open({ repoId: h.repoId, change: (done as { name: string }).name, action: "archive" });
  expect(arch).toMatchObject({ state: "running", action: "archive", inPlace: true, worktreePath: h.repoPath });
  expect(existsSync(join(worktreesDir(), h.repoId))).toBe(false);

  await expect(h.manager.ship(arch.id)).rejects.toThrow(/not a git repository/);
});

test("close and shutdown return only once the ended session's record is written", async () => {
  // The record is written after `state` turns `exited`; a caller that removes the home next must find nothing still
  // writing (this race failed CI runs with ENOENT once a test's temp home was gone).
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  await h.manager.close(s.id);
  const meta = JSON.parse(await readFile(join(sessionsDir(), s.id, "meta.json"), "utf8"));
  expect(meta.state).toBe("exited");
  expect(meta.updatedAt).toBe(h.manager.get(s.id).updatedAt);

  // An agent that exits on its own: shutdown has no running session to end, but still waits for that record.
  const other = await harness();
  const t = await other.manager.open({ repoId: other.repoId, change: "upgrade-runtime", action: "implement" });
  const seen = await watch(other.manager, t.id);
  await waitFor(() => seen.text().includes("fake-agent ready"), "the agent");
  other.manager.write(t.id, "exit\r");
  await waitFor(() => other.manager.get(t.id).state === "exited", "exit");
  await other.manager.shutdown();
  const ended = JSON.parse(await readFile(join(sessionsDir(), t.id, "meta.json"), "utf8"));
  expect(ended.state).toBe("exited");
  expect(ended.updatedAt).toBe(other.manager.get(t.id).updatedAt);
});

/** What **New project** leaves: `git init` and nothing else, so `HEAD` names no commit to branch from. */
function uncommit(repoPath: string): Promise<void> {
  return rm(join(repoPath, ".git"), { recursive: true, force: true }).then(() => {
    git(repoPath, "init", "-q", "-b", "main");
    git(repoPath, "config", "user.email", "t@example.invalid"); // a fresh .git has no identity of its own
    git(repoPath, "config", "user.name", "t");
  });
}

/** Scans the harness's repository again, as the scanner would after the repository changed. */
async function rescan(h: { config: Config; snapshot: Snapshot }): Promise<void> {
  h.snapshot.repos[0] = await scanRepo(h.config.repos[0]);
}

/** Another change of the fixture that can be started with Draft artifacts or Implement — prompts the fake agent has — and that action. */
function otherStartable(h: { snapshot: Snapshot }, except: string): { change: string; action: SessionAction } {
  const startable = (c: ChangeSnapshot) => availableActions(c).find((a) => a === "draft" || a === "implement");
  const change = h.snapshot.repos[0].changes.find((c) => !c.archived && c.name !== except && startable(c)) as ChangeSnapshot;
  return { change: change.name, action: startable(change) as SessionAction };
}

test("a repository without a commit: the change session runs in the checkout, with no worktree, no branch and no git", async () => {
  const h = track(await harness());
  await uncommit(h.repoPath);
  await rescan(h);
  expect(h.snapshot.repos[0]).toMatchObject({ isGit: true, noCommit: true });

  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(s).toMatchObject({ state: "running", inPlace: true, worktreePath: h.repoPath });
  expect(s.branch).toBeUndefined();
  expect(existsSync(join(worktreesDir(), h.repoId))).toBe(false); // no worktree was made
  expect(git(h.repoPath, "for-each-ref", "refs/heads")).toBe(""); // no branch
  expect(git(h.repoPath, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1); // only the checkout

  const view = await watch(h.manager, s.id);
  await waitFor(() => view.text().includes("implement upgrade-runtime"), "the agent to receive its prompt");
  view.detach();
});

test("a repository without a commit: one agent in the checkout at a time", async () => {
  const h = track(await harness());
  await uncommit(h.repoPath);
  await rescan(h);
  const other = otherStartable(h, "upgrade-runtime");

  const first = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  const second = await h.manager.open({ repoId: h.repoId, ...other }).catch((e: unknown) => e);
  expect(second).toBeInstanceOf(SessionError);
  expect((second as SessionError).status).toBe(409);
  expect((second as SessionError).message).toContain("upgrade-runtime");
  const console = await h.manager.openProjectConsole(h.repoId).catch((e: unknown) => e);
  expect(console).toBeInstanceOf(SessionError);
  expect((console as SessionError).message).toContain("upgrade-runtime");

  await h.manager.close(first.id);
  const { session } = await h.manager.openProjectConsole(h.repoId);
  const refused = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" }).catch((e: unknown) => e);
  expect(refused).toBeInstanceOf(SessionError);
  expect((refused as SessionError).message).toContain("the project's console is running in this folder");
  await h.manager.close(session.id);
});

test("a session started in place stays in place after the first commit; new sessions then get a worktree", async () => {
  const h = track(await harness());
  await uncommit(h.repoPath);
  await rescan(h);
  const first = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  await h.manager.close(first.id);

  // The agent (here: the test) makes the first commit, and the scanner notices.
  git(h.repoPath, "add", "-A");
  git(h.repoPath, "commit", "-q", "-m", "init");
  await rescan(h);
  expect("noCommit" in (h.snapshot.repos[0] as object)).toBe(false);

  const resumed = await h.manager.resume(first.id);
  expect(resumed).toMatchObject({ state: "running", inPlace: true, worktreePath: h.repoPath });
  expect(existsSync(join(worktreesDir(), h.repoId))).toBe(false);
  await h.manager.close(first.id);

  const other = otherStartable(h, "upgrade-runtime");
  const next = await h.manager.open({ repoId: h.repoId, ...other });
  expect(next.inPlace).toBeUndefined();
  expect(next.branch).toBeDefined();
  expect(next.worktreePath.startsWith(join(worktreesDir(), h.repoId))).toBe(true);
});

test("an out-of-date scan of a repository without a commit refuses plainly, before anything is created", async () => {
  // The snapshot still says there is a commit; the worktree's fallback check is what refuses.
  const h = track(await harness());
  await uncommit(h.repoPath);

  const refused = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" }).catch((e: unknown) => e);
  expect(refused).toBeInstanceOf(SessionError);
  expect((refused as SessionError).status).toBe(409);
  expect((refused as SessionError).message).toContain("no commit yet");
  expect((refused as SessionError).message).not.toContain("invalid reference"); // not git's own words
  expect(h.manager.list()).toEqual([]); // no agent was started
  expect(existsSync(join(worktreesDir(), h.repoId))).toBe(false); // not even the worktrees folder
  expect(git(h.repoPath, "for-each-ref", "refs/heads")).toBe(""); // no branch
  expect(git(h.repoPath, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1); // only the checkout
});

test("a session whose agent switched branch in its worktree resumes there; a new session is refused it (D5)", async () => {
  const h = track(await harness());
  const s = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  git(s.worktreePath, "checkout", "-q", "-b", "feat/upgrade-runtime-v2");
  await h.manager.close(s.id);
  expect((await h.manager.resume(s.id)).state).toBe("running");
  await h.manager.close(s.id);
  await h.manager.remove(s.id);
  await expect(h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/is on feat\/upgrade-runtime-v2, not on feat\/upgrade-runtime/) });
  expect(h.manager.anyRunning()).toBe(false);
});
