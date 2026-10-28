import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultConfig } from "../src/server/config.ts";
import { environmentReport, resetEnvironmentCache } from "../src/server/environment.ts";
import { type MigrationOutcome, recordMigrationOutcome } from "../src/server/homeMigration.ts";
import { useGitLookup } from "../src/server/paths.ts";
import type { Config, EnvironmentCheck, EnvironmentReport, RepoSnapshot, Snapshot } from "../src/shared/types.ts";
import { fakeMac, tempDir, useTempHome } from "./helpers.ts";

/** Every tool the report looks for, as a stub that is never meant to be run — except `git`, which answers `config --get`. */
const TOOLS = ["git", "openspec", "gh", "claude"] as const;

interface Machine {
  bin: string;
  /** One line per `git` invocation, so a memoised report can be told from a recomputed one. */
  gitLog: string;
  /** This machine's `gh` configuration directory. Empty unless a test writes `hosts.yml` into it. */
  ghDir: string;
}

/** Restores an environment variable to what it was, whatever a test did to it in between. */
function holdEnv(name: string): void {
  const previous = process.env[name];
  cleanups.push(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

/**
 * A PATH holding only the stubs asked for, and a `gh` configuration of its own. The `git` stub answers
 * `config --get user.name`/`user.email` from files in its own directory, so an identity can be present or absent
 * without touching the machine's real git configuration. Every variable the report reads is taken over here — without
 * that, a report would be `ok` on a developer's machine, where `gh` is logged in, and `warning` on a CI runner, where
 * it is not.
 */
async function machine(tools: readonly string[] = TOOLS, identity: { name?: string; email?: string } = { name: "Demo User", email: "demo@example.invalid" }): Promise<Machine> {
  const bin = await tempDir("osd-bin-");
  const gitLog = join(bin, "git.log");
  const ghDir = await tempDir("osd-gh-");
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "GH_CONFIG_DIR", "XDG_CONFIG_HOME"]) holdEnv(name);
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.GH_CONFIG_DIR = ghDir;
  if (identity.name !== undefined) await writeFile(join(bin, "user.name"), identity.name);
  if (identity.email !== undefined) await writeFile(join(bin, "user.email"), identity.email);
  for (const tool of tools) {
    const script =
      tool === "git"
        ? // Only `bin` is on the PATH while this runs, so the stub uses shell builtins alone — no `cat`.
          `#!/bin/sh\necho "$@" >> "${gitLog}"\n[ "$1" = config ] || exit 0\nf="${bin}/$3"\n[ -f "$f" ] || exit 1\nIFS= read -r value < "$f"\necho "$value"\n`
        : "#!/bin/sh\nexit 0\n";
    await writeFile(join(bin, tool), script);
    await chmod(join(bin, tool), 0o755);
  }
  return { bin, gitLog, ghDir };
}

/** What `gh auth login` leaves behind: a host entry. The report only ever checks that this file is there and not empty. */
async function ghCredentials(ghDir: string): Promise<string> {
  const hosts = join(ghDir, "hosts.yml");
  await writeFile(hosts, "github.com:\n    user: demo\n    git_protocol: https\n");
  return hosts;
}

const originalPath = process.env.PATH;
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  process.env.PATH = originalPath;
  resetEnvironmentCache();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Runs the report with `bin` as the whole PATH and the dashboard home in a temp directory. */
async function report(
  bin: string,
  config: Config = defaultConfig(),
  snapshot: Snapshot = { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] },
  platform?: string,
): Promise<EnvironmentReport> {
  const home = await useTempHome();
  cleanups.push(home.cleanup);
  process.env.PATH = bin;
  resetEnvironmentCache();
  return environmentReport(config, snapshot, { platform });
}

function byId(result: EnvironmentReport, id: string): EnvironmentCheck {
  const check = result.checks.find((c) => c.id === id);
  if (!check) throw new Error(`no check ${id} in ${result.checks.map((c) => c.id).join(", ")}`);
  return check;
}

