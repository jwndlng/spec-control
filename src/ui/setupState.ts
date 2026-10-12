// The setup wizard's decisions (openspec/specs/setup-wizard), pure so they are tested without a DOM: when it opens by
// itself, which agents are checked and preselected, what each step saves, and what the Done step says. Every save is
// built from the configuration as it is when the user continues, and only adds or changes what the user touched.
import { AGENT_PRESETS, CLAUDE_PROFILE } from "../shared/agentDefaults.ts";
import { PROJECT_SETTINGS, type ProjectSetting, settingApplies, withAutoFetch, withPrTitleConvention, withRepoAgent } from "../shared/repoSettings.ts";
import { type AgentAvailability, type AutoFetchSeconds, autoFetchInterval, type Config, type EnvironmentReport, type GithubClone, type PrTitleConvention, type RepoConfig, repoAgentEnabled } from "../shared/types.ts";
import { newAgentProfile, parseArgLines } from "./sessionState.ts";

export const SETUP_STEPS = ["Welcome", "System check", "Workspace", "Agents", "Console", "Project settings", "Done"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

let autoOpen = true;

/** The demo build turns this off, so its first view and screenshots show the dashboard without the wizard. */
export function setSetupAutoOpen(on: boolean): void {
  autoOpen = on;
}

export function setupAutoOpens(): boolean {
  return autoOpen;
}

/** Whether the wizard opens by itself now: once per load, while setup is pending, with no other overlay in the way. */
export function shouldOpenSetup(state: { enabled: boolean; pending: boolean; alreadyOpened: boolean; ready: boolean; overlayOpen: boolean }): boolean {
  return state.enabled && state.pending && !state.alreadyOpened && state.ready && !state.overlayOpen;
}

/** `~` and `~/…` against the server's home directory, without a trailing separator — the spelling discovery reports. */
export function expandHome(path: string, home: string): string {
  const trimmed = path.trim();
  const expanded = trimmed === "~" ? home : trimmed.startsWith("~/") ? `${home.replace(/\/+$/, "")}/${trimmed.slice(2)}` : trimmed;
  return expanded.length > 1 ? expanded.replace(/[\\/]+$/, "") : expanded;
}

/** Absolute after `~` expansion, on POSIX or Windows; anything else is refused before discovery is asked. */
export function isAbsoluteRoot(path: string): boolean {
  const trimmed = path.trim();
  return trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed);
}

/**
 * The Workspace step's save: the entered roots appended to the configured ones, without those discovery reported
 * missing and without duplicates. `null` when nothing would change, so continuing without entries sends nothing.
 */
export function workspaceSave(current: Config, entered: readonly string[], missing: ReadonlySet<string>): Config | null {
  const roots = [...current.scanRoots];
  for (const root of entered) {
    if (missing.has(root) || roots.includes(root)) continue;
    roots.push(root);
  }
  return roots.length === current.scanRoots.length ? null : { ...current, scanRoots: roots };
}

/**
 * Whether the Workspace step has a workspace folder to continue with: a configured root, an entered one that exists (as
 * far as discovery has said), or one marked to be created.
 */
export function workspaceRootReady(configured: readonly string[], entered: readonly string[], missing: ReadonlySet<string> | ReadonlyMap<string, unknown>, toCreate: ReadonlySet<string>): boolean {
  return configured.length > 0 || entered.some((root) => !missing.has(root) || toCreate.has(root));
}

/** The roots Add from GitHub may clone into from the Workspace step: configured ones, and entered ones that exist or will. */
export function githubRootChoices(configured: readonly string[], entered: readonly string[], missing: ReadonlySet<string> | ReadonlyMap<string, unknown>, toCreate: ReadonlySet<string>): string[] {
  return [...configured, ...entered.filter((root) => !configured.includes(root) && (!missing.has(root) || toCreate.has(root)))];
}

/** `~/Workspace`, proposed for creation when no root is configured and no well-known folder exists in the home folder. */
export function proposedWorkspace(home: string | undefined, configured: readonly string[], suggestions: readonly string[]): string | undefined {
  if (!home || configured.length > 0 || suggestions.length > 0) return undefined;
  return `${home.replace(/[\\/]+$/, "")}/Workspace`;
}

