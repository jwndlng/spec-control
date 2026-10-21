import { expect, test } from "bun:test";
import { changeSessions, SHIPPABLE_WORK } from "../src/shared/types.ts";
import { ApiError, type TerminalHandlers } from "../src/ui/api.ts";
import { createDemoApi } from "../src/ui/demo/demoApi.ts";
import { conflictBadge, NEEDS_YOU_AFTER_MS, openWork, resolvable, sessionBadge } from "../src/ui/sessionState.ts";
import { pendingMergesOf } from "../src/ui/pullRequestsState.ts";
import type { Clock } from "../src/ui/demo/transcripts.ts";

/** The demo API on a wall clock and a timer clock the test advances by hand. */
function demo(start = Date.parse("2026-06-01T12:00:00.000Z")) {
  let wall = start;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    setTimeout: (fn, ms) => {
      timers.set(++seq, { at: wall + ms, fn });
      return seq;
    },
    clearTimeout: (h) => void timers.delete(h as number),
  };
  const advance = (ms: number) => {
    const until = wall + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      timers.delete(next[0]);
      wall = next[1].at;
      next[1].fn();
    }
    wall = until;
  };
  const api = createDemoApi({ now: () => wall, latencyMs: 0, clock });
  const terminal = (id: string) => {
    const events: string[] = [];
    const decoder = new TextDecoder();
    const handlers: TerminalHandlers = { onOpen: () => events.push("<open>"), onData: (b) => events.push(decoder.decode(b)), onExit: () => events.push("<exit>"), onSubmitted: (ok) => events.push(`<submitted:${ok}>`), onClose: () => events.push("<close>") };
    const connection = api.openTerminal(id, handlers);
    return { connection, events, text: () => events.filter((e) => !e.startsWith("<")).join("") };
  };
  return { api, advance, terminal, pendingTimers: () => timers.size };
}

const refusal = async (p: Promise<unknown>) => p.then(() => "resolved", (e) => (e instanceof ApiError ? `${e.status}: ${e.message}` : `unexpected ${e}`));
const byChange = async (api: ReturnType<typeof createDemoApi>, change: string) => changeSessions((await api.sessions()).sessions).find((s) => s.change === change)!;
const workOf = async (api: ReturnType<typeof createDemoApi>, change: string) => (await api.sessions()).worktrees.find((w) => w.change === change)?.work;

test("first load: sessions are on, the agent is available, and every state and work status is there", async () => {
  const { api } = demo();
  const config = await api.config();
  expect([config.agentSessions.enabled, config.agentSessions.agents.map((a) => a.name)]).toEqual([true, ["Demo Agent"]]);
  const { sessions, agents, worktrees } = await api.sessions();
  expect(agents).toEqual([{ id: "demo-agent", name: "Demo Agent", available: true, path: "/home/demo/bin/demo-agent" }]);
  expect(new Set(sessions.map((s) => s.state))).toEqual(new Set(["running", "exited", "failed"]));
  expect(openWork([], sessions).running).toBe(3); // the Open work control shows a count at first sight
  expect(new Set(worktrees.map((w) => w.work.state))).toEqual(new Set(["clean", "uncommitted", "unpushed", "pushed", "merged"]));
  expect(worktrees.some((w) => w.sessionId === undefined)).toBe(true); // a worktree whose session record is gone
  expect(sessions.find((s) => s.state === "failed")?.error).toContain("could not create the worktree");
  // one running session printed seconds ago, the other has been silent for minutes: it waits at a question
  const silent = sessions.filter((s) => s.state === "running").map((s) => Date.parse("2026-06-01T12:00:00.000Z") - Date.parse(s.lastOutputAt ?? ""));
  expect(silent.some((ms) => ms < NEEDS_YOU_AFTER_MS) && silent.some((ms) => ms > 10 * 60_000)).toBe(true);
  // and one waits at the same question with an agent that reports it, so all three running badges are there
  const labels = sessions.filter((s) => s.state === "running").map((s) => sessionBadge(s, Date.parse("2026-06-01T12:00:00.000Z")).label);
  expect(labels.some((l) => l === "working") && labels.some((l) => l.startsWith("may need you")) && labels.some((l) => l.startsWith("waiting for you"))).toBe(true);
  // shared-config profiles are carried from the start, one of them outdated
  const carried = (await api.state()).repos.flatMap((r) => r.sharedConfig?.applied ?? []);
  expect(carried.filter((p) => p.state === "in-sync").length).toBeGreaterThanOrEqual(4);
  expect(carried.filter((p) => p.state === "outdated")).toHaveLength(1);
});

