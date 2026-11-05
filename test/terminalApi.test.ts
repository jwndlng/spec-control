import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { createFetchHandler, createWebSocketHandlers, webSocketRefusal, type AppState, type TerminalSocketData } from "../src/server/api.ts";
import { Scanner } from "../src/server/scanner.ts";
import type { Session } from "../src/shared/types.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useTempHome } from "./helpers.ts";
import { git, harness, waitFor, type Harness } from "./sessionHelpers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
// These tests start real processes in pseudo-terminals and open sockets; slow CI runners need more than the 5 s default.
setDefaultTimeout(30_000);

let cleanup: () => Promise<void>;
const servers: { stop: () => Promise<void> }[] = [];

beforeAll(async () => {
  ({ cleanup } = await useTempHome());
});
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});
afterAll(() => cleanup());

async function serve(h: Harness): Promise<{ http: string; ws: string }> {
  const state: AppState = { config: h.config, scanner: new Scanner(() => h.config, { persist: false }, h.snapshot), sessions: h.manager };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createFetchHandler({ state, indexHtml: "<title>stub</title>" }),
    websocket: createWebSocketHandlers(state) as unknown as Bun.WebSocketHandler<TerminalSocketData>,
  });
  servers.push({ stop: async () => { await h.manager.shutdown(); server.stop(true); } });
  return { http: `http://127.0.0.1:${server.port}`, ws: `ws://127.0.0.1:${server.port}` };
}

const post = (url: string, body?: unknown, headers: Record<string, string> = JSON_HEADERS) => fetch(url, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });

interface Client {
  text: () => string;
  frames: () => string[];
  send: (message: object) => void;
  close: () => void;
  opened: Promise<boolean>;
}

/** A terminal client as the dashboard's page would be, with a chosen Origin. */
function connect(url: string, origin: string | undefined): Client {
  const socket = new WebSocket(url, { headers: origin ? { origin } : {} } as unknown as string[]);
  socket.binaryType = "arraybuffer";
  const decoder = new TextDecoder();
  let text = "";
  const frames: string[] = [];
  socket.onmessage = (event) => {
    if (typeof event.data === "string") frames.push(event.data);
    else text += decoder.decode(new Uint8Array(event.data as ArrayBuffer), { stream: true });
  };
  const opened = new Promise<boolean>((resolve) => {
    socket.onopen = () => resolve(true);
    socket.onerror = () => resolve(false);
    socket.onclose = () => resolve(false);
  });
  return { text: () => text, frames: () => frames, send: (m) => socket.send(JSON.stringify(m)), close: () => socket.close(), opened };
}

test("who may open the terminal socket", () => {
  const req = (url: string, headers: Record<string, string>) => new Request(url, { headers });
  const own = "http://127.0.0.1:4711";
  expect(webSocketRefusal(req(`${own}/api/sessions/x/terminal`, { origin: own }))).toBeUndefined();
  expect(webSocketRefusal(req(`${own}/api/sessions/x/terminal`, { origin: "http://localhost:4711" }))).toBeUndefined();
  expect(webSocketRefusal(req(`${own}/api/sessions/x/terminal`, {}))).toMatch(/origin/); // a browser always sends one
  expect(webSocketRefusal(req(`${own}/api/sessions/x/terminal`, { origin: "https://example.com" }))).toMatch(/origin/);
  expect(webSocketRefusal(req(`${own}/api/sessions/x/terminal`, { origin: "http://127.0.0.1:9999" }))).toMatch(/origin/);
  expect(webSocketRefusal(req(`${own}/api/sessions/x/terminal`, { origin: "null" }))).toMatch(/origin/);
  expect(webSocketRefusal(req(`${own}/api/sessions/x/terminal`, { origin: own, "sec-fetch-site": "cross-site" }))).toMatch(/cross-site/);
  expect(webSocketRefusal(req("http://evil.example:4711/api/sessions/x/terminal", { origin: "http://evil.example:4711" }))).toMatch(/loopback/); // DNS rebinding
});