/** One agent the Agents step offers: a configured profile (always kept, so never unchecked), or a preset not configured yet. */
export interface AgentChoice {
  id: string;
  name: string;
  configured: boolean;
  available: boolean;
}

/** The configured profiles and the presets not configured yet, found ones first, otherwise in their given order. */
/** The same value whatever the order of object keys: a profile read back from the configuration may list them otherwise. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return `{${entries.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether the agents are still exactly what a fresh installation ships — the Claude Code profile as preset and nothing
 * else. The wizard does not count that as a choice the user made: it offers Claude Code like any other preset, and the
 * Agents step's save puts the agents the user checks in its place.
 */
export function untouchedDefaultAgents(config: Config): boolean {
  const sessions = config.agentSessions;
  return sessions.agents.length === 1 && sessions.defaultAgent === CLAUDE_PROFILE.id && !sessions.consoleAgent && stable(sessions.agents[0]) === stable(CLAUDE_PROFILE);
}

/** The profiles the user configured: none while the agents are the untouched default. */
export function configuredAgents(config: Config): Config["agentSessions"]["agents"] {
  return untouchedDefaultAgents(config) ? [] : config.agentSessions.agents;
}

export function agentChoices(config: Config, agents: readonly AgentAvailability[], presets: readonly AgentAvailability[]): AgentChoice[] {
  const found = new Map([...agents, ...presets].map((a) => [a.id, a.available]));
  const configured = configuredAgents(config).map((a) => ({ id: a.id, name: a.name, configured: true, available: found.get(a.id) ?? false }));
  const ids = new Set(configured.map((a) => a.id));
  const offered = AGENT_PRESETS.filter(({ profile }) => !ids.has(profile.id)).map(({ profile }) => ({
    id: profile.id,
    name: profile.name,
    configured: false,
    available: found.get(profile.id) ?? false,
  }));
  const all = [...configured, ...offered];
  return [...all.filter((a) => a.available), ...all.filter((a) => !a.available)];
}

/** Checked before the user touches anything: every configured profile, and every preset found on this machine. */
export function initiallyChecked(choices: readonly AgentChoice[]): string[] {
  return choices.filter((c) => c.configured || c.available).map((c) => c.id);
}

/** An agent the user describes in the step: a name and a command, one argument per line. `key` is the step's own. */
export interface CustomAgent {
  key: string;
  name: string;
  command: string;
}

/** The id a custom agent is referred to by until it is saved, as the default agent for instance. */
export const customAgentRef = (agent: Pick<CustomAgent, "key">) => `custom:${agent.key}`;

/** What a custom agent still lacks, or `undefined` when it can be saved. */
export function customAgentProblem(agent: CustomAgent): string | undefined {
  if (!agent.name.trim()) return "Enter a name for this agent.";
  if (parseArgLines(agent.command).length === 0) return "Enter the command that starts this agent.";
  return undefined;
}

/** The agents the default can be chosen from: the checked ones, in list order, then every complete custom agent. */
export function defaultAgentOptions(choices: readonly AgentChoice[], checked: readonly string[], custom: readonly CustomAgent[]): { id: string; name: string; available?: boolean }[] {
  return [
    ...choices.filter((c) => checked.includes(c.id)).map((c) => ({ id: c.id, name: c.name, available: c.available })),
    ...custom.filter((a) => customAgentProblem(a) === undefined).map((a) => ({ id: customAgentRef(a), name: a.name.trim() })),
  ];
}

/**
 * The configured default when it is checked and installed, else the first checked agent that is installed, else the
 * configured default anyway. Without `checked`, every choice counts as checked.
 */
export function preselectedAgent(config: Config, choices: readonly AgentChoice[], checked?: readonly string[]): string {
  const fallback = config.agentSessions.defaultAgent;
  const candidates = checked ? choices.filter((c) => checked.includes(c.id)) : choices;
  if (candidates.find((c) => c.id === fallback)?.available) return fallback;
  return candidates.find((c) => c.available)?.id ?? fallback;
}

/** What the user chose in the Agents step. `checked` lists choice ids in the order they are listed. */
export interface AgentsChoice {
  enable: boolean;
  checked: readonly string[];
  custom: readonly CustomAgent[];
  /** A choice id or a {@link customAgentRef}. */
  defaultAgent: string;
}