function withAgents(config: Config = defaultConfig()): Config {
  return { ...config, agentSessions: { ...config.agentSessions, enabled: true } };
}

function repoSnapshot(id: string, isGit: boolean): RepoSnapshot {
  return { id, name: id, path: `/w/acme/${id}`, ok: true, scannedAt: "2026-09-30T10:00:00.000Z", isGit, worktrees: [], changes: [] };
}

// 2.1 — the report's shape, order and fold.
test("a fully equipped machine yields ok, in a stable order", async () => {
  const { bin, ghDir } = await machine();
  await ghCredentials(ghDir);
  const result = await report(bin, withAgents());
  expect(result.status).toBe("ok");
  expect(result.checks.map((c) => c.id)).toEqual(["dashboard-home", "git", "git-identity", "openspec-cli", "agent:claude", "github-cli"]);
  for (const check of result.checks) expect(check.remedy).toBeUndefined();
  for (const check of result.checks) expect(check.instructions).toBeUndefined();
  expect(Date.parse(result.checkedAt)).toBeGreaterThan(0);
});

test("the worst status wins", async () => {
  // No tools at all: the home is fine, so `problem` can only come from the default agent being missing.
  const { bin } = await machine([]);
  const result = await report(bin, withAgents());
  expect(byId(result, "agent:claude").status).toBe("problem");
  expect(byId(result, "openspec-cli").status).toBe("warning");
  expect(result.status).toBe("problem");
});

test("ok and not-needed together are ok overall", async () => {
  const { bin } = await machine(["git", "openspec"]);
  const result = await report(bin);
  expect(result.checks.map((c) => c.status).sort()).toEqual(["not-needed", "not-needed", "not-needed", "ok", "ok", "ok"]);
  expect(result.status).toBe("ok");
});

// 2.2 — the dashboard home check.
test("the dashboard home is ok and the probe leaves nothing behind", async () => {
  const { bin } = await machine();
  const home = await useTempHome();
  cleanups.push(home.cleanup);
  process.env.PATH = bin;
  resetEnvironmentCache();
  const result = await environmentReport(defaultConfig(), { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] });
  expect(byId(result, "dashboard-home").status).toBe("ok");
  expect(byId(result, "dashboard-home").found).toContain(home.home);
  expect((await readdir(home.home)).filter((n) => n.startsWith(".env-check-"))).toEqual([]);
});

// The home migration's leftovers, reported on the same check (the spec allows no other checks).
async function homeCheckWith(outcome: MigrationOutcome): Promise<EnvironmentCheck> {
  const { bin } = await machine();
  const home = await useTempHome();
  cleanups.push(home.cleanup);
  recordMigrationOutcome(outcome);
  cleanups.push(async () => recordMigrationOutcome({ kind: "nothing" }));
  process.env.PATH = bin;
  resetEnvironmentCache();
  return byId(await environmentReport(defaultConfig(), { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] }), "dashboard-home");
}

test("a finished migration says nothing about the former home", async () => {
  const check = await homeCheckWith({ kind: "migrated", from: "/w/u/.openspec-dashboard", to: "/w/u/.spec-control", pending: [] });
  expect(check.status).toBe("ok");
  expect(check.found).not.toContain("openspec-dashboard");
});

test("a pending migration step is a warning naming the worktree and the reason", async () => {
  const check = await homeCheckWith({ kind: "retried", pending: [{ kind: "repair", worktree: "/w/u/.spec-control/worktrees/3d84480c2b4d/feat-x", error: "its repository could not be found" }] });
  expect(check.status).toBe("warning");
  expect(check.found).toContain("/w/u/.spec-control/worktrees/3d84480c2b4d/feat-x");
  expect(check.found).toContain("its repository could not be found");
  expect(check.remedy).toContain("next start");
});

