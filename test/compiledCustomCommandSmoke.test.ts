import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { connect, createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultAgentSessions, defaultConfig, newRepoConfig, saveConfig } from "../src/server/config.ts";
import type { AgentProfile } from "../src/shared/types.ts";
import { useTempHome } from "./helpers.ts";
import { tempGitRepo, waitFor } from "./sessionHelpers.ts";

setDefaultTimeout(45_000);
const home = await useTempHome();
let repoPath: string | undefined;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
afterAll(async () => {
  serverProcess?.kill();
  if (serverProcess) await serverProcess.exited;
  if (repoPath) await rm(dirname(repoPath), { recursive: true, force: true });
  await home.cleanup();
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not allocate a local test port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function terminalRelays(port: number, sessionId: string): Promise<void> {
  const socket = connect(port, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => socket.once("connect", resolve).once("error", reject));
    const origin = `http://127.0.0.1:${port}`;
    socket.write([
      `GET /api/sessions/${sessionId}/terminal HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
      `Origin: ${origin}`,
      "\r\n",
    ].join("\r\n"));
    await new Promise<void>((resolve, reject) => {
      let response = Buffer.alloc(0);
      const timeout = setTimeout(() => reject(new Error("compiled terminal did not relay fake-agent output")), 8_000);
      socket.on("data", (chunk) => {
        response = Buffer.concat([response, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
        if (response.includes("101 Switching Protocols") && response.includes("FAKE READY")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
    });
  } finally {
    socket.destroy();
  }
}

test("compiled server applies current custom commands on launch and resume and relays terminal output", async () => {
  const root = join(import.meta.dir, "..");
  const build = Bun.spawn(["bun", "run", "build"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const buildCode = await build.exited;
  if (buildCode !== 0) throw new Error(`bun run build failed with exit ${buildCode}`);

  repoPath = await tempGitRepo();
  const repo = newRepoConfig(repoPath, true);
  repo.agent = { enabled: true, permissionProfile: "less-friction", allowedCommands: ["bun run lint"] };
  const logPath = join(home.home, "fake-agent.jsonl");
  const fakeAgentPath = join(home.home, "fake-claude");
  const quotedLogPath = `'${logPath.replaceAll("'", "'\\''")}'`;
  await writeFile(fakeAgentPath, `#!/bin/sh\nprintf 'RUN\\n' >> ${quotedLogPath}\nprintf '%s\\n' "$@" >> ${quotedLogPath}\nprintf 'FAKE READY\\n'\nwhile IFS= read -r line; do [ "$line" = exit ] && break; done\n`);
  await chmod(fakeAgentPath, 0o755);
  const fakeAgent: AgentProfile = {
    id: "claude", name: "Fake Claude", command: [fakeAgentPath, "{prompt}"],
    resumeCommand: [fakeAgentPath, "--resumed"], prompts: { implement: "implement {change}" },
  };
  const sessions = { ...defaultAgentSessions(), enabled: true, defaultPermissionProfile: "less-friction" as const, agents: [fakeAgent], defaultAgent: fakeAgent.id };
  await saveConfig({ ...defaultConfig(), scanRoots: [repoPath], repos: [repo], agentSessions: sessions });

  const port = await availablePort();
  serverProcess = Bun.spawn([join(root, "dist/spec-control"), "--no-open", "--port", String(port)], {
    cwd: root, env: { ...process.env, SPEC_CONTROL_HOME: home.home }, stdout: "ignore", stderr: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    const response = await fetch(`${base}/api/state`).catch(() => undefined);
    if (!response?.ok) return false;
    const state = await response.json() as { repos?: Array<{ id: string; changes?: Array<{ name: string }> }> };
    return state.repos?.some((item) => item.id === repo.id && item.changes?.some((change) => change.name === "upgrade-runtime")) === true;
  }, "compiled server scan");

  const opened = await fetch(`${base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repoId: repo.id, change: "upgrade-runtime", action: "implement" }) });
  expect(opened.status).toBe(201);
  const session = await opened.json() as { id: string };
  await waitFor(async () => (await readFile(logPath, "utf8").catch(() => "")).includes("bun run lint"), "compiled fake-agent launch");
  const first = await readFile(logPath, "utf8");
  expect(first.split("RUN").length - 1).toBe(1);
  expect(first).toContain("Bash(bun run lint)");
  await terminalRelays(port, session.id);

  const updated = await fetch(`${base}/api/repos/${repo.id}/agent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowedCommands: ["bun run test"] }) });
  expect(updated.status).toBe(200);
  expect((await readFile(logPath, "utf8")).split("RUN").length - 1).toBe(1);
  const closed = await fetch(`${base}/api/sessions/${session.id}/close`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  expect(closed.status).toBe(200);
  const resumed = await fetch(`${base}/api/sessions/${session.id}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  expect(resumed.status, await resumed.clone().text()).toBe(200);
  await waitFor(async () => (await readFile(logPath, "utf8").catch(() => "")).includes("bun run test"), "compiled fake-agent resume");
  const records = await readFile(logPath, "utf8");
  expect(records.split("RUN").length - 1).toBe(2);
  expect(records.slice(records.lastIndexOf("RUN"))).toContain("Bash(bun run test)");
  await fetch(`${base}/api/sessions/${session.id}/close`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
});