/**
 * The Agents step's save: agent sessions switched on if asked, every checked preset and every complete custom agent
 * not configured yet added in the order listed, and the chosen agent made the default. Never switches agent sessions
 * off, and never removes or edits a configured profile or touches a repository. `null` when nothing would change.
 */
export function agentsSave(current: Config, choice: AgentsChoice): Config | null {
  const sessions = current.agentSessions;
  // The untouched default is replaced by what the user checks; profiles the user configured are always kept.
  const agents = [...configuredAgents(current)];
  for (const id of choice.checked) {
    if (agents.some((a) => a.id === id)) continue;
    const preset = AGENT_PRESETS.find(({ profile }) => profile.id === id)?.profile;
    if (preset) agents.push(structuredClone(preset));
  }
  const customIds = new Map<string, string>();
  for (const agent of choice.custom) {
    if (customAgentProblem(agent) !== undefined) continue;
    const profile = newAgentProfile({ name: agent.name.trim(), command: parseArgLines(agent.command), taken: agents.map((a) => a.id) });
    agents.push(profile);
    customIds.set(customAgentRef(agent), profile.id);
  }
  // No agent at all: nothing to save, and the configuration keeps the agent it has.
  if (agents.length === 0) return null;
  const wanted = customIds.get(choice.defaultAgent) ?? choice.defaultAgent;
  const defaultAgent = agents.some((a) => a.id === wanted) ? wanted : agents.some((a) => a.id === sessions.defaultAgent) ? sessions.defaultAgent : agents[0].id;
  const enabled = sessions.enabled || choice.enable;
  if (enabled === sessions.enabled && stable(agents) === stable(sessions.agents) && defaultAgent === sessions.defaultAgent) return null;
  return { ...current, agentSessions: { ...sessions, enabled, agents, defaultAgent } };
}

/** Whether the Agents step can continue: at least one agent is configured, checked or described completely. */
export function agentsReady(choices: readonly AgentChoice[], checked: readonly string[], custom: readonly CustomAgent[]): boolean {
  return defaultAgentOptions(choices, checked, custom).length > 0;
}

/** The Console step's save: only the console agent, `undefined` (follow the default) stored as no choice. */
export function consoleSave(current: Config, consoleAgent: string | undefined): Config | null {
  const sessions = current.agentSessions;
  const wanted = consoleAgent && sessions.agents.some((a) => a.id === consoleAgent) ? consoleAgent : undefined;
  if (wanted === sessions.consoleAgent) return null;
  const { consoleAgent: _old, ...rest } = sessions;
  return { ...current, agentSessions: wanted ? { ...rest, consoleAgent: wanted } : rest };
}

/** The Project settings step's two ways of working. */
export type ProjectSettingsMode = "all" | "individual";

/**
 * The settings the user changed in the step, as the values its controls show: `agentSessions` "enabled" | "disabled",
 * `agent` "" (default agent) or a profile id, `prTitles` "" | "conventional-commits", `autoMergeDocs` "on" | "off",
 * `autoFetch` "0" (Off) or an interval in seconds. A setting the user did not touch has no key.
 */
export type SettingsDraft = Partial<Record<ProjectSetting, string>>;

/** A project's setting as its control shows it. */
export function settingValue(repo: RepoConfig, setting: ProjectSetting): string {
  switch (setting) {
    case "agentSessions":
      return repoAgentEnabled(repo) ? "enabled" : "disabled";
    case "agent":
      return repo.agent?.agentId ?? "";
    case "prTitles":
      return repo.prTitleConvention ?? "";
    case "autoMergeDocs":
      return repo.agent?.autoMergeDocs === true ? "on" : "off";
    case "autoFetch":
      return String(autoFetchInterval(repo) ?? 0);
  }
}

/** What a fresh project shows, which the step names as each setting's default. */
export const SETTING_DEFAULTS: Record<ProjectSetting, string> = { agentSessions: "enabled", agent: "", prTitles: "", autoMergeDocs: "off", autoFetch: "60" };

