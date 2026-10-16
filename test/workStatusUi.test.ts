import { expect, test } from "bun:test";
import type { ChangeSession, Session, SessionWorktree, WorkStatus } from "../src/shared/types.ts";
import { ConflictBadge } from "../src/ui/sessions.tsx";
import { byTag, textOf } from "./vnode.ts";
import { conflictBadge, consoleAvailable, consoleSession, consoleSessions, consoleTabAvailable, endConfirmable, endSeverity, pullOffer, endWarning, nextStepFor, openWork, removalPreselected, resolvable, sessionsForChange, staleAge, workBadge, worktreeForChange, worktreeOfSession, worktreeRemovalPossible } from "../src/ui/sessionState.ts";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const wt = (name: string, work: WorkStatus, hours = 1, patch: Partial<SessionWorktree> = {}): SessionWorktree => ({
  repoId: "r",
  name,
  path: `/home/demo/.spec-control/worktrees/r/${name}`,
  change: name.replace(/^archive-/, ""),
  action: name.startsWith("archive-") ? "archive" : "implement",
  branch: `feat/${name}`,
  work,
  lastActivityAt: ago(hours),
  ...patch,
});
const running = (id: string) => ({ id, state: "running" }) as Session;

test("badges say what is left to do, in words", () => {
  // Everything short of merged is work in a branch, so it wears one role; merged is the one finished state.
  expect(workBadge(wt("a", { state: "uncommitted", count: 3 }), [], NOW)).toMatchObject({ label: "✎ 3 uncommitted", tone: "branch" });
  expect(workBadge(wt("a", { state: "unpushed", count: 1 }), [], NOW)).toMatchObject({ tone: "branch" });
  expect(workBadge(wt("a", { state: "unpushed", count: 1 }), [], NOW)?.title).toContain("1 commit exist");
  expect(workBadge(wt("a", { state: "pushed", base: "origin/main" }), [], NOW)).toMatchObject({ label: "⇡ pushed", tone: "branch" });
  expect(workBadge(wt("a", { state: "merged", base: "origin/main" }), [], NOW)).toMatchObject({ label: "✓ merged", tone: "success" });
  expect(workBadge(wt("a", { state: "merged", base: "origin/main" }), [], NOW)?.title).toContain("as of your last fetch");
  expect(workBadge(wt("a", { state: "clean" }), [], NOW)).toBeUndefined();
  expect(workBadge(wt("a", { state: "missing" }), [], NOW)).toBeUndefined();
});

test("open work goes stale after a day, pushed work after a week, and never while its session runs", () => {
  expect(staleAge(wt("a", { state: "unpushed", count: 2 }, 23), [], NOW)).toBeUndefined();
  expect(staleAge(wt("a", { state: "unpushed", count: 2 }, 30), [], NOW)).toBe("30h");
  expect(workBadge(wt("a", { state: "uncommitted", count: 2 }, 72), [], NOW)).toMatchObject({ label: "✎ 2 uncommitted · 3d", tone: "danger" });
  expect(staleAge(wt("a", { state: "pushed" }, 72), [], NOW)).toBeUndefined();
  expect(staleAge(wt("a", { state: "pushed" }, 8 * 24), [], NOW)).toBe("8d");
  // A pushed branch may simply be waiting for review, so going stale only warns.
  expect(workBadge(wt("a", { state: "pushed" }, 8 * 24), [], NOW)).toMatchObject({ label: "⇡ pushed · 8d", tone: "warning" });
  expect(staleAge(wt("a", { state: "merged" }, 900), [], NOW)).toBeUndefined();
  expect(staleAge(wt("a", { state: "unpushed", count: 1 }, 72, { sessionId: "s1" }), [running("s1")], NOW)).toBeUndefined();
});

test("a card shows its change's open work first, its merged worktree otherwise, and nothing for clean ones", () => {
  const list = [wt("add-x", { state: "merged" }), wt("archive-add-x", { state: "unpushed", count: 1 }), wt("other", { state: "uncommitted", count: 1 }), wt("idle", { state: "clean" })];
  expect(worktreeForChange(list, "r", "add-x")?.name).toBe("archive-add-x");
  expect(worktreeForChange([list[0]], "r", "add-x")?.name).toBe("add-x");
  expect(worktreeForChange(list, "r", "idle")).toBeUndefined();
  expect(worktreeForChange(list, "elsewhere", "add-x")).toBeUndefined();
});