test("session routes: open, duplicate, refusals, cross-site", async () => {
  const h = await harness();
  const { http } = await serve(h);
  const body = { repoId: h.repoId, change: "upgrade-runtime", action: "implement" };
  expect((await post(`${http}/api/sessions`, body, { ...JSON_HEADERS, origin: "https://example.com" })).status).toBe(403);
  expect((await post(`${http}/api/sessions`, body, { "content-type": "text/plain" })).status).toBe(403);
  expect(h.manager.list()).toEqual([]);

  const opened = await post(`${http}/api/sessions`, body);
  expect(opened.status).toBe(201);
  const session = (await opened.json()) as Session;
  expect(((await (await post(`${http}/api/sessions`, body)).json()) as Session).id).toBe(session.id);
  const listing = await (await fetch(`${http}/api/sessions`)).json();
  expect(listing.sessions.length).toBe(1);
  expect(listing.agents).toEqual([expect.objectContaining({ id: "fake", available: true })]);

  expect((await post(`${http}/api/sessions`, { ...body, change: "no-such-change" })).status).toBe(404);
  expect((await post(`${http}/api/sessions`, { ...body, change: "../../etc" })).status).toBe(400);
  expect((await post(`${http}/api/sessions`, { ...body, action: "deploy" })).status).toBe(400);
  // The route refuses on the sub-state as well: `validate` before `Done`, `implement` once the change is validating.
  expect((await post(`${http}/api/sessions`, { ...body, action: "validate" })).status).toBe(400);
  expect((await post(`${http}/api/sessions`, { ...body, change: "confirm-retention", action: "implement" })).status).toBe(400);
  expect(h.manager.list().length).toBe(1); // still only the session opened above: nothing was started
  expect((await fetch(`${http}/api/sessions/${session.id}`, { method: "DELETE", headers: JSON_HEADERS })).status).toBe(409); // still running
  expect((await fetch(`${http}/api/sessions/${session.id}/terminal`)).status).toBe(403); // a plain GET without the page's Origin
  expect((await fetch(`${http}/api/sessions/${session.id}/terminal`, { headers: { origin: http } })).status).toBe(426); // right origin, but not a WebSocket

  const closed = await (await post(`${http}/api/sessions/${session.id}/close`, {})).json();
  expect(closed.session.state).toBe("exited");
  expect((await fetch(`${http}/api/sessions/${session.id}`, { method: "DELETE", headers: JSON_HEADERS })).status).toBe(200);
  expect(Object.keys(await (await fetch(`${http}/api/state`)).json()).sort()).toEqual(["generatedAt", "repos"]);
});