test("a resumed migration that still has a step left says it was resumed and names the step", async () => {
  const check = await homeCheckWith({
    kind: "retried",
    pending: [{ kind: "repair", worktree: "/w/u/.spec-control/worktrees/3d84480c2b4d/feat-x", error: "its repository could not be found" }],
    resumed: { from: "/w/u/.openspec-dashboard", to: "/w/u/.spec-control" },
  });
  expect(check.status).toBe("warning");
  expect(check.found).toContain("an earlier start was stopped in the middle of");
  expect(check.found).toContain("/w/u/.spec-control/worktrees/3d84480c2b4d/feat-x");
});

test("a refused move is a warning saying the former home is in use", async () => {
  const check = await homeCheckWith({ kind: "refused", reason: "EBUSY: resource busy" });
  expect(check.status).toBe("warning");
  expect(check.found).toContain("EBUSY");
});

test("a former home left next to the new one is a warning naming it", async () => {
  const check = await homeCheckWith({ kind: "both", old: "/w/u/.openspec-dashboard" });
  expect(check.status).toBe("warning");
  expect(check.found).toContain("/w/u/.openspec-dashboard");
  expect(check.found).toContain("no longer used");
});

test("a home that cannot be written is a problem naming the directory", async () => {
  const { bin } = await machine();
  const parent = await tempDir("osd-ro-");
  const home = join(parent, "home");
  await mkdir(home);
  await chmod(home, 0o500);
  cleanups.push(() => chmod(home, 0o700));
  const previous = process.env.SPEC_CONTROL_HOME;
  process.env.SPEC_CONTROL_HOME = home;
  cleanups.push(() => {
    if (previous === undefined) delete process.env.SPEC_CONTROL_HOME;
    else process.env.SPEC_CONTROL_HOME = previous;
  });
  process.env.PATH = bin;
  resetEnvironmentCache();
  const result = await environmentReport(defaultConfig(), { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] });
  const check = byId(result, "dashboard-home");
  expect(check.status).toBe("problem");
  expect(check.found).toContain(home);
  expect(check.remedy).toContain("SPEC_CONTROL_HOME");
  expect(result.status).toBe("problem");
});

// 2.3 — the PATH lookups.
test("git and the openspec CLI report where they were found", async () => {
  const { bin } = await machine();
  const result = await report(bin);
  expect(byId(result, "git").found).toBe(join(bin, "git"));
  expect(byId(result, "openspec-cli").found).toBe(join(bin, "openspec"));
});

test("a missing openspec CLI is a warning with a remedy", async () => {
  const { bin } = await machine(["git", "gh", "claude"]);
  const result = await report(bin);
  const check = byId(result, "openspec-cli");
  expect(check.status).toBe("warning");
  expect(check.found).toContain("not found on the PATH");
  expect(check.remedy).toContain("openspec");
});

// 2.4 — the committer identity.
test("a missing user.name alone is the one named", async () => {
  const { bin } = await machine(TOOLS, { email: "demo@example.invalid" });
  const check = byId(await report(bin, withAgents()), "git-identity");
  expect(check.status).toBe("warning");
  expect(check.found).toContain("user.name");
  expect(check.found).not.toContain("user.email");
  expect(check.found).toContain("is not configured");
});

test("both missing are reported together", async () => {
  const { bin } = await machine(TOOLS, {});
  const check = byId(await report(bin, withAgents()), "git-identity");
  expect(check.found).toContain("user.name and user.email");
  expect(check.found).toContain("are not configured");
});

test("a configured identity is shown", async () => {
  const { bin } = await machine();
  expect(byId(await report(bin, withAgents()), "git-identity")).toMatchObject({ status: "ok", found: "Demo User <demo@example.invalid>" });
});