const sess = (id: string, patch: Partial<ChangeSession> = {}): ChangeSession => ({ id, repoId: "r", change: "add-x", action: "implement", agentId: "a", agentName: "A", state: "running", worktreePath: `/w/${id}`, branch: "feat/add-x", createdAt: `2026-09-21T10:0${id.length}:00Z`, updatedAt: "", resumable: true, ...patch });

test("the open work list holds the running sessions, oldest first", () => {
  const list = [sess("newer", { createdAt: "2026-09-21T11:00:00Z" }), sess("ended", { state: "exited", exitCode: 0 }), sess("broke", { state: "failed" }), sess("older", { createdAt: "2026-09-21T09:00:00Z" })];
  expect(openWork([], list, NOW).items.map((i) => i.session?.id)).toEqual(["older", "newer"]);
  expect(openWork([], [], NOW).items).toEqual([]);
});

test("every starter goes into the change's running session, whatever either of them is", () => {
  const draft = sess("d", { action: "draft" });
  expect(nextStepFor([draft], "r", "add-x")).toEqual({ promptSessionId: "d" });
  // Archive is no longer the exception, and a session started as Archive is a target like any other.
  const arch = sess("ar", { action: "archive" });
  expect(nextStepFor([arch], "r", "add-x")).toEqual({ promptSessionId: "ar" });
  expect(nextStepFor([sess("d", { state: "exited" })], "r", "add-x")).toEqual({ promptSessionId: undefined });
  expect(nextStepFor([draft], "r", "other")).toEqual({ promptSessionId: undefined });
  expect(nextStepFor([], "r", "add-x")).toEqual({ promptSessionId: undefined });
});

test("a card shows every running session, else the latest one that went wrong", () => {
  const a = sess("a");
  const arch = sess("arc", { action: "archive" });
  expect(sessionsForChange([a, arch, sess("x", { change: "other" })], "r", "add-x").map((s) => s.id).sort()).toEqual(["a", "arc"]);
  expect(sessionsForChange([sess("a", { state: "exited", exitCode: 0 })], "r", "add-x")).toEqual([]);
  expect(sessionsForChange([sess("a", { state: "exited", exitCode: 2 })], "r", "add-x").map((s) => s.id)).toEqual(["a"]);
});

test("ending is questioned as loudly as the work is unshipped", () => {
  expect(endSeverity({ state: "uncommitted" })).toBe("danger");
  expect(endSeverity({ state: "unpushed" })).toBe("danger");
  expect(endSeverity({ state: "pushed" })).toBe("notice");
  for (const state of ["clean", "merged", "missing"] as const) expect(endSeverity({ state })).toBe("plain");
  expect(endSeverity(undefined)).toBe("plain");
  expect(endWarning({ state: "uncommitted", count: 3 })).toContain("3 uncommitted files exist only in this worktree");
  expect(endWarning({ state: "unpushed", count: 1 })).toContain("1 commit exists only on this machine");
  expect(endWarning({ state: "clean" })).toBeUndefined();
});

test("the pull is offered for a repository it can run in, and then always starts ticked", () => {
  // whatever the work status: it does not enter the decision at all
  const inWorktree = { inPlace: false };
  expect(pullOffer({ isGit: true, ok: true }, inWorktree)).toEqual({ offered: true, preselected: true });
  // nothing the pull action can run in: neither offered nor ticked
  expect(pullOffer({ isGit: false, ok: true }, inWorktree)).toEqual({ offered: false, preselected: false });
  expect(pullOffer({ isGit: true, ok: false }, inWorktree)).toEqual({ offered: false, preselected: false });
  expect(pullOffer(undefined, inWorktree)).toEqual({ offered: false, preselected: false });
});

test("an in-place session gets no pull offer, in a git repository with or without a commit", () => {
  // The repository snapshot does not tell a repository with no commit apart here: it is `isGit` and `ok` either way,
  // and a session that started in place stays in place after the first commit — so only the session decides.
  const inPlace = { inPlace: true };
  const noCommit = { isGit: true, ok: true, noCommit: true as const };
  expect(pullOffer(noCommit, inPlace)).toEqual({ offered: false, preselected: false });
  expect(pullOffer({ isGit: true, ok: true }, inPlace)).toEqual({ offered: false, preselected: false });
  expect(pullOffer({ isGit: true, ok: true }, undefined)).toEqual({ offered: false, preselected: false });
});

