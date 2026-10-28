import type { AgentProfile, AgentSessionsConfig, InstructionStep, PromptKey, Shortcut } from "./types.ts";

// Each prompt is one line: it may be typed into a terminal (`submit.ts`). Together they carry the meaning of the
// `- [~]` task marker, which OpenSpec itself does not define — see the agent-sessions spec. The meaning is written once
// here; each preset only says how its agent invokes the OpenSpec workflow (`<invocation> — <tail>`).

/**
 * Leaves a task only the user can verify or carry out as `- [~]` — rather than claiming a verification nobody did, or
 * leaving it open, which would keep the change in `Implementing` with nothing left for the agent — and says on the
 * task's own line what the user has to do, which the card then shows.
 */
const IMPLEMENT_TAIL =
  "when a task can only be verified or carried out by me (a secret to enter, an account to sign in to, a check on a real device), do every part of it you can, then leave it as `- [~]` instead of `- [x]` or `- [ ]`, and add to its line what exactly I have to check or do.";

/** Walks the user through the `- [~]` tasks; what the user does not confirm stays as it is. */
const VALIDATE_TAIL =
  "take its `- [~]` tasks one at a time, tell me exactly what to check or do, help with what you can, and tick off only the ones I confirm as done, leaving the rest as `- [~]`.";

/** The Implement and Validate tails before they covered tasks only the user can carry out; a saved verbatim copy upgrades. */
const PREVIOUS_IMPLEMENT_TAIL = "when a task can only be verified by me, do the work and then leave it as `- [~]` instead of `- [x]`, so I can confirm it.";
const PREVIOUS_VALIDATE_TAIL = "take its `- [~]` tasks one at a time, tell me exactly what to check, and tick off only the ones I confirm, leaving the rest as `- [~]`.";

/**
 * Syncs the delta specs first instead of stopping at the archive workflow's "sync now?" question, and commits the whole
 * move: a half-committed archive leaves the old change directory behind in the worktree (stale-changes).
 */
const ARCHIVE_TAIL =
  "sync the delta specs into openspec/specs first without asking me whether to sync, then archive; if they are already in sync, archive right away; tick off the tasks left for me to validate once I have confirmed them, and include in your commit every file the archive moved or removed.";

/** The Archive tail before it asked for the whole move to be committed; a saved verbatim copy upgrades. */
const PREVIOUS_ARCHIVE_TAIL =
  "sync the delta specs into openspec/specs first without asking me whether to sync, then archive; if they are already in sync, archive right away; tick off the tasks left for me to validate once I have confirmed them.";

/** How one agent invokes each OpenSpec workflow for `{change}`; the `- [~]` tails are appended to apply and archive. */
function starterPrompts(invoke: { draft: string; apply: string; archive: string }): AgentProfile["prompts"] {
  return { draft: invoke.draft, implement: `${invoke.apply} — ${IMPLEMENT_TAIL}`, validate: `${invoke.apply} — ${VALIDATE_TAIL}`, archive: `${invoke.archive} — ${ARCHIVE_TAIL}` };
}

/**
 * A ready-made profile Settings offers to add, plus its earlier preconfigured prompts per starter: a saved profile with
 * the preset's id that still carries one verbatim is read as carrying the current one for that starter. Per key, so
 * upgrading one prompt never rewrites another, and per preset, so one preset's former prompts never touch another's.
 */
export interface AgentPreset {
  profile: AgentProfile;
  formerPrompts: Readonly<Partial<Record<PromptKey, readonly string[]>>>;
  /** Earlier commands of the preset: a saved profile with the preset's id that has one verbatim gets the current one. */
  formerCommands?: readonly (readonly string[])[];
  /** How to install the agent on each platform: shown by the environment report and the setup wizard, never run. */
  install: Readonly<Record<InstallPlatform, readonly InstructionStep[]>>;
}

/** The platforms install instructions are written for; any other one reads as `linux`. */
export type InstallPlatform = "darwin" | "linux" | "win32";

export function installPlatform(platform: string): InstallPlatform {
  return platform === "darwin" || platform === "win32" ? platform : "linux";
}

/** Preconfigured. Ship, Resolve conflicts and Integrate use the agent-neutral defaults, as they do for every preset. */
export const CLAUDE_PROFILE: AgentProfile = {
  id: "claude",
  name: "Claude Code",
  command: ["claude", "{prompt}"],
  // `openspec init --tools claude` installs `/opsx:<workflow>` commands.
  prompts: starterPrompts({ draft: "/opsx:ff {change}", apply: "/opsx:apply {change}", archive: "/opsx:archive {change}" }),
  resumeCommand: ["claude", "--continue"],
  // So the CLI's own login (a subscription) is used rather than an API key that happens to be exported.
  unsetEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
};

/** `openspec init --tools codex` installs skills only, no commands: the prompts name the skill in plain language. */
export const CODEX_PROFILE: AgentProfile = {
  id: "codex",
  name: "Codex",
  command: ["codex", "{prompt}"],
  prompts: starterPrompts({
    draft: "Use the openspec-ff-change skill to create all artifacts of the OpenSpec change {change}.",
    apply: "Use the openspec-apply-change skill on the OpenSpec change {change}",
    archive: "Use the openspec-archive-change skill to archive the OpenSpec change {change}",
  }),
  resumeCommand: ["codex", "resume", "--last"],
};

/**
 * `openspec init --tools antigravity` installs workflows invoked as `/opsx-<workflow>`. `--prompt-interactive` keeps the
 * session interactive; flag and prompt are one argument, so a console, which leaves out the `{prompt}` argument, leaves
 * out the flag with it instead of starting `agy` with an option that lacks its value.
 */