/** `repo` with `setting` set to `value`, stored as the settings dialog stores it. */
export function applySetting(repo: RepoConfig, setting: ProjectSetting, value: string): RepoConfig {
  switch (setting) {
    case "agentSessions":
      return withRepoAgent(repo, { enabled: value === "enabled" });
    case "agent":
      return withRepoAgent(repo, { agentId: value || null });
    case "prTitles":
      return withPrTitleConvention(repo, (value || null) as PrTitleConvention | null);
    case "autoMergeDocs":
      return withRepoAgent(repo, { autoMergeDocs: value === "on" });
    case "autoFetch":
      return withAutoFetch(repo, Number(value) as AutoFetchSeconds | 0);
  }
}

/** `repo` with `draft` applied in the dialog's order, each setting only where it applies once the earlier ones are. */
export function withDraft(repo: RepoConfig, draft: SettingsDraft, config: Config, isGit: boolean): RepoConfig {
  let next = repo;
  for (const setting of PROJECT_SETTINGS) {
    const value = draft[setting];
    // A value the project already shows is left alone, so a repository without agent settings does not gain them.
    if (value !== undefined && value !== settingValue(next, setting) && settingApplies(setting, next, config, isGit)) next = applySetting(next, setting, value);
  }
  return next;
}

/** The enabled projects the step covers, in the configuration's order. */
export function settingsProjects(config: Config): RepoConfig[] {
  return config.repos.filter((r) => r.enabled);
}

/** Why a setting is not set for a project in the shared form: it is not a git repository, or its sessions are off. */
export type SkipReason = "no-git" | "sessions-off";

/**
 * For the one form of "Same settings for all projects": the projects `setting` applies to (with the draft's earlier
 * settings applied, so switching sessions off hides Docs auto-merge), the value they share — `undefined` when they
 * disagree — and the projects it is not set for, with the reason.
 */
export function sharedSetting(
  projects: readonly RepoConfig[],
  setting: ProjectSetting,
  draft: SettingsDraft,
  config: Config,
  isGit: (id: string) => boolean,
): { applies: number; value?: string; skipped: { name: string; reason: SkipReason }[] } {
  const before: SettingsDraft = {};
  for (const s of PROJECT_SETTINGS) {
    if (s === setting) break;
    if (draft[s] !== undefined) before[s] = draft[s];
  }
  const values: string[] = [];
  const skipped: { name: string; reason: SkipReason }[] = [];
  for (const project of projects) {
    const repo = withDraft(project, before, config, isGit(project.id));
    if (settingApplies(setting, repo, config, isGit(repo.id))) values.push(settingValue(repo, setting));
    else skipped.push({ name: repo.name, reason: GIT_ONLY_SETTINGS.has(setting) && !isGit(repo.id) ? "no-git" : "sessions-off" });
  }
  const value = values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
  return { applies: values.length, value, skipped };
}

/** The settings that apply only to a git repository (`settingApplies`). */
export const GIT_ONLY_SETTINGS: ReadonlySet<ProjectSetting> = new Set(["prTitles", "autoMergeDocs", "autoFetch"]);

/**
 * Which projects a shared setting is not set for, and why: at most three names per reason and a count of the rest.
 * `undefined` when it is set for every project.
 */
export function skippedNote(skipped: readonly { name: string; reason: SkipReason }[]): string | undefined {
  if (skipped.length === 0) return undefined;
  const sentence = (reason: SkipReason) => {
    const names = skipped.filter((s) => s.reason === reason).map((s) => s.name);
    if (names.length === 0) return undefined;
    const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
    const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
    if (reason === "no-git") return names.length === 1 ? `Not set for ${list}, which is not a git repository.` : `Not set for ${list}, which are not git repositories.`;
    return `Not set for ${list}, whose agent sessions are disabled.`;
  };
  return [sentence("no-git"), sentence("sessions-off")].filter(Boolean).join(" ");
}

/**
 * The Project settings step's save, built from the configuration as it is now: in "all" mode `all` is applied to every
 * enabled project, in "individual" mode `each` per project — only touched settings, only where they apply. `null` when
 * nothing would change; otherwise the configuration and how many projects it changed.
 */