test("terminal socket: scrollback, typing, resize, exit — and no entry from another origin", async () => {
  const h = await harness();
  const { http, ws } = await serve(h);
  const session = (await (await post(`${http}/api/sessions`, { repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).json()) as Session;
  const url = `${ws}/api/sessions/${session.id}/terminal`;

  expect(await connect(url, "https://example.com").opened).toBe(false);
  expect(await connect(url, undefined).opened).toBe(false);
  expect(await connect(`${ws}/api/sessions/00000000-0000-4000-8000-000000000000/terminal`, http).opened).toBe(false);

  const first = connect(url, http);
  expect(await first.opened).toBe(true);
  await waitFor(() => first.text().includes("fake-agent ready"), "banner over the socket");
  // A resize reaches the agent as an asynchronous signal, so ask until it reports the new width rather than racing it.
  first.send({ type: "resize", cols: 77, rows: 21 });
  await waitFor(async () => {
    first.send({ type: "input", data: "width?\r" });
    await new Promise((r) => setTimeout(r, 100));
    return first.text().includes("(cols=77)");
  }, "the agent sees the resized terminal");
  first.send({ type: "input", data: "from the browser\r" });
  await waitFor(() => first.text().includes("you said: from the browser"), "typed input echoed");

  // a second viewer (another tab) first gets what the terminal has shown so far, then follows along
  const second = connect(url, http);
  expect(await second.opened).toBe(true);
  await waitFor(() => second.text().includes("you said: from the browser"), "scrollback replay");
  second.send({ type: "input", data: "exit\r" });
  await waitFor(() => first.frames().some((f) => JSON.parse(f).type === "exit") && second.frames().some((f) => JSON.parse(f).type === "exit"), "exit frame to every viewer");
  await waitFor(() => h.manager.get(session.id).state === "exited", "exited");

  // an ended session still shows its output, followed by the exit frame
  const late = connect(url, http);
  expect(await late.opened).toBe(true);
  await waitFor(() => late.text().includes("you said: from the browser") && late.frames().length > 0, "stored output for a late viewer");
  for (const c of [first, second, late]) c.close();
});

test("terminal socket: submit sends text on the user's behalf and answers only the socket that asked", async () => {
  const h = await harness();
  const { http, ws } = await serve(h);
  const session = (await (await post(`${http}/api/sessions`, { repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).json()) as Session;
  const url = `${ws}/api/sessions/${session.id}/terminal`;
  const asking = connect(url, http);
  const watching = connect(url, http);
  expect(await asking.opened).toBe(true);
  expect(await watching.opened).toBe(true);
  await waitFor(() => asking.text().includes("fake-agent ready"), "banner");

  const submitted = (c: { frames: () => string[] }) => c.frames().map((f) => JSON.parse(f)).filter((f) => f.type === "submitted");
  asking.send({ type: "submit", data: "Yes, go ahead" });
  await waitFor(() => submitted(asking).length === 1, "the answer frame", 10_000);
  expect(submitted(asking)).toEqual([{ type: "submitted", ok: true }]);
  await waitFor(() => watching.text().includes("you said: Yes, go ahead"), "the agent received the line; every viewer sees it");
  expect(submitted(watching)).toEqual([]);

  // not plain text: refused without touching the terminal, and still answered
  asking.send({ type: "submit", data: "two\rlines" });
  asking.send({ type: "submit", data: 7 });
  await waitFor(() => submitted(asking).length === 3, "refusals are answered too");
  expect(submitted(asking).slice(1)).toEqual([{ type: "submitted", ok: false }, { type: "submitted", ok: false }]);
  expect(asking.text()).not.toContain("you said: two");
  for (const c of [asking, watching]) c.close();
});

test("feature off: nothing can be opened", async () => {
  const h = await harness({ enabled: false });
  const { http } = await serve(h);
  const res = await post(`${http}/api/sessions`, { repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(res.status).toBe(403);
  expect(h.manager.list()).toEqual([]);
});

test("the main console: opened once, same-origin only, attachable, refused change-only routes", async () => {
  const h = await harness();
  const { http, ws } = await serve(h);

  // Another web page cannot start it.
  expect((await post(`${http}/api/console`, undefined, { ...JSON_HEADERS, origin: "https://example.com" })).status).toBe(403);
  expect(h.manager.list()).toEqual([]);

  const first = await post(`${http}/api/console`);
  expect(first.status).toBe(201);
  const session = (await first.json()) as Session;
  expect(session).toMatchObject({ console: true, state: "running" });
  expect(session.repoId).toBeUndefined();
  const again = await post(`${http}/api/console`);
  expect(again.status).toBe(200);
  expect(((await again.json()) as Session).id).toBe(session.id);

  const listed = (await (await fetch(`${http}/api/sessions`)).json()) as { sessions: Session[] };
  expect(listed.sessions.filter((s) => s.console).map((s) => s.id)).toEqual([session.id]);

  // The terminal is served like any session's, under the same guard.
  expect(await connect(`${ws}/api/sessions/${session.id}/terminal`, "https://example.com").opened).toBe(false);
  const client = connect(`${ws}/api/sessions/${session.id}/terminal`, http);
  expect(await client.opened).toBe(true);
  await waitFor(() => client.text().includes("fake-agent ready"), "console output");
  client.send({ type: "input", data: "hello\r" });
  await waitFor(() => client.text().includes("you said: hello"), "console echo");

  expect((await post(`${http}/api/sessions/${session.id}/ship`)).status).toBe(409);
  expect((await post(`${http}/api/sessions/${session.id}/resolve-conflicts`)).status).toBe(409);
  expect((await post(`${http}/api/sessions/${session.id}/prompt`, { action: "implement" })).status).toBe(409);
  expect((await fetch(`${http}/api/sessions/${session.id}/worktree`)).status).toBe(409);
  const closed = await post(`${http}/api/sessions/${session.id}/close`, { removeWorktree: true });
  expect(closed.status).toBe(200);
  expect((await closed.json()).worktree).toBeUndefined();
  client.close();
});

test("the main console is refused while agent sessions are off", async () => {
  const h = await harness({ enabled: false });
  const { http } = await serve(h);
  expect((await post(`${http}/api/console`)).status).toBe(403);
  expect(h.manager.list()).toEqual([]);
});

test("saving a console folder inside a tracked repository is refused; a folder above it is saved", async () => {
  const h = await harness();
  const { http } = await serve(h);
  const put = (consoleDir: string) => fetch(`${http}/api/config`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ ...h.config, agentSessions: { ...h.config.agentSessions, consoleDir } }) });
  const inside = await put(`${h.repoPath}/openspec`);
  expect(inside.status).toBe(400);
  expect((await inside.json()).error).toContain("inside a tracked repository (demo-ops)");
  expect((await put("relative/dir")).status).toBe(400);
  expect((await put(`${h.repoPath}-missing`)).status).toBe(400);
  expect(h.config.agentSessions.consoleDir).toBeUndefined();
  const above = await put(`${h.repoPath}/..`);
  expect(above.status).toBe(200);
  expect((await above.json()).agentSessions.consoleDir).toBe(h.repoPath.replace(/\/demo-ops$/, ""));
});

test("saving a console agent that names no profile is refused and changes nothing", async () => {
  const h = await harness();
  const { http } = await serve(h);
  const res = await fetch(`${http}/api/config`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ ...h.config, agentSessions: { ...h.config.agentSessions, consoleAgent: "nope" } }) });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("agentSessions.consoleAgent");
  expect(h.config.agentSessions.consoleAgent).toBeUndefined();
});