test("the identity is read outside every tracked repository, which nothing in them notices", async () => {
  const { bin, gitLog } = await machine();
  const repo = await tempDir("osd-repo-");
  await mkdir(join(repo, "openspec"), { recursive: true });
  await writeFile(join(repo, "openspec", "config.yaml"), "schema: spec-driven\n");
  const config: Config = { ...withAgents(), repos: [{ id: "r1", path: repo, name: "demo-ops", enabled: true }] };
  const before = await treeOf(repo);
  const result = await report(bin, config, { generatedAt: "2026-09-30T10:00:00.000Z", repos: [repoSnapshot("r1", true)] });
  expect(byId(result, "git-identity").status).toBe("ok");
  expect(await treeOf(repo)).toEqual(before);
  // The stub logs its own cwd nowhere, so the proof that it ran outside the repository is that the repository is untouched
  // and that the only git invocations were `config --get`.
  const lines = (await Bun.file(gitLog).text()).trim().split("\n");
  expect(lines.every((line) => line.startsWith("config --get user."))).toBe(true);
});

test("without git the identity says it could not be read", async () => {
  const { bin } = await machine(["openspec", "gh", "claude"]);
  const check = byId(await report(bin, withAgents()), "git-identity");
  expect(check.found).toContain("git was not found");
  expect(check.status).toBe("warning");
});

// macos-git-check — Apple's `/usr/bin/git` placeholder, simulated: no test here needs a Mac, nor depends on having one.
async function macReport(path: string, view: "settings" | "setup" = "settings"): Promise<EnvironmentReport> {
  const home = await useTempHome();
  cleanups.push(home.cleanup);
  process.env.PATH = path;
  resetEnvironmentCache();
  return environmentReport(withAgents(), { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] }, { platform: "darwin", view });
}

async function useFakeMac() {
  const mac = await fakeMac();
  cleanups.push(mac.restore);
  return mac;
}

test("the macOS placeholder is not git, in Settings and in the setup view", async () => {
  const mac = await useFakeMac();
  const { bin } = await machine(["openspec", "gh", "claude"]);
  for (const view of ["settings", "setup"] as const) {
    const result = await macReport(`${bin}:${mac.usrBin}`, view);
    const git = byId(result, "git");
    expect(git.status).toBe(view === "setup" ? "problem" : "warning");
    expect(git.found).toContain(join(mac.usrBin, "git"));
    expect(git.found).toContain("placeholder");
    expect(git.found).toContain("command line developer tools are not installed");
    expect(git.instructions?.[0].command).toBe("xcode-select --install");
    const identity = byId(result, "git-identity");
    expect(identity.found).toContain("git was not found");
    expect(identity.instructions?.map((step) => step.command)).toEqual(["xcode-select --install", 'git config --global user.name "Your Name"', 'git config --global user.email "you@example.com"']);
  }
  expect(await mac.placeholderRuns()).toEqual([]);
});

test("no git config runs through the placeholder", async () => {
  const mac = await useFakeMac();
  await macReport(mac.usrBin);
  await environmentReport(withAgents(), { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] }, { platform: "darwin", force: true });
  expect(await mac.placeholderRuns()).toEqual([]);
});

test("the placeholder is git when DEVELOPER_DIR names the developer tools", async () => {
  const mac = await useFakeMac();
  mac.setDeveloperDirVariable(await mac.installDeveloperTools());
  const result = await macReport(mac.usrBin);
  expect(byId(result, "git")).toMatchObject({ status: "ok", found: join(mac.usrBin, "git") });
  // Through the placeholder, which on a Mac with the tools runs their git.
  expect((await mac.placeholderRuns()).sort()).toEqual(["config --get user.email", "config --get user.name"]);
});

test("the placeholder is git when xcode-select's link points at the developer tools", async () => {
  const mac = await useFakeMac();
  await symlink(await mac.installDeveloperTools(), mac.selectLink);
  expect(byId(await macReport(mac.usrBin), "git")).toMatchObject({ status: "ok", found: join(mac.usrBin, "git") });
});