export function projectSettingsSave(
  current: Config,
  mode: ProjectSettingsMode,
  drafts: { all: SettingsDraft; each: ReadonlyMap<string, SettingsDraft> },
  isGit: (id: string) => boolean,
): { config: Config; changed: number } | null {
  let changed = 0;
  const repos = current.repos.map((repo) => {
    if (!repo.enabled) return repo;
    const draft = mode === "all" ? drafts.all : drafts.each.get(repo.id);
    if (!draft) return repo;
    const next = withDraft(repo, draft, current, isGit(repo.id));
    if (JSON.stringify(next) === JSON.stringify(repo)) return repo;
    changed++;
    return next;
  });
  return changed === 0 ? null : { config: { ...current, repos }, changed };
}

/** What setup saved so far, collected step by step for the Done step. */
export interface SetupSaved {
  rootsAdded: string[];
  /** The roots among `rootsAdded` that setup created as new folders. */
  rootsCreated: string[];
  tracked: number;
  /** `owner/name` of every GitHub repository whose clone setup started. */
  cloned: string[];
  /** Their target folders, which a retry keeps: how the Done step finds them in the clone list. */
  clonePaths: string[];
  agentsAdded: string[];
  projectsChanged: number;
}

export const NOTHING_SAVED: SetupSaved = { rootsAdded: [], rootsCreated: [], tracked: 0, cloned: [], clonePaths: [], agentsAdded: [], projectsChanged: 0 };

/** What the Done step reports: what setup saved, and the checks and agents still needing attention. */
export interface SetupSummary extends SetupSaved {
  agentSessions: boolean;
  defaultAgent?: string;
  /** The console agent's name; absent when the console follows the default agent. */
  consoleAgent?: string;
  /** How many agent profiles are configured. */
  agents: number;
  /** Whether the System check had a report to judge by. */
  checked: boolean;
  /** Labels of the setup view's checks that are `problem` or `warning`. */
  remaining: string[];
  /** Names of the checked agents whose executable the Agents step last found missing. */
  agentsMissing: string[];
  /** How many of the clones setup started are still queued or running. */
  clonesRunning: number;
}

export function setupSummary(config: Config | null, saved: SetupSaved, report?: EnvironmentReport, agentsMissing: readonly string[] = [], clonesRunning = 0): SetupSummary {
  const sessions = config?.agentSessions;
  return {
    rootsAdded: [...saved.rootsAdded],
    rootsCreated: [...saved.rootsCreated],
    tracked: saved.tracked,
    cloned: [...saved.cloned],
    clonePaths: [...saved.clonePaths],
    agentsAdded: [...saved.agentsAdded],
    projectsChanged: saved.projectsChanged,
    agentSessions: sessions?.enabled === true,
    defaultAgent: sessions?.agents.find((a) => a.id === sessions.defaultAgent)?.name,
    consoleAgent: sessions?.consoleAgent ? sessions.agents.find((a) => a.id === sessions.consoleAgent)?.name : undefined,
    agents: sessions?.agents.length ?? 0,
    checked: report !== undefined,
    remaining: (report?.checks ?? []).filter((c) => c.status === "problem" || c.status === "warning").map((c) => c.label),
    agentsMissing: [...agentsMissing],
    clonesRunning,
  };
}

/** How a step came out, as the Done step marks it. */
export type DoneMark = "done" | "attention" | "unchanged";
export const DONE_MARK_LABEL: Record<DoneMark, string> = { done: "Done", attention: "Needs attention", unchanged: "Nothing changed" };