test("an unwatched demo session keeps working while the one at a question keeps asking", async () => {
  const { api, advance } = demo();
  advance(5 * 60_000);
  const running = (await api.sessions()).sessions.filter((s) => s.state === "running");
  const labels = running.map((s) => sessionBadge(s, Date.parse("2026-06-01T12:05:00.000Z")).label);
  expect(labels).toContain("working");
  expect(labels.some((l) => l.startsWith("may need you"))).toBe(true);
  expect(labels.some((l) => l.startsWith("waiting for you"))).toBe(true);
});

test("a reporting demo agent's waiting report ends when the user answers", async () => {
  const { api, advance, terminal } = demo();
  const session = await byChange(api, "centralize-log-shipping");
  expect((await byChange(api, "centralize-log-shipping")).waitingReportedAt).toBeTruthy();
  const view = terminal(session.id);
  advance(0);
  expect((await byChange(api, "centralize-log-shipping")).waitingReportedAt).toBeTruthy(); // viewing keeps it
  view.connection.send({ type: "input", data: "\r" });
  advance(3_000);
  expect((await byChange(api, "centralize-log-shipping")).waitingReportedAt).toBeUndefined();
  view.connection.close();
});

test("everything a session names exists on the board, under the fictional root", async () => {
  const { api } = demo();
  const state = await api.state();
  const { sessions, worktrees } = await api.sessions();
  for (const s of sessions) {
    const repo = state.repos.find((r) => r.id === s.repoId)!;
    expect([s.change, repo.changes.some((c) => c.name === s.change && !c.archived)]).toEqual([s.change, true]);
    expect([s.change, s.worktreePath.startsWith("/home/demo/")]).toEqual([s.change, true]);
    if (s.state !== "failed") expect([s.change, repo.worktrees.some((w) => w.path === s.worktreePath && w.branch === s.branch)]).toEqual([s.change, true]);
  }
  for (const w of worktrees) expect([w.name, state.repos.find((r) => r.id === w.repoId)?.worktrees.some((g) => g.path === w.path)]).toEqual([w.name, true]);
  // the change that already lives in a user's worktree on feat/<change> is worked on there
  const adopted = sessions.find((s) => s.adopted)!;
  expect([adopted.change, adopted.branch]).toEqual(["add-rate-limiting", "feat/add-rate-limiting"]);
  expect(state.repos.flatMap((r) => r.changes).find((c) => c.name === adopted.change)?.checkout?.path).toBe(adopted.worktreePath);
});

test("times are relative to load", async () => {
  const stamps = async (start: number) => {
    const { sessions, worktrees } = await demo(start).api.sessions();
    return [...sessions.flatMap((s) => [s.createdAt, s.updatedAt, s.lastOutputAt]), ...worktrees.map((w) => w.lastActivityAt)].map((t) => (t ? Date.parse(t) - start : undefined));
  };
  expect(await stamps(Date.parse("2027-01-15T08:30:00Z"))).toEqual(await stamps(Date.parse("2026-06-01T12:00:00Z")));
});

test("opening a running session shows what already happened and keeps going to the end, which ends the session", async () => {
  const { api, advance, terminal } = demo();
  const session = await byChange(api, "add-rate-limiting");
  const view = terminal(session.id);
  advance(0);
  expect(view.events[0]).toBe("<open>");
  expect(view.text()).toContain("demo recording: nothing runs on this page");
  expect(view.text()).toContain("/opsx:apply add-rate-limiting");
  expect(view.text()).toContain(session.worktreePath);
  const soFar = view.text().length;
  expect(view.events).not.toContain("<exit>");
  advance(10 * 60_000);
  expect(view.text().length).toBeGreaterThan(soFar);
  expect(view.events.slice(-2)).toEqual(["<exit>", "<close>"]);
  expect((await byChange(api, "add-rate-limiting")).state).toBe("exited");
  expect((await workOf(api, "add-rate-limiting"))?.state).toBe("uncommitted"); // what the agent edited is still there
});

