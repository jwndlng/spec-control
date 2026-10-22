// Agent profiles (design.md D16): an agent is a command line plus opening prompts. Nothing here knows any vendor.
import { AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION, AUTO_MERGE_DOCS_INSTRUCTION, CONVENTIONAL_COMMITS_SHIP_SENTENCE, DEFAULT_INTEGRATE_PROMPT, DEFAULT_MERGE_PROMPT, DEFAULT_RESOLVE_CONFLICTS_PROMPT, DEFAULT_SHIP_PROMPT, FAST_FORWARD_CONTINUE_SENTENCE, FAST_FORWARD_SHIP_SENTENCE, fastForwardAvailable, mergeTargetSentence, type AgentAvailability, type AgentProfile, type Config, type PrTitleConvention, type PromptKey, type RepoConfig, type SessionAction } from "../../shared/types.ts";
import { AGENT_PRESETS } from "../../shared/agentDefaults.ts";
import { whichOnPath } from "../paths.ts";
import { CHANGE_NAME } from "../source.ts";

export function agentFor(config: Config, repo: RepoConfig): AgentProfile | undefined {
  const agents = config.agentSessions.agents;
  return agents.find((a) => a.id === repo.agent?.agentId) ?? agents.find((a) => a.id === config.agentSessions.defaultAgent);
}

export function availability(config: Config): AgentAvailability[] {
  return config.agentSessions.agents.map((agent) => {
    const path = whichOnPath(agent.command[0]);
    return { id: agent.id, name: agent.name, available: path !== undefined, path };
  });
}

/**
 * Whether the executable of each preset that is not configured yet is on this machine, so Settings can list the found
 * ones first. A hint for the user's choice only: nothing is ever added because it was found. The presets are data.
 */
export function presetAvailability(config: Config): AgentAvailability[] {
  const configured = new Set(config.agentSessions.agents.map((a) => a.id));
  return AGENT_PRESETS.filter(({ profile }) => !configured.has(profile.id)).map(({ profile }) => {
    const path = whichOnPath(profile.command[0]);
    return { id: profile.id, name: profile.name, available: path !== undefined, path };
  });
}

/**
 * A prompt plus the profile's additional instructions for the same key. One line, always: a prompt may be typed into a
 * terminal, where a line break would submit it early, so whitespace in the suffix is collapsed before it is appended.
 */
function compose(agent: AgentProfile, key: PromptKey, prompt: string): string {
  const suffix = agent.promptSuffixes?.[key]?.trim().replace(/\s+/g, " ");
  return suffix ? `${prompt} ${suffix}` : prompt;
}

/**
 * The opening prompt for a starter, or undefined when this agent has none (the starter is then not offered). With
 * `autoMerge` (the project opted in and the worktree holds only OpenSpec documents) an Archive prompt ends with the fixed
 * archive auto-merge instruction, after the suffix like Ship's; every other starter ignores it (archive-auto-merge-docs).
 * `convention` is the project's pull request title convention, which only Fast-forward's Ship part uses.
 */
export function openingPrompt(
  agent: AgentProfile,
  action: SessionAction,
  change: string,
  { autoMerge = false, convention }: { autoMerge?: boolean; convention?: PrTitleConvention } = {},
): string | undefined {
  if (action === "fastForward") return fastForwardPrompt(agent, change, { convention });
  const template = agent.prompts[action];
  // Checked before the suffix: additional instructions are an addition, never a prompt of their own, so they never make
  // a starter available (agent-sessions spec).
  if (!template) return undefined;
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  const prompt = compose(agent, action, template).replaceAll("{change}", change);
  return autoMerge && action === "archive" ? `${prompt} ${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION}` : prompt;
}

/**
 * Fast-forward has no prompt of its own: the agent's Draft and Implement prompts, each with its additional
 * instructions, then Ship's exactly as Ship would send it, joined by two fixed sentences. Never with an auto-merge
 * instruction — the pull request it asks for is the change's only review. Undefined without both Draft and Implement.
 */
export function fastForwardPrompt(agent: AgentProfile, change: string, { convention }: { convention?: PrTitleConvention } = {}): string | undefined {
  if (!fastForwardAvailable(agent)) return undefined;
  const draft = openingPrompt(agent, "draft", change) as string;
  const implement = openingPrompt(agent, "implement", change) as string;
  return `${draft} ${FAST_FORWARD_CONTINUE_SENTENCE} ${implement} ${FAST_FORWARD_SHIP_SENTENCE} ${shipPrompt(agent, change, { convention })}`;
}