/** One card of the Done step: a step, how it came out, its outcome in a word or a number, and a line of detail. */
export interface DoneCard {
  step: Exclude<SetupStep, "Welcome" | "Done">;
  mark: DoneMark;
  outcome: string;
  detail: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const listed = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** What is left to fix: the checks still failing, then the checked agents not found. */
export function leftToFix(summary: SetupSummary): number {
  return summary.remaining.length + summary.agentsMissing.length;
}

/**
 * The Done step's cards, one per step from System check to Project settings, in the wizard's order. Only the System
 * check, for a failing check, and Agents, for a checked agent not found, can need attention.
 */
export function doneCards(summary: SetupSummary, home?: string): DoneCard[] {
  // `~/Workspace` reads better on a card than the full path; anything outside the home folder is shown as it is.
  const short = (path: string) => (home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);
  const workspaceChanged = summary.rootsAdded.length > 0 || summary.tracked > 0 || summary.cloned.length > 0;
  const workspaceDetail =
    summary.rootsAdded.length > 0
      ? `${summary.tracked > 0 ? "Tracked, from" : "Added"} ${listed(summary.rootsAdded.map(short))}`
      : summary.tracked > 0
        ? "Tracked from your workspace folders"
        : summary.cloned.length > 0
          ? ""
          : "No folder added and no project tracked";
  const defaultName = summary.defaultAgent ?? "the default agent";
  return [
    {
      step: "System check",
      mark: summary.remaining.length > 0 || !summary.checked ? "attention" : "done",
      outcome: summary.remaining.length > 0 ? `${summary.remaining.length} to fix` : summary.checked ? "All in place" : "Not checked",
      detail:
        summary.remaining.length > 0
          ? `${listed(summary.remaining)} — Settings → Environment shows how`
          : summary.checked
            ? "Every tool Spec Control relies on is installed"
            : "Settings → Environment checks this machine",
    },
    {
      step: "Workspace",
      mark: workspaceChanged ? "done" : "unchanged",
      outcome:
        summary.tracked > 0
          ? plural(summary.tracked, "project", "projects")
          : summary.cloned.length > 0
            ? `${summary.cloned.length} ${summary.clonesRunning > 0 ? "cloning" : "cloned"}`
            : "No change",
      detail: [
        workspaceDetail,
        summary.rootsCreated.length > 0 ? `created ${listed(summary.rootsCreated.map(short))}` : "",
        summary.cloned.length > 0
          ? summary.clonesRunning > 0
            ? `cloning ${listed(summary.cloned)} from GitHub, ${summary.clonesRunning} still running`
            : `cloned ${listed(summary.cloned)} from GitHub`
          : "",
      ]
        .filter(Boolean)
        .join("; ")
        .replace(/^./, (first) => first.toUpperCase()),
    },
    {
      step: "Agents",
      mark: summary.agentsMissing.length > 0 ? "attention" : summary.agentSessions || summary.agentsAdded.length > 0 ? "done" : "unchanged",
      outcome: plural(summary.agents, "agent", "agents"),
      detail: [
        summary.agentsMissing.length > 0 ? `${listed(summary.agentsMissing)} not found — install ${summary.agentsMissing.length === 1 ? "it" : "them"} to start sessions` : "",
        summary.agentSessions ? `Sessions on, ${defaultName} by default` : "Sessions off",
        summary.agentsAdded.length > 0 ? `added ${listed(summary.agentsAdded)}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    },
    {
      step: "Console",
      mark: summary.agentSessions ? "done" : "unchanged",
      outcome: summary.consoleAgent ?? summary.defaultAgent ?? "Default agent",
      detail: !summary.agentSessions ? "Available once agent sessions are on" : summary.consoleAgent ? "Chosen for the console" : "Follows the default agent",
    },
    {
      step: "Project settings",
      mark: summary.projectsChanged > 0 ? "done" : "unchanged",
      outcome: summary.projectsChanged > 0 ? plural(summary.projectsChanged, "project", "projects") : "No change",
      detail: summary.projectsChanged > 0 ? "Their settings were saved" : "Each project keeps its own settings",
    },
  ];
}

/** Whether every check is `ok` or `not-needed`, which the System check step says plainly. */
export function allInPlace(report: EnvironmentReport | undefined): boolean {
  return report?.checks.every((c) => c.status === "ok" || c.status === "not-needed") === true;
}

/** One GitHub repository listed in the Workspace step, cloned into `path` on Continue. */
export interface ListedRepo {
  repo: string;
  root: string;
  name: string;
  path: string;
}

/** What the Workspace step's Continue starts from. */
export interface WorkspaceContinueInput {
  entered: readonly string[];
  toCreate: ReadonlySet<string>;
  /** Entered roots discovery reported missing. */
  missing: ReadonlySet<string>;
  /** Paths of the found projects that are checked. */
  checked: readonly string[];
  listed: readonly ListedRepo[];
  /** Clones started for listed paths on an earlier Continue or a retry. */
  cloneIds: Readonly<Record<string, string>>;
  /** Listed paths whose clone the server refused to start; tried again on the next Continue or a retry. */
  cloneRefused: Readonly<Record<string, string>>;
}

export interface WorkspaceContinueDeps {
  createWorkspaceFolder(path: string): Promise<{ path: string }>;
  config(): Promise<Config>;
  saveConfig(config: Config): Promise<Config>;
  trackRepo(path: string): Promise<Config>;
  cloneGithub(repo: string, root: string, name: string): Promise<GithubClone>;
  /** Tells the clone list a clone started, so it is polled. */
  started(clone: GithubClone): void;
  /** Every configuration saved on the way. */
  onSaved(config: Config): void;
}

export interface WorkspaceContinueResult {
  /** `next`: move to the next step; `stay`: show what went wrong and keep the step open. */
  outcome: "stay" | "next";
  /** The roots were saved and the checked projects tracked: what was entered is configured now. */
  saved: boolean;
  /** Folders created, as the server made them. */
  created: string[];
  /** Entered roots that exist now: created, or there already. */
  nowThere: string[];
  createErrors: Map<string, string>;
  rootsAdded: string[];
  tracked: number;
  cloneIds: Record<string, string>;
  cloneRefused: Record<string, string>;
  /** `owner/name` of the clones started for the listed repositories, once the step moves on. */
  cloned: string[];
  /** Their target folders. */
  clonePaths: string[];
}

const failureText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isTaken = (err: unknown) => (err as { status?: number })?.status === 409 && /already exists/.test(failureText(err));

/**
 * The Workspace step's Continue, in the order the setup-wizard spec gives: create each folder marked to be created,
 * save the roots, track the checked projects, then start the clone of each listed repository not accepted yet — and
 * move on without waiting for any of them: the clones go on in the background, and the Done step shows them. A refused
 * creation — or a folder that turned out to be there already — saves nothing. A clone the server refuses to start keeps
 * the step open; the next Continue tries it again (its folder may have been renamed) without starting again what was
 * already accepted.
 */
export async function continueWorkspaceStep(input: WorkspaceContinueInput, deps: WorkspaceContinueDeps): Promise<WorkspaceContinueResult> {
  const listedPaths = new Set(input.listed.map((r) => r.path));
  const result: WorkspaceContinueResult = {
    outcome: "stay",
    saved: false,
    created: [],
    nowThere: [],
    createErrors: new Map(),
    rootsAdded: [],
    tracked: 0,
    cloneIds: { ...input.cloneIds },
    // A refusal of a folder no longer listed — renamed or removed since — is forgotten.
    cloneRefused: Object.fromEntries(Object.entries(input.cloneRefused).filter(([path]) => listedPaths.has(path))),
    cloned: [],
    clonePaths: [],
  };
  let appeared = false;
  for (const root of input.entered.filter((r) => input.toCreate.has(r))) {
    try {
      result.created.push((await deps.createWorkspaceFolder(root)).path);
      result.nowThere.push(root);
    } catch (err) {
      if (isTaken(err)) {
        // Not created again: marked as found, and saved like any existing root on the next Continue.
        result.nowThere.push(root);
        appeared = true;
      } else result.createErrors.set(root, failureText(err));
    }
  }
  if (result.createErrors.size > 0 || appeared) return result;

  const fresh = await deps.config();
  const next = workspaceSave(fresh, input.entered, new Set([...input.missing].filter((r) => !result.nowThere.includes(r) && !input.toCreate.has(r))));
  let current = fresh;
  if (next) {
    current = await deps.saveConfig(next);
    deps.onSaved(current);
    result.rootsAdded = next.scanRoots.filter((r) => !fresh.scanRoots.includes(r));
  }
  for (const path of input.checked) {
    current = await deps.trackRepo(path);
    result.tracked++;
  }
  if (result.tracked > 0) deps.onSaved(current);
  result.saved = true;

  for (const r of input.listed.filter((l) => !result.cloneIds[l.path])) {
    try {
      const clone = await deps.cloneGithub(r.repo, r.root, r.name);
      result.cloneIds[r.path] = clone.id;
      delete result.cloneRefused[r.path];
      deps.started(clone);
    } catch (err) {
      result.cloneRefused[r.path] = failureText(err);
    }
  }
  if (Object.keys(result.cloneRefused).length > 0) return result;
  const started = input.listed.filter((r) => result.cloneIds[r.path]);
  result.cloned = started.map((r) => r.repo);
  result.clonePaths = started.map((r) => r.path);
  result.outcome = "next";
  return result;
}
