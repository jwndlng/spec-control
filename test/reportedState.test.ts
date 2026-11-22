// improve-input-detection: output the dashboard provoked is not activity, and an agent can report its state in a file.
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sessionsDir } from "../src/server/paths.ts";
import { createFetchHandler } from "../src/server/api.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { SessionManager } from "../src/server/sessions/manager.ts";
import { parseCompletionReport, parseReport, readCompletionReport, readReport, REPORT_MAX_BYTES, terminalRepliesOnly } from "../src/server/sessions/reportedState.ts";
import { SessionStore } from "../src/server/sessions/store.ts";
import { tempDir, useTempHome } from "./helpers.ts";
import { harness, waitFor, watch } from "./sessionHelpers.ts";

// These tests start real processes in pseudo-terminals; slow CI runners need more than the 5 s default.
setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const managers: SessionManager[] = [];
const ECHO_MS = 400;
const FAST = { echoWindowMs: ECHO_MS, submitTimings: { echoTimeoutMs: 600, settleMs: 20 } };

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
});
afterAll(() => cleanup());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function running(change = "upgrade-runtime") {
  const h = await harness();
  const manager = h.newManager(FAST);
  managers.push(manager);
  const s = await manager.open({ repoId: h.repoId, change, action: "implement" });
  const view = await watch(manager, s.id);
  await waitFor(() => view.text().includes("fake-agent ready"), "agent banner");
  await sleep(ECHO_MS + 100); // past any window the start-up opened
  return { h, manager, s, view, stateFile: new SessionStore().statePath(s.id) };
}

/** Lets the agent report as its own hook would, and waits until it has. */
async function report(manager: SessionManager, view: { text: () => string }, id: string, word: string): Promise<void> {
  const before = view.text().split(`you said: report ${word}`).length;
  // Typed, as an agent's hook runs on its own; the input itself is the user's, so wait for the report to be newer.
  manager.write(id, `report ${word}\r`);
  await waitFor(() => view.text().split(`you said: report ${word}`).length > before, `the agent reported ${word}`);
}

test("terminal replies are not the user's input; anything else is", () => {
  for (const reply of ["\x1b[I", "\x1b[O", "\x1b[I\x1b[O", "\x1b[12;40R", "\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[0n", "\x1b[?2004;1$y", "\x1b]11;rgb:0000/0000/0000\x07", "\x1b]10;rgb:ffff/ffff/ffff\x1b\\", ""]) {
    expect(terminalRepliesOnly(reply)).toBe(true);
  }
  for (const typed of ["y", "\r", "\x1b[A", "\x1b", "\x03", "hello\r", "\x1b[Iy", "1"]) expect(terminalRepliesOnly(typed)).toBe(false);
});

test("exactly two words are reports", () => {
  expect(parseReport("waiting")).toBe("waiting");
  expect(parseReport("  Working\n")).toBe("working");
  for (const other of ["", "done", "waiting now", "wait", "WAITING!"]) expect(parseReport(other)).toBeUndefined();
});

test("a report file is read only when it is a small regular file", async () => {
  const dir = await tempDir("osd-report-");
  const path = join(dir, "agent-state");
  expect(await readReport(path)).toBeUndefined(); // missing
  await writeFile(path, "waiting\n");
  const first = await readReport(path);
  expect(first?.state).toBe("waiting");
  await writeFile(path, "x".repeat(REPORT_MAX_BYTES + 1));
  expect(await readReport(path, first)).toBeUndefined(); // too large
  await writeFile(path, "finished");
  expect(await readReport(path)).toBeUndefined(); // not one of the words
  const target = join(dir, "target");
  await writeFile(target, "waiting");
  const link = join(dir, "link");
  await symlink(target, link);
  expect(await readReport(link)).toBeUndefined(); // a link is not followed
  const folder = join(dir, "folder");
  await mkdir(folder);
  expect(await readReport(folder)).toBeUndefined();
  // Unchanged modification time and size: the known report is returned without reading again.
  await writeFile(path, "waiting");
  const { mtimeMs, size } = await lstat(path);
  const known = { state: "working" as const, mtimeMs, size };
  expect((await readReport(path, known))?.state).toBe("working");
});