test("a developer directory without git does not make the placeholder git", async () => {
  const mac = await useFakeMac();
  const empty = await tempDir("osd-devdir-");
  await symlink(empty, mac.selectLink);
  expect(byId(await macReport(mac.usrBin), "git").status).toBe("warning");
});

test("a git before the placeholder on the PATH is git; one after it is not", async () => {
  const mac = await useFakeMac();
  const { bin } = await machine(["git"]);
  expect(byId(await macReport(`${bin}:${mac.usrBin}`), "git")).toMatchObject({ status: "ok", found: join(bin, "git") });
  expect(byId(await macReport(`${mac.usrBin}:${bin}`), "git")).toMatchObject({ status: "warning" });
  expect(await mac.placeholderRuns()).toEqual([]);
});

test("off macOS the same path is simply git", async () => {
  const mac = await useFakeMac();
  useGitLookup({ platform: "linux", placeholder: join(mac.usrBin, "git") });
  expect(byId(await macReport(mac.usrBin), "git").status).toBe("ok");
});

// 2.5 — the GitHub CLI.
test("gh not installed is distinct from gh without credentials", async () => {
  const withoutGh = byId(await report((await machine(["git", "openspec", "claude"])).bin, withAgents()), "github-cli");
  expect(withoutGh.found).toContain("`gh` not found");
  expect(withoutGh.found).not.toContain("no credentials");

  // `gh` present, its configuration directory empty: installed, but nothing to authenticate with.
  const bare = byId(await report((await machine()).bin, withAgents()), "github-cli");
  expect(bare.found).toContain("no credentials were found");
  expect(bare.remedy).toContain("gh auth login");
});

test("an existing host file reads as configured without being opened", async () => {
  const { bin, ghDir } = await machine();
  const hosts = join(ghDir, "hosts.yml");
  await writeFile(hosts, "github.com:\n    oauth_token: gho_SECRETVALUE\n");
  await chmod(hosts, 0o000); // Unreadable: a check that opened it would fail.
  cleanups.push(() => chmod(hosts, 0o600));
  const result = await report(bin, withAgents());
  expect(byId(result, "github-cli").status).toBe("ok");
  expect(byId(result, "github-cli").found).toContain(hosts);
  expect(JSON.stringify(result)).not.toContain("gho_SECRET");
});

test("a token in the environment is named, never shown", async () => {
  // `machine()` clears both token variables and gives this machine an empty gh directory, so the token is the only
  // thing that can make this check pass, and `machine()`'s own cleanup restores whatever the real environment had.
  const { bin } = await machine();
  process.env.GH_TOKEN = "gho_TOPSECRET_VALUE";
  const result = await report(bin, withAgents());
  expect(byId(result, "github-cli").status).toBe("ok");
  expect(byId(result, "github-cli").found).toContain("GH_TOKEN is set");
  expect(JSON.stringify(result)).not.toContain("TOPSECRET");
});

// 2.6 — one check per configured agent.
test("one check per configured agent, with the default marked", async () => {
  const base = withAgents();
  const config: Config = {
    ...base,
    agentSessions: {
      ...base.agentSessions,
      agents: [
        ...base.agentSessions.agents,
        { id: "aider", name: "Aider", command: ["aider", "{prompt}"], prompts: { implement: "do {change}" } },
        { id: "custom", name: "Custom", command: ["custom-cli", "{prompt}"], prompts: { implement: "do {change}" } },
      ],
    },
  };
  const result = await report((await machine()).bin, config);
  expect(result.checks.filter((c) => c.id.startsWith("agent:")).map((c) => c.id)).toEqual(["agent:claude", "agent:aider", "agent:custom"]);
  expect(byId(result, "agent:claude").label).toContain("(default)");
  expect(byId(result, "agent:aider").label).not.toContain("(default)");
});