test("the end dialog confirms an in-place session at once, and a worktree session once its status arrived", () => {
  const inPlace = { inPlace: true };
  const inWorktree = { inPlace: false };
  const status = { removable: true };
  expect(endConfirmable(inPlace, undefined, false)).toBe(true);
  expect(endConfirmable(inWorktree, undefined, false)).toBe(false);
  expect(endConfirmable(inWorktree, status, false)).toBe(true);
  // a request in flight blocks the button in every case
  for (const session of [inPlace, inWorktree]) for (const s of [undefined, status]) expect(endConfirmable(session, s, true)).toBe(false);
});

test("the worktree removal starts ticked exactly when the worktree may be removed", () => {
  for (const state of ["merged", "pushed", "clean", "missing"] as const) {
    expect(removalPreselected({ removable: true, work: { state } })).toBe(true);
  }
  expect(removalPreselected({ removable: true })).toBe(true);
  // unshipped work is never removable, and nothing is ticked for it
  expect(removalPreselected({ removable: false, reason: "1 commit exists only on this branch", work: { state: "unpushed" } })).toBe(false);
  expect(removalPreselected({ removable: false, work: { state: "merged" } })).toBe(false);
  expect(removalPreselected(undefined)).toBe(false);
});


test("the console lists a change's sessions, most recently active first, and defaults to that one", () => {
  const list = [
    sess("old", { lastOutputAt: "2026-09-21T09:00:00Z" }),
    sess("newest", { lastOutputAt: "2026-09-21T11:00:00Z" }),
    sess("archiving", { action: "archive", lastOutputAt: "2026-09-21T10:00:00Z" }),
    sess("elsewhere", { repoId: "other", lastOutputAt: "2026-09-21T23:00:00Z" }),
    sess("another-change", { change: "add-y", lastOutputAt: "2026-09-21T23:00:00Z" }),
  ];
  const mine = consoleSessions(list, "r", "add-x");
  expect(mine.map((s) => s.id)).toEqual(["newest", "archiving", "old"]);

  // An ended session stays listed: its output is still readable and its worktree may still hold work.
  expect(consoleSessions([sess("a", { state: "exited", exitCode: 0 })], "r", "add-x").map((s) => s.id)).toEqual(["a"]);
  expect(consoleSessions(list, "r", "nothing-here")).toEqual([]);

  // The URL picks one of the change's own sessions; anything else falls back to the most recent, never an error.
  expect(consoleSession(mine, "archiving")?.id).toBe("archiving");
  expect(consoleSession(mine, "elsewhere")?.id).toBe("newest");
  expect(consoleSession(mine, undefined)?.id).toBe("newest");
  expect(consoleSession([], "archiving")).toBeUndefined();
});

test("open work lists running sessions first, then worktrees nobody is working on", () => {
  const worktrees = [
    wt("merged", { state: "merged" }, 500),
    wt("busy", { state: "clean" }, 1, { sessionId: "s1", path: "/w/s1" }),
    wt("fresh", { state: "uncommitted", count: 1 }, 2),
    wt("idle", { state: "clean" }),
    wt("old", { state: "unpushed", count: 4 }, 100),
  ];
  const { items, unshipped, running: live } = openWork(worktrees, [sess("s1")], NOW);
  // The running session leads; its own clean worktree is not listed again. An idle clean one stays out entirely.
  expect(items.map((i) => i.change)).toEqual(["add-x", "old", "fresh", "merged"]);
  expect(items[0].worktree?.name).toBe("busy");
  expect(live).toBe(1);
  expect(unshipped).toBe(2);

  expect(openWork([wt("idle", { state: "clean" })], [], NOW).items).toEqual([]);
});

test("a session that ends leaves the running rows and its worktree takes the entry's place", () => {
  // The old dock-era rule was that an ended session simply dropped out and the count fell. With the dock gone this
  // list is the only way back to that worktree, so the row moves rather than disappearing and the count holds.
  const worktrees = [wt("add-x", { state: "unpushed", count: 2 }, 1, { sessionId: "s1", path: "/w/s1" })];
  const while_running = openWork(worktrees, [sess("s1")], NOW);
  expect(while_running.items.map((i) => i.key)).toEqual(["s1"]);
  expect(while_running.running).toBe(1);
  expect(while_running.unshipped).toBe(0);

  const after_exit = openWork(worktrees, [sess("s1", { state: "exited", exitCode: 0 })], NOW);
  expect(after_exit.items.map((i) => i.key)).toEqual(["/w/s1"]);
  expect(after_exit.running).toBe(0);
  expect(after_exit.unshipped).toBe(1);
  // Same total, and the row still carries the session record so the Console tab is still reachable through it.
  expect(after_exit.running + after_exit.unshipped).toBe(while_running.running + while_running.unshipped);
  expect(after_exit.items[0].session?.id).toBe("s1");
});