test("the waiting session shows its question and goes on when answered; reopening continues, it does not restart", async () => {
  const { api, advance, terminal, pendingTimers } = demo();
  const session = await byChange(api, "keyboard-shortcuts");
  const first = terminal(session.id);
  advance(0);
  expect(first.text()).toContain("Allow editing");
  expect(first.text()).not.toContain("1.1 ticked");
  advance(5 * 60_000);
  expect(first.text()).not.toContain("1.1 ticked"); // it really waits
  first.connection.send({ type: "input", data: "\r" });
  advance(3_000);
  first.connection.close();
  expect(pendingTimers()).toBe(0);

  const again = terminal(session.id);
  advance(0);
  expect(again.text()).toContain("Edit src/settings/layout.ts"); // scrollback includes what happened after the answer
  expect(again.text().match(/Allow editing/g)).toHaveLength(1);
  advance(60_000);
  expect(again.text()).toContain("1.1 ticked");
});

test("Fast-forward in the demo: offered like the dashboard, plays the draft, and its warning can be switched off", async () => {
  const { api } = demo();
  expect(await refusal(api.openSession("a71c02e9", "migrate-to-postgres-16", "fastForward"))).toBe('400: "fastForward" is not available for this change in its current stage');
  const started = await api.openSession("a71c02e9", "idempotency-keys", "fastForward");
  expect(started).toMatchObject({ state: "running", action: "fastForward", branch: "feat/idempotency-keys", autoMerge: false });
  expect((await api.config()).agentSessions.confirmFastForward).toBeUndefined();
  expect((await api.setFastForwardWarning(false)).agentSessions.confirmFastForward).toBe(false);
  expect((await api.config()).agentSessions.confirmFastForward).toBe(false);
  await expect(api.setFastForwardWarning("no" as never)).rejects.toMatchObject({ status: 400 });
  expect((await demo().api.config()).agentSessions.confirmFastForward).toBeUndefined(); // a reload starts over
});

test("starting a session: validated like the dashboard, one per change, in memory only", async () => {
  const { api } = demo();
  expect(await refusal(api.openSession("a71c02e9", "idempotency-keys", "implement"))).toBe('400: "implement" is not available for this change in its current stage');
  expect(await refusal(api.openSession("a71c02e9", "no-such-change", "draft"))).toBe("404: unknown change");
  expect(await refusal(api.openSession("nope", "idempotency-keys", "draft"))).toBe("404: unknown repository");
  expect(await refusal(api.openSession("6d44c1f8", "schema-registry", "implement"))).toBe("409: the repository's last scan failed");

  // The sub-state decides too: a change in `Done` awaiting validation takes Validate, never Implement.
  expect(await refusal(api.openSession("a71c02e9", "verify-rate-limit-headers", "implement"))).toBe('400: "implement" is not available for this change in its current stage');
  const validating = await api.openSession("a71c02e9", "verify-rate-limit-headers", "validate");
  expect(validating).toMatchObject({ state: "running", action: "validate", change: "verify-rate-limit-headers", agentName: "Demo Agent" });

  const started = await api.openSession("a71c02e9", "migrate-to-postgres-16", "implement");
  expect(started).toMatchObject({ state: "running", branch: "feat/migrate-to-postgres-16", agentName: "Demo Agent", worktreePath: "/home/demo/.spec-control/worktrees/a71c02e9/migrate-to-postgres-16" });
  expect((await api.openSession("a71c02e9", "migrate-to-postgres-16", "implement")).id).toBe(started.id);
  expect((await api.state()).repos.find((r) => r.id === "a71c02e9")?.worktrees.some((w) => w.path === started.worktreePath)).toBe(true);
  expect((await demo().api.sessions()).sessions.some((s) => s.change === "migrate-to-postgres-16")).toBe(false); // a reload starts over
});

