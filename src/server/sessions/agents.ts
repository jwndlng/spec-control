// Agent profiles (design.md D16): an agent is a command line plus opening prompts. Nothing here knows any vendor.
import { AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION, AUTO_MERGE_DOCS_INSTRUCTION, AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION, PROPOSAL_TITLE_CONVENTIONAL, PROPOSAL_TITLE_PLAIN, CARRY_OVER_ARCHIVE_PROMPT, CONVENTIONAL_COMMITS_SHIP_SENTENCE, DEFAULT_INTEGRATE_PROMPT, DEFAULT_MERGE_PROMPT, DEFAULT_RESOLVE_CONFLICTS_PROMPT, DEFAULT_SHIP_PROMPT, FAST_FORWARD_CONTINUE_SENTENCE, FAST_FORWARD_SHIP_SENTENCE, fastForwardAvailable, mergeTargetSentence, proposalHandoverSentence, REMOVE_DUPLICATE_DIFFERING_SENTENCE, REMOVE_DUPLICATE_IDENTICAL_SENTENCE, REMOVE_DUPLICATE_PROMPT, resolveConflictsTargetSentence, type AgentAvailability, type DuplicateAfterArchive, type AgentProfile, type Config, type PrTitleConvention, type PromptKey, type PullRequest, type RepoConfig, type SessionAction, type StrandedArchive } from "../../shared/types.ts";
import { AGENT_PRESETS } from "../../shared/agentDefaults.ts";
import { proposalBranch } from "../../shared/sessionBranch.ts";
import { whichOnPath } from "../paths.ts";
import { isBranchName } from "../cleanup.ts";
import { CHANGE_NAME } from "../source.ts";
import { changeAgentFor } from "../../shared/changeAgent.ts";