test("a running session's own worktree is counted once, as running rather than as unshipped", () => {
  const worktrees = [wt("shipping", { state: "uncommitted", count: 3 }, 1, { sessionId: "s1", path: "/w/s1" })];
  const { items, unshipped, running: live } = openWork(worktrees, [sess("s1")], NOW);
  expect(items).toHaveLength(1);
  expect(live).toBe(1);
  expect(unshipped).toBe(0);
});

test("an in-place session is listed although it has no worktree at all", () => {
  // A tracked folder that is not a git repository: the agent works in the folder, so there is nothing worktree-shaped
  // to find it by. Listing by session is the only thing that reaches it.
  const inPlace = sess("s1", { inPlace: true, worktreePath: "/w/plain-folder" });
  const { items, running: live } = openWork([], [inPlace], NOW);
  expect(items.map((i) => i.session?.id)).toEqual(["s1"]);
  expect(items[0].worktree).toBeUndefined();
  expect(live).toBe(1);
  expect(worktreeOfSession(inPlace, [wt("x", { state: "clean" }, 1, { path: "/w/plain-folder" })])).toBeUndefined();
  expect(worktreeRemovalPossible(inPlace)).toBe(false);
});

test("a change gets a console when it has a session or a worktree, and a worktree outlives its change", () => {
  const cfg = { agentSessions: { enabled: true }, repos: [{ id: "r", enabled: true }] } as never;
  const off = { agentSessions: { enabled: false }, repos: [{ id: "r", enabled: true }] } as never;
  const s = [sess("a")];
  const w = [wt("add-x", { state: "uncommitted", count: 1 })];

  expect(consoleAvailable(cfg, s, [], "r", "add-x")).toBe(true);
  // No session record left, but the worktree is still there: this is the archive worktree of a change that is gone.
  expect(consoleAvailable(cfg, [], w, "r", "add-x")).toBe(true);
  expect(consoleAvailable(cfg, [], [], "r", "add-x")).toBe(false);
  expect(consoleAvailable(cfg, s, w, "r", "another")).toBe(false);
  expect(consoleAvailable(cfg, s, w, "elsewhere", "add-x")).toBe(false);
  // Feature off: no console anywhere, whatever is lying around.
  expect(consoleAvailable(off, s, w, "r", "add-x")).toBe(false);
  expect(consoleAvailable(null, s, w, "r", "add-x")).toBe(false);
});

test("the Console tab exists per repository, before any agent has run — which is not what consoleAvailable answers", () => {
  const cfg = { agentSessions: { enabled: true }, repos: [{ id: "r", enabled: true }] } as never;
  const off = { agentSessions: { enabled: false }, repos: [{ id: "r", enabled: true }] } as never;
  const excluded = { agentSessions: { enabled: true }, repos: [{ id: "r", enabled: false }] } as never;

  // The one case the two predicates differ in, and the reason there are two: a change nothing has ever run for still
  // gets the tab (it offers the starters), while `consoleAvailable` stays false so a name in no snapshot is "not found".
  expect(consoleTabAvailable(cfg, "r")).toBe(true);
  expect(consoleAvailable(cfg, [], [], "r", "add-x")).toBe(false);

  // Where they agree: the feature off, the repository switched off, no config at all, another repository.
  for (const config of [off, excluded, null]) {
    expect(consoleTabAvailable(config, "r")).toBe(false);
    expect(consoleAvailable(config, [sess("a")], [wt("add-x", { state: "uncommitted", count: 1 })], "r", "add-x")).toBe(false);
  }
  expect(consoleTabAvailable(cfg, "elsewhere")).toBe(false);
});