// 2.7 — relevance derived from the configuration.
test("with agent sessions off the agent, identity and GitHub checks are not needed", async () => {
  const result = await report((await machine([])).bin);
  for (const id of ["agent:claude", "git-identity", "github-cli"]) {
    expect(byId(result, id)).toMatchObject({ status: "not-needed", found: "not needed while agent sessions are off" });
  }
  expect(result.status).not.toBe("problem");
});

test("a missing default agent is a problem, a missing unused one a warning", async () => {
  const base = withAgents();
  const config: Config = {
    ...base,
    agentSessions: { ...base.agentSessions, agents: [...base.agentSessions.agents, { id: "aider", name: "Aider", command: ["aider"], prompts: { implement: "do {change}" } }] },
  };
  const result = await report((await machine(["git", "openspec", "gh"])).bin, config);
  expect(byId(result, "agent:claude").status).toBe("problem");
  expect(byId(result, "agent:aider").status).toBe("warning");
});

test("an agent a tracked repository selects is a problem too", async () => {
  const base = withAgents();
  const config: Config = {
    ...base,
    agentSessions: { ...base.agentSessions, agents: [...base.agentSessions.agents, { id: "aider", name: "Aider", command: ["aider"], prompts: { implement: "do {change}" } }] },
    repos: [{ id: "r1", path: "/w/acme/demo-ops", name: "demo-ops", enabled: true, agent: { enabled: true, agentId: "aider" } }],
  };
  const result = await report((await machine(["git", "openspec", "gh", "claude"])).bin, config, { generatedAt: "2026-09-30T10:00:00.000Z", repos: [repoSnapshot("r1", true)] });
  expect(byId(result, "agent:aider").status).toBe("problem");
});

test("the agent the main console runs is a problem too", async () => {
  const base = withAgents();
  const aider = { id: "aider", name: "Aider", command: ["aider"], prompts: { implement: "do {change}" } };
  const config: Config = { ...base, agentSessions: { ...base.agentSessions, agents: [...base.agentSessions.agents, aider], consoleAgent: "aider" } };
  const result = await report((await machine(["git", "openspec", "gh", "claude"])).bin, config);
  expect(byId(result, "agent:aider").status).toBe("problem");
});

test("missing git is a problem with a git repository tracked and a warning without", async () => {
  const bin = (await machine(["openspec", "gh", "claude"])).bin;
  const config: Config = { ...defaultConfig(), repos: [{ id: "r1", path: "/w/acme/demo-ops", name: "demo-ops", enabled: true }] };
  const withGit = await report(bin, config, { generatedAt: "2026-09-30T10:00:00.000Z", repos: [repoSnapshot("r1", true)] });
  expect(byId(withGit, "git").status).toBe("problem");
  const withoutGit = await report(bin, config, { generatedAt: "2026-09-30T10:00:00.000Z", repos: [repoSnapshot("r1", false)] });
  expect(byId(withoutGit, "git").status).toBe("warning");
});

test("a disabled repository does not make git a problem", async () => {
  const bin = (await machine(["openspec", "gh", "claude"])).bin;
  const config: Config = { ...defaultConfig(), repos: [{ id: "r1", path: "/w/acme/demo-ops", name: "demo-ops", enabled: false }] };
  const result = await report(bin, config, { generatedAt: "2026-09-30T10:00:00.000Z", repos: [repoSnapshot("r1", true)] });
  expect(byId(result, "git").status).toBe("warning");
});

// 2.8 — what the report cannot know.
test("the caveat is present unless the GitHub check is not needed", async () => {
  const { bin } = await machine();
  expect((await report(bin, withAgents())).caveat).toContain("valid");
  expect((await report(bin)).caveat).toBeUndefined();
});