test("Ship: refused when there is nothing to ship, otherwise it plays out and the work ends up pushed", async () => {
  const { api, advance, terminal } = demo();
  const merged = await byChange(api, "deprecate-v1-auth");
  expect(await refusal(api.shipSession(merged.id))).toBe("409: there is nothing to ship (merged)");

  const dirty = await byChange(api, "pin-terraform-providers");
  expect(await workOf(api, dirty.change)).toEqual({ state: "uncommitted", count: 3 });
  const view = terminal(dirty.id);
  advance(0);
  expect((await api.shipSession(dirty.id)).state).toBe("running");
  advance(60_000);
  expect(view.text()).toContain("Commit the work for pin-terraform-providers");
  expect(view.text().match(/demo recording/g)).toHaveLength(1); // same terminal, not a new one
  expect(view.events).toContain("<exit>");
  expect(await workOf(api, dirty.change)).toEqual({ state: "pushed" });
  expect((await byChange(api, dirty.change)).state).toBe("exited");
  expect(SHIPPABLE_WORK).toContain("pushed"); // still offered: a pushed branch can get its pull request
});

test("closing and removing: unsafe removal is refused with the dashboard's reasons, safe removal works, adopted worktrees are kept", async () => {
  const { api, advance, terminal } = demo();
  const unpushed = await byChange(api, "dark-mode-tokens");
  expect(await api.worktreeStatus(unpushed.id)).toEqual({ removable: false, reason: "2 commit(s) exist only on this worktree's branch", work: { state: "unpushed", count: 2, base: "origin/main" } });
  expect((await api.closeSession(unpushed.id, true)).worktree).toEqual({ removable: false, reason: "2 commit(s) exist only on this worktree's branch" });
  expect(await workOf(api, unpushed.change)).toBeDefined();

  const merged = await byChange(api, "deprecate-v1-auth");
  expect((await api.closeSession(merged.id, true)).worktree).toEqual({ removable: true });
  expect(await workOf(api, merged.change)).toBeUndefined();
  expect((await api.state()).repos.flatMap((r) => r.worktrees).some((w) => w.path === merged.worktreePath)).toBe(false);

  const running = await byChange(api, "add-rate-limiting"); // adopted
  const view = terminal(running.id);
  advance(0);
  expect(await refusal(api.deleteSession(running.id))).toBe("409: close the session first");
  const closed = await api.closeSession(running.id, true);
  expect([closed.session.state, closed.worktree?.removable, closed.worktree?.reason?.includes("not created by the dashboard")]).toEqual(["exited", false, true]);
  expect(view.events.slice(-2)).toEqual(["<exit>", "<close>"]);

  // the orphan: no session record, unpushed work → kept; and a name that is not a worktree
  expect(await api.removeWorktree("a71c02e9", "archive-add-health-endpoint")).toEqual({ removable: false, reason: "1 commit(s) exist only on this worktree's branch" });
  expect(await refusal(api.removeWorktree("a71c02e9", "nothing-here"))).toBe("404: unknown worktree");
});

test("deleting a record leaves its worktree reported; resume and next-step prompts work on the open terminal", async () => {
  const { api, advance, terminal } = demo();
  const ended = await byChange(api, "pin-terraform-providers");
  expect(await api.deleteSession(ended.id)).toEqual({ deleted: true });
  const left = (await api.sessions()).worktrees.find((w) => w.change === ended.change);
  expect([left?.sessionId, left?.work.state]).toEqual([undefined, "uncommitted"]);

  const pushed = await byChange(api, "versioned-api-reference");
  const view = terminal(pushed.id);
  advance(0);
  expect((await api.resumeSession(pushed.id)).state).toBe("running");
  advance(10_000);
  expect(view.text()).toContain("Picking up versioned-api-reference");
  const sent = await api.promptSession(pushed.id, "implement");
  expect(sent.submitted).toBe(true); // one activation sends it, as in the dashboard
  advance(2000);
  expect(view.text()).toContain("/opsx:apply versioned-api-reference"); // the agent took it up
  // Archive is a next step like any other now: into the same session, never a second console for the change.
  const archiving = await api.promptSession(pushed.id, "archive");
  expect([archiving.id, archiving.submitted, archiving.action]).toEqual([pushed.id, true, "archive"]);
  advance(2000);
  expect(view.text()).toContain("/opsx:archive versioned-api-reference");
  expect(changeSessions((await api.sessions()).sessions).filter((s) => s.change === "versioned-api-reference" && s.state === "running")).toHaveLength(1);
});