test("a live managed completion is accepted only for the current server-issued action identity and phase", async () => {
  const { manager, s, view, stateFile } = await running();
  const actionId = (manager.get(s.id) as import("../src/shared/types.ts").ChangeSession).managedActionId as string;
  await writeFile(stateFile, JSON.stringify({ kind: "phase-complete", actionId: "old-server-action-id", phase: "implement", revision: 1 }));
  await manager.readReports();
  expect(manager.managedCompletion(s.id)).toBeUndefined();
  manager.write(s.id, `complete implement ${actionId}\r`);
  await waitFor(() => view.text().includes(`you said: complete implement ${actionId}`), "the completion report command");
  await manager.readReports();
  expect(manager.managedCompletion(s.id)).toEqual({ kind: "phase-complete", actionId, phase: "implement", revision: 1 });
  const next = await manager.prompt(s.id, { action: "implement" });
  expect(next.submitted).toBe(true);
  await manager.readReports();
  expect(manager.managedCompletion(s.id)).toBeUndefined();
});

test("the user can confirm a missing phase report, and later terminal input invalidates that confirmation", async () => {
  const { h, manager, s, view } = await running();
  const actionId = (manager.get(s.id) as import("../src/shared/types.ts").ChangeSession).managedActionId as string;
  expect(manager.managedCompletion(s.id)).toBeUndefined();
  const handler = createFetchHandler({ state: { config: h.config, scanner: new Scanner(() => h.config, { persist: false }, h.snapshot), sessions: manager }, indexHtml: "" });
  const endpoint = `http://127.0.0.1/api/sessions/${s.id}/confirm-phase-complete`;
  const stale = await handler(new Request(endpoint, { method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ actionId: "stale-action-id-123456" }) }));
  expect(stale.status).toBe(409);
  const confirmed = await handler(new Request(endpoint, { method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ actionId }) }));
  expect(confirmed.status).toBe(200);
  expect(manager.managedCompletion(s.id)).toEqual({ kind: "phase-complete", actionId, phase: "implement", revision: 1 });
  await manager.confirmPhaseComplete(s.id, actionId);
  expect(manager.managedCompletion(s.id)).toEqual({ kind: "phase-complete", actionId, phase: "implement", revision: 2 });
  await expect(manager.confirmPhaseComplete(s.id, "stale-action-id-123456")).rejects.toMatchObject({ status: 409 });
  const before = view.text();
  manager.write(s.id, "continue work\r");
  await waitFor(() => view.text() !== before, "the user input");
  expect((manager.get(s.id) as import("../src/shared/types.ts").ChangeSession).managedActionId).not.toBe(actionId);
  expect(manager.managedCompletion(s.id)).toBeUndefined();
  expect((manager.get(s.id) as import("../src/shared/types.ts").ChangeSession).phaseCompletionConfirmedRevision).toBeUndefined();
});

test("managed completion reports are bounded JSON tied to a server-issued action", async () => {
  const dir = await tempDir("osd-completion-report-");
  const path = join(dir, "agent-state");
  const report = { kind: "phase-complete", actionId: "server-issued-action-id", phase: "draft", revision: 1 } as const;
  expect(parseCompletionReport(JSON.stringify(report))).toEqual(report);
  expect(parseCompletionReport(JSON.stringify({ ...report, actionId: "stale" }))).toBeUndefined();
  expect(parseCompletionReport(JSON.stringify({ ...report, phase: "custom" }))).toBeUndefined();
  expect(parseCompletionReport(JSON.stringify({ ...report, revision: 0 }))).toBeUndefined();
  expect(parseCompletionReport("waiting")).toBeUndefined();
  await writeFile(path, JSON.stringify(report));
  expect(await readCompletionReport(path)).toEqual(report);
  const link = join(dir, "link");
  await symlink(path, link);
  expect(await readCompletionReport(link)).toBeUndefined();
});

test("a resize and the redraw it provokes do not count as activity, and the redraw is still shown", async () => {
  const { manager, s, view } = await running();
  const before = manager.get(s.id).lastOutputAt;
  expect(before).toBeTruthy();
  manager.resize(s.id, 91, 30);
  await waitFor(() => view.text().includes("redrawn at 91 columns"), "the agent redraws");
  await sleep(ECHO_MS + 100);
  expect(manager.get(s.id).lastOutputAt).toBe(before);
  // focus reports, as a console sends when it takes the keyboard, are passed on and change nothing either
  manager.write(s.id, "\x1b[I");
  await sleep(ECHO_MS + 100);
  expect(manager.get(s.id).lastOutputAt).toBe(before);
  // the redraw is in the scrollback a late viewer receives
  const late = await watch(manager, s.id);
  expect(late.text()).toContain("redrawn at 91 columns");
});