test("a session in a folder without git has no worktree, so no work status, no Ship and nothing to remove", () => {
  const worktrees = [wt("upgrade-runtime", { state: "uncommitted", count: 2 })];
  const inRepo = { inPlace: true, worktreePath: "/w/acme/demo-ops" } as Session;
  const inWorktree = { worktreePath: worktrees[0].path } as Session;

  // The in-place session's directory is the repository itself; it must never be matched against a worktree.
  expect(worktreeOfSession(inWorktree, worktrees)).toBe(worktrees[0]);
  expect(worktreeOfSession(inRepo, worktrees)).toBeUndefined();
  expect(worktreeOfSession(undefined, worktrees)).toBeUndefined();

  expect(worktreeRemovalPossible(inWorktree)).toBe(true);
  expect(worktreeRemovalPossible(inRepo)).toBe(false);
  expect(worktreeRemovalPossible(undefined)).toBe(false);

  // Ending it offers no pull either: the pull action only runs in a git repository.
  expect(pullOffer({ isGit: false, ok: true }, inRepo)).toEqual({ offered: false, preselected: false });
  expect(pullOffer({ isGit: true, ok: true }, inWorktree)).toEqual({ offered: true, preselected: true });
});

test("the conflict badge names the base, the files and how fresh the answer is", () => {
  const one = conflictBadge(wt("a", { state: "pushed", base: "origin/main", conflicts: { base: "origin/main", files: ["src/router/table.ts"] } }));
  expect(one).toMatchObject({ icon: "⚠", label: "conflicts with origin/main", tone: "warning" });
  expect(one?.title).toContain("no longer merges into origin/main");
  expect(one?.title).toContain("as of your last fetch"); // the caveat is never dropped (design D4)
  expect(one?.title).toContain("Pull to refresh the base.");
  expect(one?.title).toContain("1 file: src/router/table.ts");

  const two = conflictBadge(wt("a", { state: "unpushed", count: 2, base: "origin/main", conflicts: { base: "origin/main", files: ["a.ts", "b.ts"] } }));
  expect(two?.title).toContain("2 files: a.ts, b.ts");

  const many = conflictBadge(wt("a", { state: "pushed", base: "origin/main", conflicts: { base: "origin/main", files: ["a.ts", "b.ts"], truncated: true } }));
  expect(many?.title).toContain("2+ files");
  expect(many?.title).toContain(", and more");
});

test("no conflict signal, no badge — whatever the work state is", () => {
  for (const work of [
    { state: "pushed", base: "origin/main" },
    { state: "merged", base: "origin/main" },
    { state: "clean" },
    { state: "missing" },
  ] as WorkStatus[]) {
    expect(conflictBadge(wt("a", work))).toBeUndefined();
  }
  expect(conflictBadge(undefined)).toBeUndefined();
});

test("Resolve conflicts is offered only for a change session with a conflicting worktree", () => {
  const session = { id: "s", state: "running" } as Session;
  const conflicting = wt("a", { state: "pushed", base: "origin/main", conflicts: { base: "origin/main", files: ["a.ts"] } });
  expect(resolvable(session, conflicting)).toBe(true);

  // An ended session can still be asked: the agent is started again in the worktree.
  expect(resolvable({ ...session, state: "exited" } as Session, conflicting)).toBe(true);

  expect(resolvable(session, wt("a", { state: "pushed", base: "origin/main" }))).toBe(false); // merges cleanly
  expect(resolvable(session, wt("a", { state: "merged", base: "origin/main" }))).toBe(false);
  expect(resolvable(session, undefined)).toBe(false);
  expect(resolvable(undefined, conflicting)).toBe(false);
  // An in-place session has no branch, and the console belongs to no change.
  expect(resolvable({ ...session, inPlace: true } as Session, conflicting)).toBe(false);
  expect(resolvable({ ...session, console: true } as unknown as Session, conflicting)).toBe(false);
});

test("the rendered conflict badge carries the warning tone, the explanation and a decorative icon", () => {
  const conflicting = wt("a", { state: "pushed", base: "origin/main", conflicts: { base: "origin/main", files: ["src/router/table.ts"] } });
  const node = ConflictBadge({ worktree: conflicting });
  const spans = byTag(node, "span");
  expect(spans[0].props.class).toBe("badge warning");
  expect(String(spans[0].props.title)).toContain("no longer merges into origin/main");
  expect(String(spans[0].props.title)).toContain("as of your last fetch");
  // Text, never colour alone; the glyph is decoration and stays out of the accessible name.
  expect(textOf(node)).toContain("conflicts with origin/main");
  expect(spans[1].props["aria-hidden"]).toBe("true");

  // A branch that merges renders nothing at all.
  expect(ConflictBadge({ worktree: wt("a", { state: "pushed", base: "origin/main" }) })).toBeNull();
  expect(ConflictBadge({ worktree: undefined })).toBeNull();
});