export function agentFor(config: Config, repo: RepoConfig, change?: string): AgentProfile | undefined {
  if (change !== undefined) return changeAgentFor(config, repo, change);
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

/** Options of the prompts that may lead an agent to open a pull request. */
interface PullRequestPromptOptions {
  autoMerge?: boolean;
  convention?: PrTitleConvention;
  /**
   * The framework's record instruction for this session — the archive branch's for an archive session, else the
   * implementation branch's (agent-sessions: "An agent asked to open a pull request is asked to record its branch").
   * Chosen by the server from the session; absent when the framework supplies none, and then the text is unchanged.
   */
  record?: string;
}

/**
 * The opening prompt for a starter, or undefined when this agent has none (the starter is then not offered). With
 * `autoMerge` (the project opted in and the worktree holds only OpenSpec documents) an Archive prompt ends with the fixed
 * archive auto-merge instruction, after the suffix like Ship's, and then the `record` instruction; every other starter
 * ignores both (archive-auto-merge-docs). With `proposal` (the same proof, for a Draft session on the proposal branch) a
 * Draft prompt ends with the proposal instruction instead; every other starter ignores that (ship-proposals-as-docs-prs).
 * `convention` is the project's pull request title convention, which Fast-forward's Ship part uses — together with
 * `record`, once, in that Ship part — and the proposal instruction's title.
 */
export function openingPrompt(agent: AgentProfile, action: SessionAction, change: string, { autoMerge = false, proposal = false, convention, record }: PullRequestPromptOptions & { proposal?: boolean } = {}): string | undefined {
  if (action === "fastForward") return fastForwardPrompt(agent, change, { convention, record });
  const template = agent.prompts[action];
  // Checked before the suffix: additional instructions are an addition, never a prompt of their own, so they never make
  // a starter available (agent-sessions spec).
  if (!template) return undefined;
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  const prompt = compose(agent, action, template).replaceAll("{change}", change);
  if (autoMerge && action === "archive") return withRecord(`${prompt} ${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION}`, record);
  return proposal && action === "draft" ? `${prompt} ${proposalInstruction(change, convention)}` : prompt;
}

/** The proposal instruction with its title: the project's declared convention decides which, the change name fills it. */
export function proposalInstruction(change: string, convention: PrTitleConvention | undefined): string {
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  const title = (convention === "conventional-commits" ? PROPOSAL_TITLE_CONVENTIONAL : PROPOSAL_TITLE_PLAIN).replaceAll("{change}", change);
  return AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION.replaceAll("{title}", title);
}

/** `text` followed by the record instruction, when there is one. */
function withRecord(text: string, record: string | undefined): string {
  return record ? `${text} ${record}` : text;
}

/** A branch as `for-each-ref` shortens it, local or remote-tracking; nothing option-like or with `..` reaches a prompt. */
const BRANCH_TEXT = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * The carry-over archive prompt (stale-changes spec): the fixed text with the change, the stranded commit, its branch
 * and the default branch filled in, then the docs auto-merge archive instruction and the `record` instruction when
 * `autoMerge` — exactly as for any archive session. Every value is re-checked here, so nothing malformed is ever typed into an agent.
 */
export function carryOverPrompt(change: string, stranded: StrandedArchive, base: string | undefined, { autoMerge = false, record }: { autoMerge?: boolean; record?: string } = {}): string {
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  if (!/^[0-9a-f]{40}$/.test(stranded.commit)) throw new Error("invalid commit");
  for (const branch of [stranded.branch, base]) if (branch !== undefined && (!BRANCH_TEXT.test(branch) || branch.includes(".."))) throw new Error("invalid branch name");
  const prompt = CARRY_OVER_ARCHIVE_PROMPT.replaceAll("{change}", change).replaceAll("{commit}", stranded.commit).replaceAll("{branch}", stranded.branch).replaceAll("{base}", base ?? "the default branch");
  return autoMerge ? withRecord(`${prompt} ${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION}`, record) : prompt;
}

/** A path from git as it may be typed into an agent: no control character (a newline would be an Enter), nothing climbing out. */
function isPathText(path: string): boolean {
  if (path === "" || path.split("/").includes("..")) return false;
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * The remove-duplicate prompt (stale-changes spec): the fixed text with the change, its directory, the archive directory,
 * the default branch and the differing paths of the scan filled in, then the docs auto-merge archive instruction and the
 * `record` instruction when `autoMerge` — exactly as for any archive session. Every value is re-checked here.
 */
export function removeDuplicatePrompt(
  change: string,
  duplicate: Pick<DuplicateAfterArchive, "archive" | "differing" | "differingCount">,
  layout: { changesDir: string; archiveDir?: string },
  base: string | undefined,
  { autoMerge = false, record }: { autoMerge?: boolean; record?: string } = {},
): string {
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  const date = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(duplicate.archive);
  if (!date || date[2] !== change || !layout.archiveDir) throw new Error("invalid archive directory");
  if (base !== undefined && (!BRANCH_TEXT.test(base) || base.includes(".."))) throw new Error("invalid branch name");
  for (const path of [layout.changesDir, layout.archiveDir, ...duplicate.differing]) if (!isPathText(path)) throw new Error("invalid path");
  const changeDir = `${layout.changesDir}/${change}`;
  const more = duplicate.differingCount - duplicate.differing.length;
  const paths = `${duplicate.differing.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  // The paths come from git and go in last, so nothing in them is taken for a placeholder.
  const prompt = REMOVE_DUPLICATE_PROMPT.replaceAll("{differing}", duplicate.differing.length > 0 ? REMOVE_DUPLICATE_DIFFERING_SENTENCE : REMOVE_DUPLICATE_IDENTICAL_SENTENCE)
    .replaceAll("{changeDir}", changeDir)
    .replaceAll("{change}", change)
    .replaceAll("{archiveDir}", `${layout.archiveDir}/${duplicate.archive}`)
    .replaceAll("{base}", base ?? "the default branch")
    .replaceAll("{paths}", paths);
  return autoMerge ? withRecord(`${prompt} ${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION}`, record) : prompt;
}

/**
 * Fast-forward has no prompt of its own: the agent's Draft and Implement prompts, each with its additional
 * instructions, then Ship's exactly as Ship would send it, joined by two fixed sentences. Never with an auto-merge
 * instruction — the pull request it asks for is the change's only review. Undefined without both Draft and Implement.
 */
export function fastForwardPrompt(agent: AgentProfile, change: string, { convention, record }: Omit<PullRequestPromptOptions, "autoMerge"> = {}): string | undefined {
  if (!fastForwardAvailable(agent)) return undefined;
  const draft = openingPrompt(agent, "draft", change) as string;
  const implement = openingPrompt(agent, "implement", change) as string;
  return `${draft} ${FAST_FORWARD_CONTINUE_SENTENCE} ${implement} ${FAST_FORWARD_SHIP_SENTENCE} ${shipPrompt(agent, change, { convention, record })}`;
}

/**
 * Every agent can ship: a profile without its own Ship prompt gets the agent-neutral default — suffix and all. The
 * project's pull request title `convention` and then the `record` instruction go between the prompt and the suffix, so
 * the user's own text follows them and the record is asked for whatever the profile's own Ship prompt says. With `autoMerge` (the project opted in and the session ships only OpenSpec documents) the fixed auto-merge instruction
 * comes last, after the suffix, so nothing in the profile can follow and undo it.
 */
export function shipPrompt(agent: AgentProfile, change: string, { autoMerge = false, convention, record }: PullRequestPromptOptions = {}): string {
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  const base = agent.prompts.ship ?? DEFAULT_SHIP_PROMPT;
  const titled = convention === "conventional-commits" ? `${base} ${CONVENTIONAL_COMMITS_SHIP_SENTENCE}` : base;
  const prompt = compose(agent, "ship", withRecord(titled, record)).replaceAll("{change}", change);
  return autoMerge ? `${prompt} ${AUTO_MERGE_DOCS_INSTRUCTION}` : prompt;
}

/**
 * Like Ship: every agent can integrate, configured for it or not — suffix and all. Nothing is substituted into it: the
 * repository folder is the agent's working directory, so no text from the browser reaches its command line.
 */
export function integratePrompt(agent: AgentProfile): string {
  return compose(agent, "integrate", agent.prompts.integrate ?? DEFAULT_INTEGRATE_PROMPT);
}

/**
 * Like Ship: every agent can be asked to resolve conflicts, configured for it or not — suffix and all. With the change's
 * open pull request, a fixed sentence naming it and both its branches follows (resolve-pr-conflicts D3); all three come
 * from the server's list and are validated again here, so nothing that is not a number or a branch name is typed.
 */
export function resolveConflictsPrompt(agent: AgentProfile, change: string, pr?: Pick<PullRequest, "number" | "head" | "base">): string {
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  const prompt = compose(agent, "resolveConflicts", agent.prompts.resolveConflicts ?? DEFAULT_RESOLVE_CONFLICTS_PROMPT).replaceAll("{change}", change);
  if (!pr) return prompt;
  if (!PR_NUMBER(pr.number) || !isBranchName(pr.head) || !isBranchName(pr.base)) throw new Error("invalid pull request");
  return `${prompt} ${resolveConflictsTargetSentence(pr.number, pr.head, pr.base)}`;
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
export function mergePrompt(agent: AgentProfile, change: string, { pr, head, proposal = false }: { pr: number; head: string; proposal?: boolean }): string {
  if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
  if (!PR_NUMBER(pr)) throw new Error("invalid pull request number");
  if (typeof head !== "string" || !HEAD_COMMIT.test(head)) throw new Error("invalid head commit");
  const prompt = compose(agent, "merge", agent.prompts.merge ?? DEFAULT_MERGE_PROMPT).replaceAll("{change}", change);
  // The proposal's pull request, sent to another session of the change: it is not that worktree's branch (one-console-per-change D3).
  const handover = proposal ? ` ${proposalHandoverSentence(proposalBranch(change))}` : "";
  return typedForm(`${prompt} ${mergeTargetSentence(pr, head)}${handover}`);
}

/**
 * A prompt as the dashboard types it into a terminal: one line, every run of whitespace — line breaks included — one
 * space, nothing leading or trailing. A line break typed would submit the first line early, so nothing the agent could
 * have received is lost. A prompt passed as an argument keeps its line breaks (harden-session-lifecycle D1).
 */
export function typedForm(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface Launch {
  argv: string[];
  /** Set when the command has no `{prompt}` argument: the prompt is typed into the terminal after start-up, as `typedForm`. */
  typed?: string;
}

/**
 * Argument list for the agent. The prompt only ever becomes one whole argument or terminal input — never shell text.
 * Inside a longer argument it is inserted literally: a replacer function's result is not scanned for `$&` and the like.
 */
export function launchCommand(agent: AgentProfile, prompt: string): Launch {
  if (!agent.command.some((arg) => arg.includes("{prompt}"))) return { argv: withLaunchArgs(agent, agent.command), typed: typedForm(prompt) };
  return { argv: withLaunchArgs(agent, agent.command.map((arg) => (arg === "{prompt}" ? prompt : arg.replaceAll("{prompt}", () => prompt)))) };
}

/**
 * The profile's launch arguments directly after the executable (agent-params D2): before a positional prompt or a
 * subcommand such as `codex resume`, where CLIs still read global options. Every start goes through here.
 */
export function withLaunchArgs(agent: AgentProfile, argv: readonly string[]): string[] {
  const [executable, ...rest] = argv;
  return [executable, ...(agent.launchArgs ?? []), ...rest];
}

/** The resume command with the launch arguments, or undefined when the profile has none. */
export function resumeLaunch(agent: AgentProfile): string[] | undefined {
  return agent.resumeCommand && withLaunchArgs(agent, agent.resumeCommand);
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
  return withLaunchArgs(agent, agent.command.filter((arg) => !arg.includes("{prompt}")));
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