test("the resolve-conflicts route answers each refusal with its own status, and only for a same-origin request", async () => {
  const h = await harness();
  const { http } = await serve(h);
  const route = (id: string) => `${http}/api/sessions/${id}/resolve-conflicts`;

  expect((await post(route("no-such-session"))).status).toBe(404);

  const session = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  await waitFor(() => h.manager.get(session.id).state === "running", "the agent");
  // The branch still merges: there is nothing to resolve.
  const nothing = await post(route(session.id));
  expect(nothing.status).toBe(409);
  expect((await nothing.json()).error).toMatch(/no conflicts to resolve/);

  // A cross-site page in the same browser must not reach it, loopback or not.
  const foreign = await post(route(session.id), undefined, { "content-type": "application/json", origin: "https://example.com" });
  expect(foreign.status).toBe(403);

  h.config.agentSessions.enabled = false;
  expect((await post(route(session.id))).status).toBe(403);
});

test("resolve conflicts is refused for a session that runs in a folder without git", async () => {
  const h = await harness({ git: false });
  const { http } = await serve(h);
  const session = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  expect(session.inPlace).toBe(true);
  const refused = await post(`${http}/api/sessions/${session.id}/resolve-conflicts`);
  expect(refused.status).toBe(400);
  expect((await refused.json()).error).toMatch(/not a git repository/);
});

test("resolve conflicts on an ended session whose agent is gone answers 503 and starts nothing", async () => {
  const h = await harness();
  const { http } = await serve(h);
  const session = await h.manager.open({ repoId: h.repoId, change: "upgrade-runtime", action: "implement" });
  await waitFor(() => h.manager.get(session.id).state === "running", "the agent");
  h.manager.write(session.id, "exit\r");
  await waitFor(() => h.manager.get(session.id).state === "exited", "exit");

  // Give the branch a conflict, so the refusal can only be about the missing executable.
  await writeFile(join(session.worktreePath, "shared.txt"), "branch side\n");
  git(session.worktreePath, "add", "-A");
  git(session.worktreePath, "commit", "-q", "-m", "branch edit");
  await writeFile(join(h.repoPath, "shared.txt"), "main side\n");
  git(h.repoPath, "add", "-A");
  git(h.repoPath, "commit", "-q", "-m", "main edit");

  const agent = h.config.agentSessions.agents[0];
  agent.command = ["osd-no-such-agent-binary", "{prompt}"];
  agent.resumeCommand = undefined;

  const refused = await post(`${http}/api/sessions/${session.id}/resolve-conflicts`);
  expect(refused.status).toBe(503);
  expect(h.manager.get(session.id).state).toBe("exited");
});

test("the sessions list carries an agent's current waiting report; opening a console keeps it, typing ends it", async () => {
  const h = await harness();
  const { http, ws } = await serve(h);
  const session = (await (await post(`${http}/api/sessions`, { repoId: h.repoId, change: "upgrade-runtime", action: "implement" })).json()) as Session;
  const reported = async () => ((await (await fetch(`${http}/api/sessions`)).json()) as { sessions: Session[] }).sessions.find((s) => s.id === session.id)?.waitingReportedAt;
  const client = connect(`${ws}/api/sessions/${session.id}/terminal`, http);
  expect(await client.opened).toBe(true);
  await waitFor(() => client.text().includes("fake-agent ready"), "banner over the socket");
  expect(await reported()).toBeUndefined();

  // The agent's own hook writes the file; here the fake agent does, asked through the terminal.
  client.send({ type: "input", data: "report waiting\r" });
  await waitFor(async () => (await reported()) !== undefined, "the report reaches the list");

  // A console opening: its size and a focus report.
  const second = connect(`${ws}/api/sessions/${session.id}/terminal`, http);
  expect(await second.opened).toBe(true);
  second.send({ type: "resize", cols: 88, rows: 22 });
  second.send({ type: "input", data: "\x1b[I" });
  await waitFor(() => second.text().includes("redrawn at 88 columns"), "the agent redraws for the new viewer");
  expect(await reported()).toBeTruthy();

  second.send({ type: "input", data: "y" });
  await waitFor(async () => (await reported()) === undefined, "typing ends the report");
  client.close();
  second.close();
});

test("custom API starts without a profile prompt, reuses the running session and reports a missing executable", async () => {
  const h = await harness({ agent: { prompts: {} } });
  const { http } = await serve(h);
  const body = { repoId: h.repoId, change: "upgrade-runtime", action: "custom" };
  const response = await post(`${http}/api/sessions`, body);
  expect(response.status).toBe(201);
  const session = await response.json() as Session;
  expect(session.action).toBe("custom");
  expect((await (await post(`${http}/api/sessions`, body)).json()).id).toBe(session.id);
  await h.manager.close(session.id);
  h.config.agentSessions.agents[0].command = ["missing-custom-agent-executable"];
  const missing = await post(`${http}/api/sessions`, body);
  expect(missing.status).toBe(503);
  expect(await missing.text()).toContain("Fake Agent");
});