test("switching sessions off hides them; nothing else breaks; callers cannot reach into the demo's state", async () => {
  const { api } = demo();
  const config = await api.config();
  await api.saveConfig({ ...config, agentSessions: { ...config.agentSessions, enabled: false } });
  expect(await api.sessions()).toMatchObject({ sessions: [], worktrees: [] });
  expect(await refusal(api.openSession("a71c02e9", "migrate-to-postgres-16", "implement"))).toBe("403: agent sessions are disabled");
  expect((await api.state()).repos.flatMap((r) => r.worktrees).some((w) => w.path.includes(".spec-control"))).toBe(false);

  const fresh = demo().api;
  const list = await fresh.sessions();
  list.sessions[0].state = "failed";
  list.worktrees[0].work.state = "missing";
  const again = await fresh.sessions();
  expect([again.sessions[0].state, again.worktrees[0].work.state]).not.toEqual(["failed", "missing"]);
});

test("the main console in the demo: one at a time, a recording in the demo's console folder, never open work", async () => {
  const { api, advance, terminal } = demo();
  const before = await api.sessions();
  const session = await api.openConsole();
  expect(session).toMatchObject({ console: true, state: "running", worktreePath: "/home/demo/.spec-control/console" });
  expect((await api.openConsole()).id).toBe(session.id);

  const after = await api.sessions();
  expect(after.worktrees).toEqual(before.worktrees);
  expect(openWork(after.worktrees, after.sessions).items.some((i) => i.key === session.id)).toBe(false);

  const view = terminal(session.id);
  advance(5_000);
  expect(view.text()).toContain("demo recording");
  expect(view.text()).toContain("belongs to no change");
  expect(await refusal(api.shipSession(session.id))).toBe("409: this is the main console, which belongs to no change");
  expect(await refusal(api.worktreeStatus(session.id))).toBe("409: this is the main console, which belongs to no change");

  await api.closeSession(session.id, true);
  const next = await api.openConsole();
  expect(next.id).not.toBe(session.id);
  view.connection.close();
});

test("the demo console is refused while agent sessions are off", async () => {
  const { api } = demo();
  const config = await api.config();
  await api.saveConfig({ ...config, agentSessions: { ...config.agentSessions, enabled: false } });
  expect(await refusal(api.openConsole())).toBe("403: agent sessions are disabled");
});

test("integrating a repository in the demo: a recording in the folder itself, then a tracked repository with a board", async () => {
  const { api, advance, terminal } = demo();
  const { integratable, candidates } = await api.discover();
  expect(integratable).toHaveLength(1);
  const repo = integratable[0];
  expect(repo).toMatchObject({ name: "sparrow-gateway", path: "/home/demo/work/sparrow-gateway" });
  expect(candidates.some((c) => c.id === repo.id)).toBe(false); // it is not a candidate: it has no OpenSpec yet
  expect((await api.state()).repos.some((r) => r.id === repo.id)).toBe(false);

  const session = await api.startIntegration(repo.path);
  expect(session).toMatchObject({ integration: true, inPlace: true, folder: repo.path, worktreePath: repo.path, state: "running" });
  expect(session.branch).toBeUndefined();
  expect((await api.startIntegration(repo.path)).id).toBe(session.id); // one at a time per folder

  // No worktree of its own, and never part of open work.
  const listed = await api.sessions();
  expect(listed.worktrees.some((w) => w.path === repo.path)).toBe(false);
  expect(openWork(listed.worktrees, listed.sessions).items.some((i) => i.key === session.id)).toBe(false);
  expect(await refusal(api.shipSession(session.id))).toBe("409: this session is setting a repository up for OpenSpec, so it belongs to no change");
  expect(await refusal(api.worktreeStatus(session.id))).toBe("409: this session is setting a repository up for OpenSpec, so it belongs to no change");

  const view = terminal(session.id);
  advance(1_000);
  expect(view.text()).toContain("demo recording");
  expect((await api.config()).repos.some((r) => r.id === repo.id)).toBe(false); // nothing yet: the recording is still running

  advance(2_000); // the transcript stops at its question
  view.connection.send({ type: "input", data: "claude, cursor\r" });
  advance(20_000); // …and then runs to its end

  expect(view.text()).toContain("openspec/config.yaml");
  expect((await api.sessions()).sessions.find((s) => s.id === session.id)?.state).toBe("exited");
  // The marker "appeared": it is a tracked, enabled repository with a board, and it is no longer offered.
  expect((await api.config()).repos.find((r) => r.id === repo.id)).toMatchObject({ name: "sparrow-gateway", enabled: true });
  expect((await api.discover()).integratable).toEqual([]);
  const board = (await api.state()).repos.find((r) => r.id === repo.id);
  expect(board?.changes.map((c) => c.name)).toEqual(["retry-budget-per-route", "drop-legacy-tls-ciphers"]);
  view.connection.close();
});

