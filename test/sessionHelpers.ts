import { cp, realpath } from "node:fs/promises";
import { join } from "node:path";
import { defaultAgentSessions, defaultConfig, newRepoConfig } from "../src/server/config.ts";
import { openSpec } from "../src/server/frameworks/openspec/index.ts";
import { scanRepo } from "../src/server/scanner.ts";
import { SessionManager, type ManagerDeps } from "../src/server/sessions/manager.ts";
import type { AgentProfile, Config, Snapshot } from "../src/shared/types.ts";
import { FIXTURES, tempDir } from "./helpers.ts";

export const FAKE_AGENT = join(FIXTURES, "fake-agent.ts");

/** The record instruction the server adds for a change of the fixture's OpenSpec repository (agent-sessions). */
export const recordFor = (change: string, archive = false): string => openSpec.recordInstruction({ change, archive });

export const fakeProfile = (patch: Partial<AgentProfile> = {}): AgentProfile => ({
  id: "fake",
  name: "Fake Agent",
  command: [FAKE_AGENT, "{prompt}"],
  prompts: { draft: "draft {change}", implement: "implement {change}", archive: "archive {change}" },
  resumeCommand: [FAKE_AGENT, "--resumed"],
  unsetEnv: ["ANTHROPIC_API_KEY"],
  ...patch,
});

export function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** The synthetic fixture repo as a real git repository (sessions create worktrees of it). Resolved path: macOS temp dirs sit behind a symlink. */
export async function tempGitRepo(): Promise<string> {
  const dir = join(await realpath(await tempDir("osd-repo-")), "demo-ops");
  await cp(join(FIXTURES, "demo-ops"), dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "t");
  // No background maintenance in a test repository. Otherwise git may repack or write `.git/objects/maintenance.lock`
  // while a test is reading the tree, which looks like the repository changing under a test that asserts it did not.
  git(dir, "config", "gc.auto", "0");
  git(dir, "config", "maintenance.auto", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

export interface Harness {
  config: Config;
  snapshot: Snapshot;
  repoId: string;
  repoPath: string;
  manager: SessionManager;
  newManager(extra?: Partial<ManagerDeps>): SessionManager;
}

/** The same fixture tree, deliberately *not* a git repository: OpenSpec managed locally, with no version control. */
export async function tempPlainRepo(): Promise<string> {
  const dir = join(await realpath(await tempDir("osd-plain-")), "demo-ops");
  await cp(join(FIXTURES, "demo-ops"), dir, { recursive: true });
  return dir;
}

export async function harness(overrides: { enabled?: boolean; repoOff?: boolean; agent?: Partial<AgentProfile>; git?: boolean } = {}): Promise<Harness> {
  const repoPath = overrides.git === false ? await tempPlainRepo() : await tempGitRepo();
  const repo = { ...newRepoConfig(repoPath, true), agent: overrides.repoOff ? { enabled: false } : undefined };
  const config: Config = { ...defaultConfig(), repos: [repo], agentSessions: { ...defaultAgentSessions(), enabled: overrides.enabled ?? true, agents: [fakeProfile(overrides.agent)], defaultAgent: "fake" } };
  const snapshot: Snapshot = { generatedAt: new Date().toISOString(), repos: [await scanRepo(repo)] };
  const newManager = (extra: Partial<ManagerDeps> = {}) => new SessionManager({ getConfig: () => config, getSnapshot: () => snapshot, typePromptDelayMs: 150, ...extra });
  return { config, snapshot, repoId: repo.id, repoPath, manager: newManager(), newManager };
}

export async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Collects what a session's terminal shows, as text. */
export async function watch(manager: SessionManager, id: string): Promise<{ text: () => string; ended: () => boolean; detach: () => void }> {
  const decoder = new TextDecoder();
  let seen = "";
  let ended = false;
  const { scrollback, detach } = await manager.attach(id, (chunk) => {
    if (chunk.length === 0) ended = true;
    else seen += decoder.decode(chunk, { stream: true });
  });
  seen = decoder.decode(scrollback, { stream: true }) + seen;
  return { text: () => seen, ended: () => ended, detach };
}