test("keystroke echo is not activity; output that outlasts the echo window is", async () => {
  const { manager, s, view } = await running();
  const before = manager.get(s.id).lastOutputAt;
  manager.write(s.id, "hello\r");
  await waitFor(() => view.text().includes("you said: hello"), "echo");
  await sleep(ECHO_MS + 100);
  expect(manager.get(s.id).lastOutputAt).toBe(before);

  const sent = Date.now();
  manager.write(s.id, `stream ${ECHO_MS * 3}\r`);
  await waitFor(() => Date.parse(manager.get(s.id).lastOutputAt ?? "0") > sent + ECHO_MS, "work past the window is stamped");
});

test("every session gets a state file path in its record folder, and none is there when it starts", async () => {
  const { manager, s, view, stateFile } = await running();
  expect(stateFile).toBe(join(sessionsDir(), s.id, "agent-state"));
  expect(view.text()).toContain(`state=${stateFile}`);
  expect(existsSync(stateFile)).toBe(false);
  await report(manager, view, s.id, "waiting");
  expect(await readFile(stateFile, "utf8")).toBe("waiting");
});

test("a waiting report is shown until the user answers or the agent reports working; viewing keeps it", async () => {
  const { manager, s, view, stateFile } = await running();
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeUndefined();

  await report(manager, view, s.id, "waiting");
  await manager.readReports();
  const reported = manager.get(s.id).waitingReportedAt;
  expect(reported).toBeTruthy();

  // Opening the console: a resize and a focus report. Neither is the user answering.
  manager.resize(s.id, 100, 30);
  manager.write(s.id, "\x1b[I");
  await sleep(50);
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBe(reported);

  // A keystroke is.
  manager.write(s.id, "y");
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeUndefined();

  // So is a shortcut submitted on the user's behalf.
  manager.write(s.id, "\r");
  await report(manager, view, s.id, "waiting");
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeTruthy();
  expect(await manager.submit(s.id, "continue")).toEqual({ submitted: true });
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeUndefined();

  // An agent resuming on its own: written directly, as a hook would, with no input from anyone.
  await sleep(20);
  await writeFile(stateFile, "waiting");
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeTruthy();
  await sleep(20);
  await writeFile(stateFile, "working");
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeUndefined();

  // Unrecognised content is no report.
  await sleep(20);
  await writeFile(stateFile, "waiting for review");
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeUndefined();
});

test("a report is never stored, ends with the process, and does not survive a resume", async () => {
  const { manager, s, stateFile } = await running();
  await writeFile(stateFile, "waiting");
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeTruthy();
  // The record is written while the report is current: it must leave the report out.
  const store = new SessionStore();
  await store.saveMeta(manager.get(s.id));
  expect(await readFile(join(dirname(stateFile), "meta.json"), "utf8")).not.toContain("waitingReportedAt");
  const closed = await manager.close(s.id, { removeWorktree: false });
  expect(closed.session.waitingReportedAt).toBeUndefined();
  const meta = await readFile(join(dirname(stateFile), "meta.json"), "utf8");
  expect(meta).not.toContain("waitingReportedAt");

  expect(existsSync(stateFile)).toBe(true); // left by the ended run…
  const resumed = await manager.resume(s.id);
  expect(existsSync(stateFile)).toBe(false); // …and gone before the next one starts
  await manager.readReports();
  expect(manager.get(resumed.id).waitingReportedAt).toBeUndefined();
});

test("deleting a record removes its state file with it", async () => {
  const { manager, s, stateFile } = await running();
  await writeFile(stateFile, "waiting");
  await manager.close(s.id, { removeWorktree: false });
  await manager.remove(s.id);
  expect(existsSync(stateFile)).toBe(false);
  expect(existsSync(dirname(stateFile))).toBe(false);
});

test("activity hooks survive redraws independently of the phase completion file", async () => {
  const { manager, s, stateFile } = await running();
  const activity = new SessionStore().activityPath(s.id);
  const actionId = (manager.get(s.id) as import("../src/shared/types.ts").ChangeSession).managedActionId as string;
  const completion = { kind: "phase-complete", phase: "implement", revision: 1, actionId } as const;
  await writeFile(stateFile, JSON.stringify(completion));
  await writeFile(activity, "waiting");
  manager.resize(s.id, 120, 40);
  manager.write(s.id, "\x1b[I");
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeTruthy();
  expect(manager.managedCompletion(s.id)).toEqual(completion);
  await sleep(5);
  manager.write(s.id, "y");
  await manager.readReports();
  expect(manager.get(s.id).waitingReportedAt).toBeUndefined();
});
