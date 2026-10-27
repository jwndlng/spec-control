import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { realpath, rm } from "node:fs/promises";
import { basename } from "node:path";
import { createFetchHandler, type AppState } from "../src/server/api.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { Session, SessionWorktree } from "../src/shared/types.ts";
import { installFakeEditor, type EditorHarness } from "./editorHelpers.ts";
import { treeFingerprint, useTempHome } from "./helpers.ts";
import { harness, type Harness } from "./sessionHelpers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
let editor: EditorHarness | undefined;
const managers: Harness[] = [];

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  editor?.restore();
  editor = undefined;
  for (const h of managers.splice(0)) await h.manager.shutdown();
});
afterAll(() => cleanup());

async function serve(h: Harness): Promise<(path: string, init?: RequestInit) => Promise<Response>> {
  managers.push(h);
  const state: AppState = { config: h.config, scanner: new Scanner(() => h.config, { persist: false }, h.snapshot), sessions: h.manager };
  const handler = createFetchHandler({ state, indexHtml: "<title>stub</title>" });
  return (path, init) => handler(new Request(`http://127.0.0.1:4711${path}`, init));
}

const post = (body?: unknown, headers: Record<string, string> = JSON_HEADERS): RequestInit => ({ method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });

/** An ended Implement session of `upgrade-runtime`, with its worktree still there. */
async function endedSession(call: Awaited<ReturnType<typeof serve>>, h: Harness): Promise<Session> {
  const session = (await (await call("/api/sessions", post({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" }))).json()) as Session;
  await call(`/api/sessions/${session.id}/close`, post({}));
  return session;
}

test("the session list reports the editor in effect and whether it was found", async () => {
  const h = await harness();
  const call = await serve(h);
  const listed = await (await call("/api/sessions")).json();
  expect(listed.editor.command).toEqual(["code"]);
  expect(typeof listed.editor.found).toBe("boolean");
  h.config.agentSessions.editor = ["my-editor-osd"];
  expect((await (await call("/api/sessions")).json()).editor).toEqual({ command: ["my-editor-osd"], found: false });
  editor = await installFakeEditor("my-editor-osd");
  expect((await (await call("/api/sessions")).json()).editor).toEqual({ command: ["my-editor-osd"], found: true });
});

test("opening a session's folder and a session worktree starts the editor there and changes nothing", async () => {
  editor = await installFakeEditor();
  const h = await harness();
  h.config.agentSessions.editor = ["fake-editor"];
  const call = await serve(h);
  const session = await endedSession(call, h);
  const before = [await treeFingerprint(h.repoPath), await treeFingerprint(session.worktreePath)];
  const sessionCount = h.manager.list().length;

  const opened = await call(`/api/sessions/${session.id}/editor`, post({}));
  expect(opened.status).toBe(200);
  expect(await opened.json()).toEqual({ started: true, command: ["fake-editor", session.worktreePath] });
  const cwd = await realpath(session.worktreePath); // the temp home sits behind a symlink on macOS
  expect(await editor.waitForStarts(1)).toEqual([{ argv: [session.worktreePath], cwd }]);

  const worktrees = (await (await call("/api/sessions")).json()).worktrees as SessionWorktree[];
  const worktree = worktrees.find((w) => w.path === session.worktreePath);
  expect(worktree).toBeDefined();
  const byName = await call("/api/worktrees/editor", post({ repoId: h.repoId, name: worktree?.name }));
  expect(byName.status).toBe(200);
  expect((await editor.waitForStarts(2))[1]).toEqual({ argv: [session.worktreePath], cwd });
  expect(basename(session.worktreePath)).toBe(worktree?.name as string);

  expect(h.manager.list().length).toBe(sessionCount); // no session record for an editor
  expect(h.manager.get(session.id).state).toBe("exited"); // the session itself untouched
  expect([await treeFingerprint(h.repoPath), await treeFingerprint(session.worktreePath)]).toEqual(before);
});

test("refusals: invalid or unknown names, consoles, other origins, a missing editor and a deleted folder start nothing", async () => {
  editor = await installFakeEditor();
  const h = await harness();
  h.config.agentSessions.editor = ["fake-editor"];
  const call = await serve(h);
  const session = await endedSession(call, h);

  expect((await call("/api/worktrees/editor", post({ repoId: h.repoId, name: "../x" }))).status).toBe(400);
  expect((await call("/api/worktrees/editor", post({ repoId: h.repoId, name: "no-such-worktree" }))).status).toBe(404);
  expect((await call("/api/worktrees/editor", post({ repoId: "000000000000", name: "x" }))).status).toBe(404);
  expect((await call("/api/sessions/00000000-0000-4000-8000-000000000000/editor", post({}))).status).toBe(404);
  expect((await call(`/api/sessions/${session.id}/editor`, post({}, { ...JSON_HEADERS, origin: "https://example.com" }))).status).toBe(403);
  expect((await call("/api/worktrees/editor", post({ repoId: h.repoId, name: "x" }, { ...JSON_HEADERS, origin: "https://example.com" }))).status).toBe(403);

  const projectConsole = (await (await call(`/api/repos/${h.repoId}/console`, post({}))).json()) as Session;
  const refusedConsole = await call(`/api/sessions/${projectConsole.id}/editor`, post({}));
  expect(refusedConsole.status).toBe(400);

  h.config.agentSessions.editor = ["my-editor-osd"];
  const notFound = await call(`/api/sessions/${session.id}/editor`, post({}));
  expect(notFound.status).toBe(503);
  expect((await notFound.json()).error).toContain("my-editor-osd");
  h.config.agentSessions.editor = ["fake-editor"];

  await rm(session.worktreePath, { recursive: true, force: true });
  const gone = await call(`/api/sessions/${session.id}/editor`, post({}));
  expect(gone.status).toBe(409);
  expect((await gone.json()).error).toContain("no longer exists");

  await new Promise((r) => setTimeout(r, 300));
  expect(await editor.starts()).toEqual([]);
});

test("with agent sessions off, or the repository excluded, both routes are refused with 403", async () => {
  editor = await installFakeEditor();
  const h = await harness();
  h.config.agentSessions.editor = ["fake-editor"];
  const call = await serve(h);
  const session = await endedSession(call, h);
  const name = basename(session.worktreePath);

  h.config.repos[0] = { ...h.config.repos[0], agent: { enabled: false } };
  expect((await call(`/api/sessions/${session.id}/editor`, post({}))).status).toBe(403);
  expect((await call("/api/worktrees/editor", post({ repoId: h.repoId, name }))).status).toBe(403);
  h.config.repos[0] = { ...h.config.repos[0], agent: undefined };
  h.config.agentSessions.enabled = false;
  expect((await call(`/api/sessions/${session.id}/editor`, post({}))).status).toBe(403);
  expect((await call("/api/worktrees/editor", post({ repoId: h.repoId, name }))).status).toBe(403);

  await new Promise((r) => setTimeout(r, 300));
  expect(await editor.starts()).toEqual([]);
});