test("the demo refuses an integration for anything but a repository that is waiting for one", async () => {
  const { api } = demo();
  const { integratable } = await api.discover();
  expect(await refusal(api.startIntegration("/home/demo/work/atlas-api"))).toContain("404"); // already an OpenSpec project
  expect(await refusal(api.startIntegration("/home/demo/elsewhere"))).toContain("404");

  const config = await api.config();
  await api.saveConfig({ ...config, agentSessions: { ...config.agentSessions, enabled: false } });
  expect(await refusal(api.startIntegration(integratable[0].path))).toBe("403: agent sessions are disabled");
  expect((await api.sessions()).sessions).toEqual([]);
});

test("Resolve conflicts: the sample shows a conflicting branch on first load, and resolving plays out without a network", async () => {
  const { api, advance, terminal } = demo();
  const conflicting = await byChange(api, "versioned-api-reference");
  const work = await workOf(api, conflicting.change);
  expect(work).toEqual({ state: "pushed", base: "origin/main", conflicts: { base: "origin/main", files: ["src/router/table.ts", "src/router/table.test.ts"] } });

  // What the UI decides from: the badge shows, and the control is offered.
  const worktree = (await api.sessions()).worktrees.find((w) => w.change === conflicting.change);
  expect(conflictBadge(worktree)).toMatchObject({ tone: "warning", label: "conflicts with origin/main" });
  expect(resolvable(conflicting, worktree)).toBe(true);

  // A branch that merges cleanly is refused, with the dashboard's own wording.
  const merged = await byChange(api, "deprecate-v1-auth");
  expect(await refusal(api.resolveConflicts(merged.id))).toBe("409: this branch has no conflicts to resolve (merged)");

  const view = terminal(conflicting.id);
  advance(0);
  expect((await api.resolveConflicts(conflicting.id)).state).toBe("running");
  advance(60_000);
  expect(view.text()).toContain("no longer merges into the default branch");
  expect(view.text()).toContain("Conflicts resolved");
  expect(view.events).toContain("<exit>");

  // The conflict is gone once the recording's agent has pushed; the branch is merely pushed again.
  expect(await workOf(api, conflicting.change)).toEqual({ state: "pushed", base: "origin/main" });
  expect(resolvable(await byChange(api, conflicting.change), (await api.sessions()).worktrees.find((w) => w.change === conflicting.change))).toBe(false);
});

test("Resolve conflicts in the demo does not survive a reload", async () => {
  const fresh = await byChange(demo().api, "versioned-api-reference");
  expect(fresh.state).toBe("exited");
  expect((await workOf(demo().api, "versioned-api-reference"))?.conflicts?.files).toHaveLength(2);
});

test("the demo never sends or shows a pending Merge (agent-merges-docs-prs)", async () => {
  const { api } = demo();
  const sessions = changeSessions((await api.sessions()).sessions);
  // No demo session records a Merge prompt, so no panel or card says one is pending and the board's watch has none.
  expect(sessions.filter((s) => s.mergeAsked !== undefined)).toEqual([]);
  expect(pendingMergesOf(sessions).size).toBe(0);
  // The Merge action is refused for every session, running or not, and nothing changes.
  for (const s of sessions) expect(await refusal(api.mergeSession(s.id))).toBe("503: the demo does not merge pull requests");
  expect(changeSessions((await api.sessions()).sessions).filter((s) => s.mergeAsked !== undefined)).toEqual([]);
  // Its lists are synthetic: none names a head commit or a docs-only answer, so nothing could be handed over either.
  const lists = (await api.pullRequests()).repos.flatMap((r) => r.pullRequests);
  expect(lists.filter((pr) => pr.headOid !== undefined || pr.docsOnly !== undefined)).toEqual([]);
});