// 2.9 — memoisation.
test("an identical report is reused for ten seconds and Re-check forces a fresh one", async () => {
  const { bin, gitLog } = await machine();
  const config = withAgents();
  const snapshot: Snapshot = { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] };
  const home = await useTempHome();
  cleanups.push(home.cleanup);
  process.env.PATH = bin;
  resetEnvironmentCache();

  const first = await environmentReport(config, snapshot);
  const second = await environmentReport(config, snapshot);
  expect(second).toBe(first);
  expect((await Bun.file(gitLog).text()).trim().split("\n")).toHaveLength(2); // user.name and user.email, once

  const forced = await environmentReport(config, snapshot, { force: true });
  expect(forced).not.toBe(first);
  expect((await Bun.file(gitLog).text()).trim().split("\n")).toHaveLength(4);
});

test("a changed configuration is reflected by the next report", async () => {
  const { bin } = await machine();
  const snapshot: Snapshot = { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] };
  const home = await useTempHome();
  cleanups.push(home.cleanup);
  process.env.PATH = bin;
  resetEnvironmentCache();

  const off = await environmentReport(defaultConfig(), snapshot);
  expect(byId(off, "github-cli").status).toBe("not-needed");
  const on = await environmentReport(withAgents(), snapshot);
  expect(byId(on, "github-cli").status).not.toBe("not-needed");
});

/** Names, sizes and mtimes under `root`; equal before and after means nothing was created, modified or deleted. */
async function treeOf(root: string): Promise<string> {
  const lines: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      const info = await Bun.file(path).exists();
      lines.push(`${entry.isDirectory() ? "d" : "f"} ${path} ${info}`);
      if (entry.isDirectory()) await visit(path);
    }
  };
  await visit(root);
  return lines.join("\n");
}

// Instructions (setup-wizard): every check that is not ok says how, for the platform the server runs on.
test("every check that is not ok carries instructions on every platform", async () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    const { bin } = await machine([], {});
    const config = withAgents({ ...defaultConfig(), agentSessions: { ...withAgents().agentSessions, agents: [...defaultConfig().agentSessions.agents, { id: "my-agent", name: "My agent", command: ["my-agent-cli", "{prompt}"], prompts: {} }] } });
    const result = await report(bin, config, undefined, platform);
    for (const check of result.checks) {
      if (check.status === "ok" || check.status === "not-needed") expect(check.instructions).toBeUndefined();
      else expect([platform, check.id, (check.instructions ?? []).length > 0]).toEqual([platform, check.id, true]);
    }
  }
});

test("openspec missing on macOS names an install command", async () => {
  const { bin } = await machine(["git"]);
  const check = byId(await report(bin, defaultConfig(), undefined, "darwin"), "openspec-cli");
  expect(check.instructions?.some((step) => step.command?.includes("@fission-ai/openspec"))).toBe(true);
});

test("missing git gets the platform's install route", async () => {
  const { bin } = await machine(["openspec"]);
  expect(byId(await report(bin, defaultConfig(), undefined, "darwin"), "git").instructions?.[0].command).toBe("xcode-select --install");
  expect(byId(await report(bin, defaultConfig(), undefined, "win32"), "git").instructions?.[0].command).toContain("winget");
});

test("gh without credentials asks for gh auth login and no install", async () => {
  const { bin } = await machine();
  const check = byId(await report(bin, withAgents(), undefined, "darwin"), "github-cli");
  expect(check.instructions?.map((step) => step.command)).toEqual(["gh auth login"]);
});

test("gh not installed names the install before the login", async () => {
  const { bin } = await machine(["git", "openspec", "claude"]);
  const check = byId(await report(bin, withAgents(), undefined, "darwin"), "github-cli");
  expect(check.instructions?.map((step) => step.command)).toEqual(["brew install gh", "gh auth login"]);
});

test("identity instructions name only the missing key", async () => {
  const { bin } = await machine(TOOLS, { email: "demo@example.invalid" });
  const check = byId(await report(bin, withAgents()), "git-identity");
  expect(check.instructions?.map((step) => step.command)).toEqual(['git config --global user.name "Your Name"']);
});