/**
 * Every agent can ship: a profile without its own Ship prompt gets the agent-neutral default — suffix and all. The
 * project's pull request title `convention` goes between the prompt and the suffix, so the user's own text follows it.
 * With `autoMerge` (the project opted in and the session ships only OpenSpec documents) the fixed auto-merge instruction
 * comes last, after the suffix, so nothing in the profile can follow and undo it.
 */
export function shipPrompt(agent: AgentProfile, change: string, { autoMerge = false, convention }: { autoMerge?: boolean; convention?: PrTitleConvention } = {}): string {
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  const base = agent.prompts.ship ?? DEFAULT_SHIP_PROMPT;
  const titled = convention === "conventional-commits" ? `${base} ${CONVENTIONAL_COMMITS_SHIP_SENTENCE}` : base;
  const prompt = compose(agent, "ship", titled).replaceAll("{change}", change);
  return autoMerge ? `${prompt} ${AUTO_MERGE_DOCS_INSTRUCTION}` : prompt;
}

/**
 * Like Ship: every agent can integrate, configured for it or not — suffix and all. Nothing is substituted into it: the
 * repository folder is the agent's working directory, so no text from the browser reaches its command line.
 */
export function integratePrompt(agent: AgentProfile): string {
  return compose(agent, "integrate", agent.prompts.integrate ?? DEFAULT_INTEGRATE_PROMPT);
}

/** Like Ship: every agent can be asked to resolve conflicts, configured for it or not — suffix and all. */
export function resolveConflictsPrompt(agent: AgentProfile, change: string): string {
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  return compose(agent, "resolveConflicts", agent.prompts.resolveConflicts ?? DEFAULT_RESOLVE_CONFLICTS_PROMPT).replaceAll("{change}", change);
}

/** A pull request number as the Merge sentence names it. */
const PR_NUMBER = (pr: unknown): pr is number => typeof pr === "number" && Number.isSafeInteger(pr) && pr > 0;
/** A full commit object name, as `gh` reports `headRefOid`. */
export const HEAD_COMMIT = /^[0-9a-f]{40}$/;

/**
 * Like Ship: every agent can be asked to merge, configured for it or not — suffix and all — and `{change}` stays the
 * only placeholder. The pull request and its head commit follow in a fixed sentence (agent-merges-docs-prs D1); both
 * come from the parsed pull-request list, and anything that is not a positive number or a 40-character object name is
 * refused rather than typed. One line: a profile's prompt may span lines, and a line break would submit it early.
 */
export function mergePrompt(agent: AgentProfile, change: string, { pr, head }: { pr: number; head: string }): string {
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  if (!PR_NUMBER(pr)) throw new Error("invalid pull request number");
  if (typeof head !== "string" || !HEAD_COMMIT.test(head)) throw new Error("invalid head commit");
  const prompt = compose(agent, "merge", agent.prompts.merge ?? DEFAULT_MERGE_PROMPT).replaceAll("{change}", change);
  return `${prompt} ${mergeTargetSentence(pr, head)}`.replace(/\s+/g, " ").trim();
}

export interface Launch {
  argv: string[];
  /** Set when the command has no `{prompt}` argument: the prompt is typed into the terminal after start-up. */
  typed?: string;
}

/** Argument list for the agent. The prompt only ever becomes one whole argument or terminal input — never shell text. */
export function launchCommand(agent: AgentProfile, prompt: string): Launch {
  if (!agent.command.some((arg) => arg.includes("{prompt}"))) return { argv: [...agent.command], typed: prompt };
  return { argv: agent.command.map((arg) => (arg === "{prompt}" ? prompt : arg.replaceAll("{prompt}", prompt))) };
}

/** The default profile, whatever repository settings say: what Integrate and New project start. */
export function defaultAgentOf(config: Config): AgentProfile | undefined {
  return config.agentSessions.agents.find((a) => a.id === config.agentSessions.defaultAgent);
}

/** The main console's agent: the profile chosen for it, else the default — as a project's agent falls back. */
export function consoleAgentOf(config: Config): AgentProfile | undefined {
  return config.agentSessions.agents.find((a) => a.id === config.agentSessions.consoleAgent) ?? defaultAgentOf(config);
}

/** The console has no opening prompt: every argument that would carry one is left out, and nothing is typed. */
export function launchWithoutPrompt(agent: AgentProfile): string[] {
  return agent.command.filter((arg) => !arg.includes("{prompt}"));
}

export function agentEnv(agent: AgentProfile, base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !agent.unsetEnv?.includes(key)) env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}