export const ANTIGRAVITY_PROFILE: AgentProfile = {
  id: "agy",
  name: "Antigravity",
  command: ["agy", "--prompt-interactive={prompt}"],
  prompts: starterPrompts({ draft: "/opsx-ff {change}", apply: "/opsx-apply {change}", archive: "/opsx-archive {change}" }),
  resumeCommand: ["agy", "--continue"],
};

// Each vendor's own documented install route; verify against its install page when one changes.
const CLAUDE_INSTALL: AgentPreset["install"] = {
  darwin: [{ text: "Install Claude Code with its native installer, then sign in by running `claude` once.", command: "curl -fsSL https://claude.ai/install.sh | bash" }],
  linux: [{ text: "Install Claude Code with its native installer, then sign in by running `claude` once.", command: "curl -fsSL https://claude.ai/install.sh | bash" }],
  win32: [{ text: "Install Claude Code from PowerShell, then sign in by running `claude` once.", command: "irm https://claude.ai/install.ps1 | iex" }],
};

const CODEX_STEPS = [{ text: "Install the Codex CLI with npm, then sign in by running `codex` once.", command: "npm install -g @openai/codex" }];
const CODEX_INSTALL: AgentPreset["install"] = { darwin: CODEX_STEPS, linux: CODEX_STEPS, win32: CODEX_STEPS };

const ANTIGRAVITY_INSTALL: AgentPreset["install"] = {
  darwin: [{ text: "Install the Antigravity CLI, then check that `agy --version` works in a new terminal.", command: "curl -fsSL https://antigravity.google/install.sh | bash" }],
  linux: [{ text: "Install the Antigravity CLI, then check that `agy --version` works in a new terminal.", command: "curl -fsSL https://antigravity.google/install.sh | bash" }],
  win32: [{ text: "Install the Antigravity CLI, then check that `agy --version` works in a new terminal.", command: "winget install Google.AntigravityCLI" }],
};

/** Every preset, in the order Settings offers them. Only the first is configured by default. */
export const AGENT_PRESETS: readonly AgentPreset[] = [
  {
    profile: CLAUDE_PROFILE,
    formerPrompts: {
      implement: ["/opsx:apply {change}", `/opsx:apply {change} — ${PREVIOUS_IMPLEMENT_TAIL}`],
      validate: [`/opsx:apply {change} — ${PREVIOUS_VALIDATE_TAIL}`],
      archive: [
        "/opsx:archive {change}",
        "/opsx:archive {change} — sync the delta specs into openspec/specs first without asking me whether to sync, then archive; if they are already in sync, archive right away.",
        `/opsx:archive {change} — ${PREVIOUS_ARCHIVE_TAIL}`,
      ],
    },
    install: CLAUDE_INSTALL,
  },
  {
    profile: CODEX_PROFILE,
    formerPrompts: {
      implement: [`Use the openspec-apply-change skill on the OpenSpec change {change} — ${PREVIOUS_IMPLEMENT_TAIL}`],
      validate: [`Use the openspec-apply-change skill on the OpenSpec change {change} — ${PREVIOUS_VALIDATE_TAIL}`],
      archive: [`Use the openspec-archive-change skill to archive the OpenSpec change {change} — ${PREVIOUS_ARCHIVE_TAIL}`],
    },
    install: CODEX_INSTALL,
  },
  // `agy -i {prompt}` left a console with `agy -i`, an option without its value.
  {
    profile: ANTIGRAVITY_PROFILE,
    formerPrompts: {
      implement: [`/opsx-apply {change} — ${PREVIOUS_IMPLEMENT_TAIL}`],
      validate: [`/opsx-apply {change} — ${PREVIOUS_VALIDATE_TAIL}`],
      archive: [`/opsx-archive {change} — ${PREVIOUS_ARCHIVE_TAIL}`],
    },
    formerCommands: [["agy", "-i", "{prompt}"]],
    install: ANTIGRAVITY_INSTALL,
  },
];

/** How to install an agent: its preset's steps when its id is a preset's, else the generic advice for its command. */
export function agentInstallSteps(agent: Pick<AgentProfile, "id" | "name" | "command">, platform: string): InstructionStep[] {
  const preset = AGENT_PRESETS.find(({ profile }) => profile.id === agent.id);
  if (preset) return [...preset.install[installPlatform(platform)]];
  return [{ text: `Install the program \`${agent.command[0]}\` so that it is on the PATH, or change ${agent.name}'s command in Settings → Agent sessions.` }];
}

/** The Claude Code preset's former prompts. */
export const FORMER_PROMPTS = AGENT_PRESETS[0].formerPrompts;

/**
 * The shortcuts the console offers until the user edits them: the four answers an agent's questions usually need, each
 * sending exactly what its control reads. They are a starting point, not a floor — the user may reword, reorder, remove
 * or empty them, and the dashboard never adds one back (see the agent-sessions spec).
 */
export const DEFAULT_SHORTCUTS: readonly Shortcut[] = [
  { id: "go-ahead", title: "Yes, go ahead", prompt: "Yes, go ahead" },
  { id: "create-pr", title: "Yes, create a PR", prompt: "Yes, create a PR" },
  { id: "resolve-conflicts", title: "Resolve PR conflicts", prompt: "Resolve PR conflicts" },
  { id: "stop", title: "No, stop here", prompt: "No, stop here" },
];

/** Agent sessions ship disabled; nothing starts an agent until the user turns them on. */
export function defaultAgentSessions(): AgentSessionsConfig {
  return { enabled: false, agents: [structuredClone(CLAUDE_PROFILE)], defaultAgent: CLAUDE_PROFILE.id, shortcuts: structuredClone(DEFAULT_SHORTCUTS) as Shortcut[] };
}