test("a missing preset agent gets its preset's command, a custom one the generic advice", async () => {
  const { bin } = await machine(["git", "openspec"]);
  const config = withAgents({
    ...defaultConfig(),
    agentSessions: {
      ...defaultConfig().agentSessions,
      agents: [...defaultConfig().agentSessions.agents, { id: "codex", name: "Codex", command: ["codex", "{prompt}"], prompts: {} }, { id: "my-agent", name: "My agent", command: ["my-agent-cli", "{prompt}"], prompts: {} }],
    },
  });
  const result = await report(bin, config, undefined, "linux");
  expect(byId(result, "agent:codex").instructions?.[0].command).toBe("npm install -g @openai/codex");
  const custom = byId(result, "agent:my-agent").instructions ?? [];
  expect(custom).toHaveLength(1);
  expect(custom[0].text).toContain("my-agent-cli");
  expect(custom[0].command).toBeUndefined();
});

// The setup view (environment-check: the setup view leaves agents out).
async function setupReport(bin: string, config: Config = defaultConfig(), snapshot: Snapshot = { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] }): Promise<EnvironmentReport> {
  const home = await useTempHome();
  cleanups.push(home.cleanup);
  process.env.PATH = bin;
  resetEnvironmentCache();
  return environmentReport(config, snapshot, { view: "setup" });
}

test("setup view: a fresh installation without gh warns about the GitHub CLI that Settings calls not needed", async () => {
  const { bin } = await machine(["git", "openspec", "claude"]);
  const setup = await setupReport(bin);
  expect(byId(setup, "git").status).toBe("ok");
  expect(byId(setup, "github-cli").status).toBe("warning");
  expect(byId(setup, "github-cli").instructions?.map((s) => s.command)).toContain("gh auth login");
  expect(setup.status).toBe("warning");
  const settings = await environmentReport(defaultConfig(), { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] }, { force: true });
  expect(byId(settings, "github-cli").status).toBe("not-needed");
});

test("setup view: git missing before anything is tracked is a problem, where Settings says warning", async () => {
  const { bin } = await machine(["openspec", "gh"]);
  const setup = await setupReport(bin);
  expect(byId(setup, "git").status).toBe("problem");
  expect(byId(setup, "git-identity").status).toBe("warning");
  expect(setup.status).toBe("problem");
  const settings = await environmentReport(defaultConfig(), { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] }, { force: true });
  expect(byId(settings, "git").status).toBe("warning");
});

test("setup view: no agent checks and nothing not-needed, while Settings keeps both agents", async () => {
  const base = defaultConfig();
  const config: Config = {
    ...base,
    agentSessions: { ...base.agentSessions, agents: [...base.agentSessions.agents, { id: "codex", name: "Codex", command: ["codex", "{prompt}"], prompts: {} }] },
  };
  const { bin } = await machine([]);
  const setup = await setupReport(bin, config);
  expect(setup.checks.map((c) => c.id)).toEqual(["dashboard-home", "git", "git-identity", "openspec-cli", "github-cli"]);
  expect(setup.checks.some((c) => c.status === "not-needed")).toBe(false);
  expect(setup.caveat).toContain("valid");
  const settings = await environmentReport(withAgents(config), { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] }, { force: true });
  expect(settings.checks.filter((c) => c.id.startsWith("agent:")).map((c) => c.id)).toEqual(["agent:claude", "agent:codex"]);
});

test("setup view: each view is cached on its own", async () => {
  const { bin } = await machine();
  const snapshot: Snapshot = { generatedAt: "2026-09-30T10:00:00.000Z", repos: [] };
  const setup = await setupReport(bin);
  const settings = await environmentReport(defaultConfig(), snapshot);
  expect(settings).not.toBe(setup);
  expect(await environmentReport(defaultConfig(), snapshot, { view: "setup" })).toBe(setup);
  expect(await environmentReport(defaultConfig(), snapshot)).toBe(settings);
});
