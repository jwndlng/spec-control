// Stopping the dashboard: the real CLI, a temporary home and one running fake-agent session, stopped with SIGTERM.
// What the stop must leave behind is the session's ended line in `activity.jsonl` and no agent process.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultAgentSessions, defaultConfig, newRepoConfig } from "../src/server/config.ts";
import type { Config, Session } from "../src/shared/types.ts";
import { tempDir } from "./helpers.ts";
import { FAKE_AGENT, fakeProfile, tempGitRepo, waitFor } from "./sessionHelpers.ts";

const root = join(import.meta.dir, "..");
let home: string;

beforeAll(async () => {
  if (!existsSync(join(root, "dist", "ui", "index.html"))) {
    const build = Bun.spawn(["bun", "run", join(root, "scripts", "build-ui.ts")], { cwd: root, stdout: "ignore", stderr: "inherit" });
    expect(await build.exited).toBe(0);
  }
  home = await tempDir("osd-stop-home-");
});
afterAll(() => rm(home, { recursive: true, force: true }));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("SIGTERM with a running session whose agent ignores the hang-up: the agent is gone and its end is in activity.jsonl", async () => {
  const repo = newRepoConfig(await tempGitRepo(), true);
  const config: Config = {
    ...defaultConfig(),
    repos: [repo],
    updateCheck: false,
    agentSessions: { ...defaultAgentSessions(), enabled: true, agents: [fakeProfile({ command: [FAKE_AGENT, "--ignore-hangup", "{prompt}"] })], defaultAgent: "fake" },
  };
  await writeFile(join(home, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  const env: Record<string, string> = { ...(process.env as Record<string, string>), SPEC_CONTROL_HOME: home };
  delete env.OPENSPEC_DASHBOARD_HOME;
  const proc = Bun.spawn(["bun", "run", join(root, "src", "server", "index.ts"), "--no-open", "--port", String(port)], { cwd: root, env, stdout: "ignore", stderr: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  let agentPid = 0;
  try {
    await waitFor(async () => {
      const state = await fetch(`${base}/api/state`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
      return state?.repos?.[0]?.ok === true;
    }, "first scan", 20_000);
    const opened = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoId: repo.id, change: "cache-api-calls", action: "implement" }),
    });
    expect(opened.status).toBe(201);
    const session = (await opened.json()) as Session;
    const sessionDir = join(home, "sessions", session.id);
    await waitFor(async () => {
      const file = (await readdir(sessionDir).catch(() => [])).find((f) => f.endsWith(".fake-agent.pid"));
      agentPid = file ? Number(await readFile(join(sessionDir, file), "utf8")) : 0;
      return agentPid > 0;
    }, "agent pid", 10_000);

    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(0);
    expect(alive(agentPid)).toBe(false);
    const lines = (await readFile(join(home, "activity.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toContainEqual(expect.objectContaining({ kind: "session-ended", change: "cache-api-calls", error: expect.stringContaining("the dashboard was stopped") }));
  } finally {
    proc.kill("SIGKILL");
    if (agentPid && alive(agentPid)) process.kill(agentPid, "SIGKILL");
  }
}, 60_000);
