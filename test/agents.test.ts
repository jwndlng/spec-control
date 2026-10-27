import { expect, test } from "bun:test";
import { defaultAgentSessions, defaultConfig, newRepoConfig, validateConfig } from "../src/server/config.ts";
import { agentEnv, agentFor, carryOverPrompt, fastForwardPrompt, integratePrompt, proposalInstruction, launchCommand, launchWithoutPrompt, mergePrompt, openingPrompt, resolveConflictsPrompt, resumeLaunch, shipPrompt } from "../src/server/sessions/agents.ts";
import { Scrollback, sessionBranch, worktreeName } from "../src/server/sessions/manager.ts";
import { AGENT_PRESETS, ANTIGRAVITY_PROFILE, CLAUDE_PROFILE, CODEX_PROFILE, DEFAULT_SHORTCUTS, FORMER_PROMPTS } from "../src/shared/agentDefaults.ts";
import { AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION, AUTO_MERGE_DOCS_INSTRUCTION, AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION, availableActions, pastDraftingReason, CONVENTIONAL_COMMITS_SHIP_SENTENCE, DEFAULT_INTEGRATE_PROMPT, DEFAULT_MERGE_PROMPT, DEFAULT_RESOLVE_CONFLICTS_PROMPT, DEFAULT_SHIP_PROMPT, FAST_FORWARD_CONTINUE_SENTENCE, FAST_FORWARD_SHIP_SENTENCE, integrateUnavailable, mergeTargetSentence, proposalHandoverSentence, type AgentAvailability, type ChangeSession, type Session } from "../src/shared/types.ts";
import { agentForRepo, cardIsLive, cardSessionControls, NEEDS_YOU_AFTER_MS, parseArgLines, sessionBadge, sessionForChange, sessionsEnabledFor, silenceDuration, slugId, startersFor } from "../src/ui/sessionState.ts";
import { openSpec } from "../src/server/frameworks/openspec/index.ts";
import { fakeProfile } from "./sessionHelpers.ts";

const base = defaultConfig();
const withAgents = (agents: unknown, defaultAgent = "claude") => ({ ...base, agentSessions: { ...base.agentSessions, enabled: true, agents, defaultAgent } });

test("defaults: disabled, Claude Code preconfigured on its own login", () => {
  const d = defaultAgentSessions();
  expect(d.enabled).toBe(false);
  expect(d.agents.map((a) => a.id)).toEqual(["claude"]);
  expect(d.agents[0].command).toEqual(["claude", "{prompt}"]);
  expect(d.agents[0].unsetEnv).toContain("ANTHROPIC_API_KEY");
});

test("the shipped shortcuts: the four answers sent today, each sending exactly what its control reads", () => {
  expect(DEFAULT_SHORTCUTS.map((s) => s.title)).toEqual(["Yes, go ahead", "Yes, create a PR", "Resolve PR conflicts", "No, stop here"]);
  for (const shortcut of DEFAULT_SHORTCUTS) expect(shortcut.prompt).toBe(shortcut.title);
  expect(new Set(DEFAULT_SHORTCUTS.map((s) => s.id)).size).toBe(DEFAULT_SHORTCUTS.length);
});

test("the default configuration carries the shipped shortcuts, freshly cloned each time", () => {
  const first = defaultAgentSessions();
  expect(first.shortcuts).toEqual([...DEFAULT_SHORTCUTS]);
  first.shortcuts[0].title = "edited";
  first.shortcuts.pop();
  const second = defaultAgentSessions();
  expect(second.shortcuts).toEqual([...DEFAULT_SHORTCUTS]);
  expect(DEFAULT_SHORTCUTS[0].title).toBe("Yes, go ahead");
});

test("the preconfigured Archive prompt syncs the specs first without asking, as one line", () => {
  const archive = defaultAgentSessions().agents[0].prompts.archive ?? "";
  expect(archive.startsWith("/opsx:archive {change}")).toBe(true);
  expect(archive).toMatch(/sync the delta specs/);
  expect(archive).toMatch(/without asking/);
  expect(archive).toMatch(/already in sync, archive right away/);
  // The user's confirmation during archiving is the validation, so it is what ticks the awaiting tasks off.
  expect(archive).toMatch(/tick off the tasks left for me to validate once I have confirmed them/);
  expect(archive).not.toContain("\n");
  expect(FORMER_PROMPTS.archive).toContain("/opsx:archive {change}");
  expect(FORMER_PROMPTS.archive).not.toContain(archive);
  const prompt = openingPrompt(CLAUDE_PROFILE, "archive", "cache-api-calls") ?? "";
  expect(prompt.startsWith("/opsx:archive cache-api-calls — sync")).toBe(true);
  expect(launchCommand(CLAUDE_PROFILE, prompt)).toEqual({ argv: ["claude", prompt] }); // one argument
  expect(validateConfig(withAgents([CLAUDE_PROFILE])).agentSessions.agents[0].prompts.archive).toBe(archive); // passes the prompt rules
});

test("the preconfigured prompts carry what `- [~]` means, each on one line", () => {
  const prompts = defaultAgentSessions().agents[0].prompts;
  // Ship, Resolve conflicts and Integrate are not here: the preset uses their agent-neutral defaults.
  expect(Object.keys(prompts)).toEqual(["draft", "implement", "validate", "archive"]);
  for (const [key, text] of Object.entries(prompts)) {
    expect([key, text.includes("\n")]).toEqual([key, false]); // a prompt may be typed into a terminal
    expect([key, text.includes("{change}")]).toEqual([key, true]); // every starter names its change
  }
  // Integrate is the one prompt that must not name a change, because it runs in a folder, not a change.
  expect(DEFAULT_INTEGRATE_PROMPT).not.toContain("\n");
  expect(DEFAULT_INTEGRATE_PROMPT).not.toContain("{change}");
  // Implement: do every part it can, then leave what only the user can verify or carry out for the user, saying what.
  expect(prompts.implement).toMatch(/^\/opsx:apply \{change\}/);
  expect(prompts.implement).toMatch(/only be verified or carried out by me/);
  expect(prompts.implement).toMatch(/do every part of it you can/);
  expect(prompts.implement).toMatch(/`- \[~\]` instead of `- \[x\]` or `- \[ \]`/);
  expect(prompts.implement).toMatch(/add to its line what exactly I have to check or do/);
  // Validate: one task at a time, help where it can, tick off only what the user confirms.
  expect(prompts.validate).toMatch(/`- \[~\]` tasks one at a time/);
  expect(prompts.validate).toMatch(/tell me exactly what to check or do/);
  expect(prompts.validate).toMatch(/help with what you can/);
  expect(prompts.validate).toMatch(/tick off only the ones I confirm as done/);
  // Both new texts survive the prompt rules, and reach the agent as one argument.
  const config = validateConfig(withAgents([CLAUDE_PROFILE])).agentSessions.agents[0].prompts;
  expect(config).toEqual(prompts);
  const opened = openingPrompt(CLAUDE_PROFILE, "validate", "cache-api-calls") ?? "";
  expect(opened).toContain("cache-api-calls");
  expect(opened).not.toContain("{change}");
  expect(launchCommand(CLAUDE_PROFILE, opened)).toEqual({ argv: ["claude", opened] });
});

test("every preset is a valid one-line profile that invokes OpenSpec the way its agent installs it", () => {
  expect(AGENT_PRESETS.map((p) => p.profile.id)).toEqual(["claude", "codex", "agy"]);
  expect(AGENT_PRESETS[0].profile).toBe(CLAUDE_PROFILE);
  expect(AGENT_PRESETS[0].formerPrompts).toBe(FORMER_PROMPTS);
  // All of them at once, unchanged: the schema, the no-bypass rule and the placeholder rules accept them.
  const agents = AGENT_PRESETS.map((p) => p.profile);
  expect(validateConfig(withAgents(agents)).agentSessions.agents).toEqual(agents);
  for (const { profile } of AGENT_PRESETS) {
    expect(Object.keys(profile.prompts)).toEqual(["draft", "implement", "validate", "archive"]);
    expect(profile.promptSuffixes).toBeUndefined();
    for (const [key, text] of Object.entries(profile.prompts)) {
      expect([profile.id, key, text.includes("\n"), text.includes("{change}")]).toEqual([profile.id, key, false, true]);
    }
    // The `- [~]` wording is shared: each preset's prompt ends with Claude Code's tail.
    for (const key of ["implement", "validate", "archive"] as const) {
      expect(profile.prompts[key]?.endsWith(CLAUDE_PROFILE.prompts[key]?.split(" — ").slice(1).join(" — ") ?? "?")).toBe(true);
    }
  }
  for (const text of Object.values(ANTIGRAVITY_PROFILE.prompts)) expect(text.startsWith("/opsx-")).toBe(true);
  expect(ANTIGRAVITY_PROFILE.prompts.archive?.startsWith("/opsx-archive {change} — sync")).toBe(true);
  // Codex gets skills and no commands: no slash command anywhere, the skill named in plain language.
  for (const text of Object.values(CODEX_PROFILE.prompts)) expect(text).not.toMatch(/(^|\s)\/\S/);
  expect(CODEX_PROFILE.prompts.draft).toContain("openspec-ff-change");
  expect(CODEX_PROFILE.prompts.implement).toContain("openspec-apply-change");
  expect(CODEX_PROFILE.prompts.validate).toContain("openspec-apply-change");
  expect(CODEX_PROFILE.prompts.archive).toContain("openspec-archive-change");

  const agy = openingPrompt(ANTIGRAVITY_PROFILE, "implement", "cache-api-calls") ?? "";
  expect(agy.startsWith("/opsx-apply cache-api-calls — ")).toBe(true);
  expect(launchCommand(ANTIGRAVITY_PROFILE, agy)).toEqual({ argv: ["agy", `--prompt-interactive=${agy}`] });
  // A console leaves the flag out with its `{prompt}`: `agy -i` alone would be an option without its value.
  expect(launchWithoutPrompt(ANTIGRAVITY_PROFILE)).toEqual(["agy"]);
  expect(ANTIGRAVITY_PROFILE.resumeCommand).toEqual(["agy", "--continue"]);
  const codex = openingPrompt(CODEX_PROFILE, "implement", "cache-api-calls") ?? "";
  expect(codex).toContain("cache-api-calls");
  expect(codex).toMatch(/`- \[~\]` instead of `- \[x\]`/);
  expect(launchCommand(CODEX_PROFILE, codex)).toEqual({ argv: ["codex", codex] });
  expect(CODEX_PROFILE.resumeCommand).toEqual(["codex", "resume", "--last"]);
});

test("configs from the transcript-based version load: their keys are dropped, defaults fill in", () => {
  const old = { ...base, agentSessions: { enabled: true, maxRunning: 2, idleMinutes: 30, claudePath: "claude", passApiKeyEnv: false, commands: { draft: "/opsx:ff {change}" } }, repos: [{ ...newRepoConfig("/w/demo-ops", true), agent: { enabled: true, allowedTools: ["Bash(x)"] } }] };
  const cfg = validateConfig(old);
  // No `shortcuts` key at all: such a config carries the shipped ones, so nobody's console loses its buttons.
  expect(cfg.agentSessions).toEqual({ enabled: true, agents: defaultAgentSessions().agents, defaultAgent: "claude", shortcuts: [...DEFAULT_SHORTCUTS] });
  expect(cfg.repos[0].agent).toEqual({ enabled: true });
  const { agentSessions: _drop, ...older } = base;
  expect(validateConfig(older).agentSessions.enabled).toBe(false);
});

test("profile validation", () => {
  const ok = fakeProfile({ id: "other" });
  expect(validateConfig(withAgents([ok], "other")).agentSessions.agents[0].name).toBe("Fake Agent");
  expect(() => validateConfig(withAgents([ok]))).toThrow(/defaultAgent/); // default must exist
  expect(() => validateConfig(withAgents([ok, ok], "other"))).toThrow(/unique/);
  expect(() => validateConfig(withAgents([], "other"))).toThrow();
  expect(() => validateConfig(withAgents([{ ...ok, command: [] }], "other"))).toThrow(/executable/);
  expect(() => validateConfig(withAgents([{ ...ok, command: ["{prompt}"] }], "other"))).toThrow(/placeholder/);
  expect(() => validateConfig(withAgents([{ ...ok, command: ["x", "{change}"] }], "other"))).toThrow(/only \{prompt\}/);
  expect(() => validateConfig(withAgents([{ ...ok, command: ["claude", "--dangerously-skip-permissions", "{prompt}"] }], "other"))).toThrow(/bypass/);
  expect(() => validateConfig(withAgents([{ ...ok, resumeCommand: ["claude", "--permission-mode", "bypassPermissions"] }], "other"))).toThrow(/bypass/);
  expect(() => validateConfig(withAgents([{ ...ok, prompts: { implement: "do it" } }], "other"))).toThrow(/must contain \{change\}/);
  expect(() => validateConfig(withAgents([{ ...ok, prompts: { implement: "{change} {branch}" } }], "other"))).toThrow(/only \{change\}/);
  // Integrate names no change: the folder is the working directory, so no placeholder of any kind is substituted into it.
  expect(validateConfig(withAgents([{ ...ok, prompts: { integrate: "set this project up" } }], "other")).agentSessions.agents[0].prompts.integrate).toBe("set this project up");
  expect(() => validateConfig(withAgents([{ ...ok, prompts: { integrate: "set up {change}" } }], "other"))).toThrow(/no placeholder/);
  expect(() => validateConfig(withAgents([{ ...ok, prompts: { integrate: "set up {prompt}" } }], "other"))).toThrow(/no placeholder/);
  expect(() => validateConfig(withAgents([{ ...ok, prompts: { integrate: "set up --dangerously-skip-permissions" } }], "other"))).toThrow(/bypass/);
  expect(validateConfig(withAgents([{ ...ok, prompts: {} }], "other")).agentSessions.agents[0].prompts.integrate).toBeUndefined();
  // A Claude Code profile saved while the preset still carried its own Integrate prompt keeps it, as it was written.
  const savedClaude = { ...structuredClone(CLAUDE_PROFILE), prompts: { ...CLAUDE_PROFILE.prompts, integrate: DEFAULT_INTEGRATE_PROMPT } };
  expect(validateConfig(withAgents([savedClaude])).agentSessions.agents[0].prompts.integrate).toBe(DEFAULT_INTEGRATE_PROMPT);
  expect(() => validateConfig(withAgents([{ ...ok, id: "Bad Id" }], "other"))).toThrow(/lower-case/);
  expect(() => validateConfig({ ...withAgents([ok], "other"), repos: [{ ...newRepoConfig("/w/x", true), agent: { enabled: true, agentId: "nope" } }] })).toThrow(/unknown agent/);
});

test("launch: the prompt is one whole argument, or typed when the command has no placeholder", () => {
  const nasty = '"; rm -rf ~ # $(x)';
  expect(launchCommand(fakeProfile({ command: ["agent", "-i", "{prompt}"] }), nasty)).toEqual({ argv: ["agent", "-i", nasty] });
  expect(launchCommand(fakeProfile({ command: ["agent", "--prompt={prompt}"] }), "hi")).toEqual({ argv: ["agent", "--prompt=hi"] });
  expect(launchCommand(fakeProfile({ command: ["agent"] }), "hi")).toEqual({ argv: ["agent"], typed: "hi" });
  expect(openingPrompt(fakeProfile(), "implement", "cache-api-calls")).toBe("implement cache-api-calls");
  expect(openingPrompt(fakeProfile({ prompts: { implement: "x {change}" } }), "archive", "c")).toBeUndefined();
  expect(() => openingPrompt(fakeProfile(), "implement", "x; rm -rf ~")).toThrow(/invalid change name/);
});

test("additional instructions extend a starter's prompt, and always as one line", () => {
  const extended = fakeProfile({ promptSuffixes: { implement: "Run the linter before you finish." } });
  expect(openingPrompt(extended, "implement", "cache-api-calls")).toBe("implement cache-api-calls Run the linter before you finish.");
  // Nothing else is touched: a suffix for one action never reaches another.
  expect(openingPrompt(extended, "draft", "cache-api-calls")).toBe("draft cache-api-calls");
  expect(openingPrompt(fakeProfile(), "implement", "cache-api-calls")).toBe("implement cache-api-calls");

  // One line, always: a prompt may be typed into a terminal, where a line break would submit it early.
  const multiline = fakeProfile({ promptSuffixes: { archive: "  Sync first.\n\n\tThen tell me what you archived.  " } });
  expect(openingPrompt(multiline, "archive", "cache-api-calls")).toBe("archive cache-api-calls Sync first. Then tell me what you archived.");

  // A suffix may name the change, and is substituted in the same single pass as the prompt's own placeholder.
  const naming = fakeProfile({ promptSuffixes: { implement: "Mention {change} in the commit message." } });
  expect(openingPrompt(naming, "implement", "cache-api-calls")).toBe("implement cache-api-calls Mention cache-api-calls in the commit message.");
  expect(() => openingPrompt(naming, "implement", "x; rm -rf ~")).toThrow(/invalid change name/);
});

test("Ship: additional instructions extend the profile's prompt, or the agent-neutral default", () => {
  expect(shipPrompt(fakeProfile(), "cache-api-calls")).toBe(DEFAULT_SHIP_PROMPT);
  // The case the feature exists for: a standing instruction about pull requests, without restating the whole prompt.
  const extra = "Add the checklist from CONTRIBUTING.md to the pull request body.";
  expect(shipPrompt(fakeProfile({ promptSuffixes: { ship: extra } }), "cache-api-calls")).toBe(`${DEFAULT_SHIP_PROMPT} ${extra}`);
  // On top of the profile's own Ship prompt it behaves the same, `{change}` included.
  const own = fakeProfile({ prompts: { ...fakeProfile().prompts, ship: "Ship {change}." }, promptSuffixes: { ship: "Title the PR after {change}." } });
  expect(shipPrompt(own, "cache-api-calls")).toBe("Ship cache-api-calls. Title the PR after cache-api-calls.");
});

test("Ship for a project with Conventional Commits titles: the sentence goes between the prompt and the additional instructions", () => {
  // Without a convention the default prescribes none, and the prompt is exactly what it was.
  expect(DEFAULT_SHIP_PROMPT).not.toContain("Conventional Commit");
  expect(shipPrompt(fakeProfile(), "cache-api-calls", {})).toBe(DEFAULT_SHIP_PROMPT);
  expect(shipPrompt(fakeProfile(), "cache-api-calls", { convention: "conventional-commits" })).toBe(`${DEFAULT_SHIP_PROMPT} ${CONVENTIONAL_COMMITS_SHIP_SENTENCE}`);
  // The user's own text comes last, on the profile's own prompt too, with `{change}` substituted throughout.
  const extra = "Add the checklist from CONTRIBUTING.md.";
  const own = fakeProfile({ prompts: { ...fakeProfile().prompts, ship: "Ship {change}." }, promptSuffixes: { ship: extra } });
  const prompt = shipPrompt(own, "cache-api-calls", { convention: "conventional-commits" });
  expect(prompt).toBe(`Ship cache-api-calls. ${CONVENTIONAL_COMMITS_SHIP_SENTENCE} ${extra}`);
  expect(prompt).not.toMatch(/[\r\n]/);
  // It passes through placeholder substitution, so it carries none of its own.
  expect(CONVENTIONAL_COMMITS_SHIP_SENTENCE).not.toMatch(/\{[a-z]+\}/);
  // No other prompt carries it.
  expect(resolveConflictsPrompt(own, "cache-api-calls")).not.toContain(CONVENTIONAL_COMMITS_SHIP_SENTENCE);
  // The auto-merge instruction still comes last, after the user's own text.
  expect(shipPrompt(own, "cache-api-calls", { convention: "conventional-commits", autoMerge: true })).toBe(`${prompt} ${AUTO_MERGE_DOCS_INSTRUCTION}`);
});

test("Ship: the auto-merge instruction comes last when asked for, and changes nothing when not", () => {
  const extra = "Add the checklist to the pull request body.";
  const profiles = [fakeProfile(), fakeProfile({ promptSuffixes: { ship: extra } }), fakeProfile({ prompts: { ship: "Ship {change}." }, promptSuffixes: { ship: extra } })];
  for (const profile of profiles) {
    const plain = shipPrompt(profile, "cache-api-calls");
    expect(shipPrompt(profile, "cache-api-calls", { autoMerge: false })).toBe(plain);
    expect(shipPrompt(profile, "cache-api-calls", { autoMerge: true })).toBe(`${plain} ${AUTO_MERGE_DOCS_INSTRUCTION}`);
  }
  // One line (it may be typed into a terminal), agent-neutral, and it asks for no merge and no auto-merge: the
  // dashboard sends the Merge prompt once the pull request is ready (agent-merges-docs-prs D6).
  expect(AUTO_MERGE_DOCS_INSTRUCTION).not.toMatch(/[\r\n]/);
  expect(AUTO_MERGE_DOCS_INSTRUCTION).not.toMatch(/\bgh\b|claude|codex/i);
  expect(AUTO_MERGE_DOCS_INSTRUCTION).toContain("openspec/");
  expectsNoAutoMerge(AUTO_MERGE_DOCS_INSTRUCTION);
});

/** The instruction says not to merge and not to enable auto-merge, and asks for neither anywhere else in it: the only
 *  other mention of merging is that Spec Control will ask for it later. */
function expectsNoAutoMerge(text: string): void {
  const refusal = "do not merge it and do not enable auto-merge on it";
  const later = "Spec Control will ask you to merge it when it is ready";
  expect(text).toContain(refusal);
  expect(text).toContain(later);
  expect(text.replaceAll(refusal, "").replaceAll(later, "")).not.toMatch(/auto-merge|\bmerge (it|the)\b/i);
}

test("Archive: the archive auto-merge instruction comes last when asked for, and no other starter ever carries it", () => {
  const extra = "Create a PR whenever you finished the archive.";
  const profile = fakeProfile({ promptSuffixes: { archive: extra } });
  expect(openingPrompt(profile, "archive", "cache-api-calls", { autoMerge: false })).toBe(`archive cache-api-calls ${extra}`);
  expect(openingPrompt(profile, "archive", "cache-api-calls", { autoMerge: true })).toBe(`archive cache-api-calls ${extra} ${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION}`);
  for (const action of ["draft", "implement", "validate"] as const) {
    expect(openingPrompt(profile, action, "cache-api-calls", { autoMerge: true })).toBe(openingPrompt(profile, action, "cache-api-calls"));
  }
  // An agent without an Archive prompt still has no Archive starter: the instruction is never a prompt of its own.
  expect(openingPrompt(fakeProfile({ prompts: { implement: "x {change}" } }), "archive", "c", { autoMerge: true })).toBeUndefined();
  // One line, agent-neutral, no placeholder; conditional on a pull request, and it asks for none.
  expect(AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION).not.toMatch(/[\r\n{}]/);
  expect(AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION).not.toMatch(/\bgh\b|claude|codex/i);
  expect(AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION).toContain("Do not open a pull request just because of this");
  expect(AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION).toContain("if you open one");
  expectsNoAutoMerge(AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION);
});

test("Draft: the proposal instruction comes last when asked for, with the title the convention decides", () => {
  const extra = "Keep the design short.";
  const profile = fakeProfile({ promptSuffixes: { draft: extra } });
  const conventional = openingPrompt(profile, "draft", "rotate-keys", { proposal: true, convention: "conventional-commits" });
  expect(conventional).toBe(`draft rotate-keys ${extra} ${proposalInstruction("rotate-keys", "conventional-commits")}`);
  expect(conventional).toContain("titled docs(openspec): add rotate-keys,");
  const plain = openingPrompt(profile, "draft", "rotate-keys", { proposal: true }) as string;
  expect(plain).toContain("titled Add OpenSpec proposal rotate-keys,");
  expect(plain).not.toContain("docs(openspec)");
  // Not asked for, or any other starter: never carried; Archive's `autoMerge` never turns it on.
  expect(openingPrompt(profile, "draft", "rotate-keys")).toBe(`draft rotate-keys ${extra}`);
  expect(openingPrompt(profile, "draft", "rotate-keys", { autoMerge: true })).toBe(`draft rotate-keys ${extra}`);
  for (const action of ["implement", "validate", "archive"] as const) expect(openingPrompt(profile, action, "rotate-keys", { proposal: true })).toBe(openingPrompt(profile, action, "rotate-keys"));
  expect(fastForwardPrompt(profile, "rotate-keys")).not.toContain(proposalInstruction("rotate-keys", undefined));
  // One line, agent-neutral, only `{title}`; it asks for the pull request but no merge, no auto-merge, no implementation.
  expect(AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION.replace("{title}", "")).not.toMatch(/[\r\n{}]/);
  expect(AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION).not.toMatch(/\bgh\b|claude|codex/i);
  expect(AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION).toContain("open a pull request against the default branch");
  expect(AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION).toContain("containing only files under openspec/");
  expect(AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION).toContain("do not start implementing the change");
  expectsNoAutoMerge(AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION);
  expect(() => proposalInstruction("../x", undefined)).toThrow();
});

const HEAD = "c0ffee0000000000000000000000000000000001";

test("Merge: the default prompt, then the sentence naming the pull request and its head commit", () => {
  const prompt = mergePrompt(fakeProfile(), "cache-api-calls", { pr: 41, head: HEAD });
  expect(prompt).toBe(`${DEFAULT_MERGE_PROMPT.replaceAll("{change}", "cache-api-calls")} ${mergeTargetSentence(41, HEAD)}`);
  expect(prompt).toEndWith(`#41 and its head commit is ${HEAD}.`);
  expect(prompt).toContain("--match-head-commit");
  expect(prompt).toContain("Do not delete the branch");
  expect(prompt).not.toMatch(/[\r\n]/);
  // Agent-neutral: it names the host's GitHub CLI and no agent vendor.
  expect(DEFAULT_MERGE_PROMPT).not.toMatch(/claude|codex|antigravity/i);
});

test("Merge: a handed-over proposal pull request gets one more sentence naming docs/<change>, after the Merge sentence", () => {
  const prompt = mergePrompt(fakeProfile(), "rotate-keys", { pr: 90, head: HEAD, proposal: true });
  expect(prompt).toBe(`${DEFAULT_MERGE_PROMPT.replaceAll("{change}", "rotate-keys")} ${mergeTargetSentence(90, HEAD)} ${proposalHandoverSentence("docs/rotate-keys")}`);
  expect(prompt).toEndWith("This pull request is the change's proposal from branch docs/rotate-keys, not the branch of this worktree.");
  expect(prompt).not.toMatch(/[\r\n]/);
  expect(mergePrompt(fakeProfile(), "rotate-keys", { pr: 90, head: HEAD })).not.toContain("proposal from branch");
});

test("Merge: a profile's own prompt with {change}, its additional instructions, and nothing after the sentence", () => {
  const own = fakeProfile({ prompts: { merge: "Squash-merge the pull request for {change}." } });
  expect(mergePrompt(own, "cache-api-calls", { pr: 41, head: HEAD })).toBe(`Squash-merge the pull request for cache-api-calls. ${mergeTargetSentence(41, HEAD)}`);
  const suffixed = fakeProfile({ prompts: { merge: "Merge\n{change}." }, promptSuffixes: { merge: " Then\n say done. " } });
  expect(mergePrompt(suffixed, "cache-api-calls", { pr: 7, head: HEAD })).toBe(`Merge cache-api-calls. Then say done. ${mergeTargetSentence(7, HEAD)}`);
  // No other prompt carries the sentence.
  expect(shipPrompt(own, "cache-api-calls")).not.toContain("head commit is");
  expect(resolveConflictsPrompt(own, "cache-api-calls")).not.toContain("head commit is");
});

test("Merge: a bad commit, a bad number or a bad change name is refused, never typed", () => {
  const profile = fakeProfile();
  for (const head of ["c0ffee", HEAD.toUpperCase(), `${HEAD}0`, `${HEAD.slice(0, 39)} `, "", "c0ffee000000000000000000000000000000000; rm"]) {
    expect(() => mergePrompt(profile, "cache-api-calls", { pr: 41, head })).toThrow("invalid head commit");
  }
  for (const pr of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "41" as unknown as number]) {
    expect(() => mergePrompt(profile, "cache-api-calls", { pr, head: HEAD })).toThrow("invalid pull request number");
  }
  expect(() => mergePrompt(profile, "../x", { pr: 41, head: HEAD })).toThrow("invalid change name");
});

test("Merge: a profile's Merge prompt and its additional instructions are validated like Ship's", () => {
  const profile = (prompts: Record<string, string>, promptSuffixes?: Record<string, string>) => withAgents([{ id: "fake", name: "Fake", command: ["fake"], prompts, ...(promptSuffixes ? { promptSuffixes } : {}) }], "fake");
  expect(validateConfig(profile({ merge: "Merge {change}." }, { merge: "Squash it." })).agentSessions.agents[0]).toMatchObject({ prompts: { merge: "Merge {change}." }, promptSuffixes: { merge: "Squash it." } });
  expect(() => validateConfig(profile({ merge: "Merge {change} {pr}." }))).toThrow("only {change} is supported");
  // A config without it loads unchanged.
  expect(validateConfig(profile({ ship: "Ship {change}." })).agentSessions.agents[0].prompts).toEqual({ ship: "Ship {change}." });
});

test("Integrate: prompt plus additional instructions, with nothing substituted into either", () => {
  // Like Ship: a profile without its own Integrate prompt gets the agent-neutral default — suffix and all.
  expect(integratePrompt(fakeProfile())).toBe(DEFAULT_INTEGRATE_PROMPT);
  expect(integratePrompt(fakeProfile({ promptSuffixes: { integrate: " Commit\n nothing. " } }))).toBe(`${DEFAULT_INTEGRATE_PROMPT} Commit nothing.`);
  expect(DEFAULT_INTEGRATE_PROMPT).not.toMatch(/\{[a-z]+\}/);
  const both = fakeProfile({ prompts: { integrate: "Set this project up for OpenSpec." }, promptSuffixes: { integrate: "Ask me before you commit." } });
  expect(integratePrompt(both)).toBe("Set this project up for OpenSpec. Ask me before you commit.");
  expect(integratePrompt(fakeProfile({ prompts: { integrate: "Set it up." } }))).toBe("Set it up.");
  // The preset carries no copy of its own: it uses the default, as it does for Ship.
  expect(CLAUDE_PROFILE.prompts.integrate).toBeUndefined();
  expect(integratePrompt(CLAUDE_PROFILE)).toBe(DEFAULT_INTEGRATE_PROMPT);
});

test("additional instructions are an addition, never a prompt: they make no action available", () => {
  // No prompt for the action: the starter stays unoffered and nothing is composed, so the suffix goes nowhere.
  const suffixOnly = fakeProfile({ prompts: { implement: "implement {change}" }, promptSuffixes: { archive: "Tell me what you archived." } });
  expect(openingPrompt(suffixOnly, "archive", "cache-api-calls")).toBeUndefined();
  const repo = newRepoConfig("/w/demo-ops", true);
  const cfg = { ...base, repos: [repo], agentSessions: { ...base.agentSessions, enabled: true, agents: [suffixOnly], defaultAgent: "fake" } };
  const artifacts = [{ id: "a0", status: "done" as const }];
  expect(startersFor(cfg, { repoId: repo.id, artifacts, stage: "done" })).toEqual([]);
});

test("a composed prompt still reaches the agent whole, whatever it contains", () => {
  const nasty = 'Also: run `echo "; rm -rf ~ $(id)"` nowhere.';
  const agent = fakeProfile({ command: ["agent", "-i", "{prompt}"], promptSuffixes: { implement: nasty } });
  const prompt = openingPrompt(agent, "implement", "cache-api-calls") ?? "";
  expect(prompt).toBe(`implement cache-api-calls ${nasty}`);
  expect(launchCommand(agent, prompt)).toEqual({ argv: ["agent", "-i", prompt] }); // one argument, never shell text
  expect(launchCommand(fakeProfile({ command: ["agent"], promptSuffixes: { implement: nasty } }), prompt)).toEqual({ argv: ["agent"], typed: prompt });
  expect(prompt.includes("\n")).toBe(false); // so the typed path cannot submit it early
});

test("environment: listed variables are removed, a colour terminal is announced", () => {
  const env = agentEnv(fakeProfile(), { PATH: "/bin", ANTHROPIC_API_KEY: "k", OTHER: "1", GONE: undefined });
  expect(env).toEqual({ PATH: "/bin", OTHER: "1", TERM: "xterm-256color", COLORTERM: "truecolor" });
  expect(agentEnv(fakeProfile({ unsetEnv: undefined }), { ANTHROPIC_API_KEY: "k" }).ANTHROPIC_API_KEY).toBe("k");
});

test("agent per repository, falling back to the default", () => {
  const repo = newRepoConfig("/w/demo-ops", true);
  const cfg = { ...base, repos: [{ ...repo, agent: { enabled: true, agentId: "b" } }], agentSessions: { ...base.agentSessions, enabled: true, agents: [fakeProfile({ id: "a" }), fakeProfile({ id: "b", name: "B" })], defaultAgent: "a" } };
  expect(agentFor(cfg, cfg.repos[0])?.id).toBe("b");
  expect(agentFor(cfg, repo)?.id).toBe("a");
  expect(agentForRepo(cfg, repo.id)?.name).toBe("B");
});

test("starters: a blocked change is not offered Implement, everything else is unchanged", () => {
  const a = (...s: ("done" | "ready" | "blocked")[]) => s.map((status, i) => ({ id: `a${i}`, status }));
  expect(availableActions({ artifacts: a("done", "done"), stage: "ready", blocked: true })).toEqual([]);
  expect(availableActions({ artifacts: a("done", "done"), stage: "implementing", blocked: true })).toEqual([]);
  expect(availableActions({ artifacts: a("done", "ready"), stage: "drafts", blocked: true })).toEqual(["draft"]);
  expect(availableActions({ artifacts: a("done", "done"), stage: "done", subState: "validate", blocked: true })).toEqual(["validate", "archive"]);
  expect(availableActions({ artifacts: a("done", "done"), stage: "ready", blocked: false })).toEqual(["implement"]);
});

test("starters: stage decides, narrowed to the prompts the agent has", () => {
  const a = (...s: ("done" | "ready" | "blocked")[]) => s.map((status, i) => ({ id: `a${i}`, status }));
  expect(availableActions({ artifacts: a("done", "ready"), stage: "drafts" })).toEqual(["draft", "fastForward"]);
  expect(availableActions({ artifacts: a("done", "done"), stage: "ready" })).toEqual(["implement"]);
  expect(availableActions({ artifacts: a("done", "done"), stage: "done" })).toEqual(["archive"]);
  expect(availableActions({ artifacts: a("done", "done"), stage: "done", subState: "complete" })).toEqual(["archive"]);
  expect(availableActions({ artifacts: a("done", "done"), stage: "implementing" })).toEqual(["implement"]);
  expect(availableActions({ artifacts: a("done", "done"), stage: "archived", archived: "2026-06-18" })).toEqual([]);
  const repo = newRepoConfig("/w/demo-ops", true);
  const cfg = { ...base, repos: [repo], agentSessions: { ...base.agentSessions, enabled: true, agents: [fakeProfile({ prompts: { implement: "x {change}" } })], defaultAgent: "fake" } };
  expect(startersFor(cfg, { repoId: repo.id, artifacts: a("done", "done"), stage: "ready" })).toEqual(["implement"]);
  expect(startersFor(cfg, { repoId: repo.id, artifacts: a("done", "done"), stage: "done" })).toEqual([]); // no archive prompt
  const archiving = { ...cfg, agentSessions: { ...cfg.agentSessions, agents: [fakeProfile({ prompts: { archive: "a {change}" } })] } };
  for (const stage of ["done"] as const) expect(startersFor(archiving, { repoId: repo.id, artifacts: a("done", "done"), stage })).toEqual(["archive"]);
  expect(sessionsEnabledFor(cfg, repo.id)).toBe(true);
  expect(sessionsEnabledFor({ ...cfg, repos: [{ ...repo, agent: { enabled: false } }] }, repo.id)).toBe(false);
  expect(sessionsEnabledFor({ ...cfg, agentSessions: { ...cfg.agentSessions, enabled: false } }, repo.id)).toBe(false);
});

const session = (patch: Partial<ChangeSession>): ChangeSession => ({ id: "s", repoId: "r", change: "c", action: "implement", agentId: "fake", agentName: "Fake Agent", state: "running", worktreePath: "/w/wt", branch: "feat/c", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", resumable: true, ...patch });

test("a card shows the running session's badge instead of a starter, and a failed one's badge beside it", () => {
  const repo = newRepoConfig("/w/demo-ops", true);
  const cfg = { ...base, repos: [repo], agentSessions: { ...base.agentSessions, enabled: true, agents: [fakeProfile()], defaultAgent: "fake" } };
  const card = { repoId: repo.id, name: "c", artifacts: [{ id: "a0", status: "done" as const }], stage: "ready" as const };
  const mine = (patch: Partial<ChangeSession>) => session({ repoId: repo.id, change: "c", ...patch });

  // No session: the stage's starter, and nothing to show a badge for.
  expect(cardSessionControls(cfg, [], card)).toMatchObject({ shown: [], starters: ["implement"], main: { kind: "start", action: "implement" }, menu: [] });

  // A running session stands in for the starter, whatever its terminal is doing — the badge's words differ, the rule
  // does not, so no button appears and vanishes as the terminal falls silent.
  const printing = cardSessionControls(cfg, [mine({ lastOutputAt: "2026-01-01T00:00:00Z" })], card);
  expect(printing.starters).toEqual([]);
  expect(printing.shown.map((s) => s.id)).toEqual(["s"]);
  const silent = cardSessionControls(cfg, [mine({ lastOutputAt: "2020-01-01T00:00:00Z" })], card);
  expect(silent.starters).toEqual([]);
  expect(sessionBadge(silent.shown[0]).label).toContain("may need you");

  // Failed or badly ended and nothing running: the badge is shown and the starter stays, so a retry is one click away.
  for (const patch of [{ state: "failed" as const, error: "no such file" }, { state: "exited" as const, exitCode: 3 }]) {
    const after = cardSessionControls(cfg, [mine(patch)], card);
    expect(after.starters).toEqual(["implement"]);
    expect(after.shown).toHaveLength(1);
  }
  // A clean exit is not worth a badge, and leaves the starter on its own.
  expect(cardSessionControls(cfg, [mine({ state: "exited", exitCode: 0 })], card)).toMatchObject({ shown: [], starters: ["implement"], main: { kind: "start", action: "implement" }, menu: [] });

  // An archive session running next to the change's own one still counts as running: no starter.
  expect(cardSessionControls(cfg, [mine({ id: "arch", action: "archive" })], { ...card, stage: "done" }).starters).toEqual([]);

  // Another change's session is none of this card's business.
  expect(cardSessionControls(cfg, [session({ repoId: repo.id, change: "other" })], card)).toMatchObject({ shown: [], starters: ["implement"], main: { kind: "start", action: "implement" }, menu: [] });

  // `subState` has to reach `availableActions` through here, or a change awaiting confirmation would never offer
  // Validate on its card. The stock fake agent has no validate prompt, so one that has is what shows the difference.
  const done = { ...card, stage: "done" as const, subState: "validate" as const };
  const validating = { ...cfg, agentSessions: { ...cfg.agentSessions, agents: [fakeProfile({ prompts: { validate: "v {change}", archive: "a {change}" } })] } };
  expect(cardSessionControls(validating, [], done).starters).toEqual(["validate", "archive"]);
  expect(cardSessionControls(validating, [], { ...done, subState: undefined }).starters).toEqual(["archive"]);
  // And a running session still takes the starters' place, Validate included.
  expect(cardSessionControls(validating, [mine({})], done).starters).toEqual([]);

  // Feature off, or the repository switched off: no badge and no starter, as before.
  for (const off of [{ ...cfg, agentSessions: { ...cfg.agentSessions, enabled: false } }, { ...cfg, repos: [{ ...repo, agent: { enabled: false } }] }]) {
    expect(cardSessionControls(off, [mine({})], card)).toEqual({ shown: [], starters: [], menu: [] });
  }
});

test("a card is live exactly while its badge reads working", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  const repo = newRepoConfig("/w/demo-ops", true);
  const cfg = { ...base, repos: [repo], agentSessions: { ...base.agentSessions, enabled: true, agents: [fakeProfile()], defaultAgent: "fake" } };
  const card = { repoId: repo.id, name: "c", artifacts: [{ id: "a0", status: "done" as const }], stage: "ready" as const };
  const mine = (patch: Partial<ChangeSession>) => session({ repoId: repo.id, change: "c", ...patch });
  const printing = new Date(now - NEEDS_YOU_AFTER_MS / 2).toISOString();

  expect(cardIsLive(cfg, [mine({ lastOutputAt: printing })], card, now)).toBe(true);
  // Silent past the limit the badge says "may need you": no motion, no tint.
  expect(cardIsLive(cfg, [mine({ lastOutputAt: new Date(now - NEEDS_YOU_AFTER_MS - 1000).toISOString() })], card, now)).toBe(false);
  // Ended, failed, none at all, or another change's session.
  expect(cardIsLive(cfg, [mine({ state: "exited", exitCode: 0 })], card, now)).toBe(false);
  expect(cardIsLive(cfg, [mine({ state: "exited", exitCode: 3 })], card, now)).toBe(false);
  expect(cardIsLive(cfg, [mine({ state: "failed", error: "no such file" })], card, now)).toBe(false);
  expect(cardIsLive(cfg, [], card, now)).toBe(false);
  expect(cardIsLive(cfg, [session({ repoId: repo.id, change: "other", lastOutputAt: printing })], card, now)).toBe(false);
  // Sessions switched off, globally or for the repository: the card stays plain like its footer.
  for (const off of [{ ...cfg, agentSessions: { ...cfg.agentSessions, enabled: false } }, { ...cfg, repos: [{ ...repo, agent: { enabled: false } }] }]) {
    expect(cardIsLive(off, [mine({ lastOutputAt: printing })], card, now)).toBe(false);
  }
});

test("badges are honest about what a terminal can tell", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  // The two running states are told apart by their words; tone and motion only reinforce them.
  expect(sessionBadge(session({ lastOutputAt: "2026-01-01T00:59:50Z" }), now)).toMatchObject({ icon: "●", label: "working", tone: "info", live: true });
  expect(sessionBadge(session({ lastOutputAt: "2026-01-01T00:50:00Z" }), now)).toMatchObject({ icon: "◆", label: "may need you 10m", tone: "warning" });
  expect(sessionBadge(session({ state: "exited", exitCode: 0 }), now)).toMatchObject({ label: "ended", tone: "" });
  expect(sessionBadge(session({ state: "exited", exitCode: 3 }), now)).toMatchObject({ icon: "⚠", label: "ended (3)", tone: "danger" });
  expect(sessionBadge(session({ state: "failed", error: "no such file" }), now)).toMatchObject({ tone: "danger", title: "no such file" });
});

test("only a terminal that is producing output is shown with motion", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  const live = (patch: Partial<ChangeSession>) => sessionBadge(session(patch), now).live === true;
  expect(live({ lastOutputAt: "2026-01-01T00:59:50Z" })).toBe(true);
  expect(live({})).toBe(true); // just started, nothing printed yet
  expect(live({ lastOutputAt: "2026-01-01T00:50:00Z" })).toBe(false); // silent: may need the user
  expect(live({ state: "exited", exitCode: 0 })).toBe(false);
  expect(live({ state: "exited", exitCode: 3 })).toBe(false);
  expect(live({ state: "failed" })).toBe(false);
});

test("a silent terminal says the session may need you within seconds, never that the agent waits", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  const badge = (silentMs: number) => sessionBadge(session({ lastOutputAt: new Date(now - silentMs).toISOString() }), now);
  expect(NEEDS_YOU_AFTER_MS).toBeLessThanOrEqual(30_000);
  expect(badge(NEEDS_YOU_AFTER_MS - 1_000).label).toBe("working");
  expect(badge(NEEDS_YOU_AFTER_MS).label).toBe("working");
  expect(badge(NEEDS_YOU_AFTER_MS + 1_000).label).toBe(`may need you ${Math.floor((NEEDS_YOU_AFTER_MS + 1_000) / 1000)}s`);
  expect(badge(45_000).label).toBe("may need you 45s");
  expect(badge(3 * 60_000 + 20_000).label).toBe("may need you 3m");
  expect(badge(10 * 60_000).label).toBe("may need you 10m");
  // worded as a possibility: nothing claims the agent is waiting or working
  for (const b of [badge(0), badge(45_000)]) expect(`${b.label} ${b.title}`).not.toMatch(/\bis waiting\b|\bwaits\b|\bis working\b/);
  expect(badge(45_000).title).toContain("may be waiting");
  // a just-started session has printed nothing yet and is not announced as needing the user
  expect(sessionBadge(session({}), now).label).toBe("working");
});

test("the two running states differ in their words, not only in colour and motion", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  const working = sessionBadge(session({ lastOutputAt: "2026-01-01T00:59:55Z" }), now);
  const silent = sessionBadge(session({ lastOutputAt: "2026-01-01T00:59:00Z" }), now);
  expect(working.label).not.toBe(silent.label);
  expect(working.label).not.toContain("may need you");
  expect(silent.label).toStartWith("may need you");
});

test("output resuming after a silent spell returns the badge to working and drops the duration", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  const silent = session({ lastOutputAt: "2026-01-01T00:55:00Z" });
  expect(sessionBadge(silent, now).label).toBe("may need you 5m");
  const resumed = { ...silent, lastOutputAt: "2026-01-01T00:59:59Z" };
  expect(sessionBadge(resumed, now)).toMatchObject({ label: "working", tone: "info", live: true });
});

test("a silence is stated in seconds under a minute, in minutes from there on", () => {
  expect([0, 20_000, 59_000, 59_999, 60_000, 10 * 60_000].map(silenceDuration)).toEqual(["0s", "20s", "59s", "59s", "1m", "10m"]);
});

test("a card shows its running session, or the latest one if that ended badly", () => {
  const clean = session({ id: "a", state: "exited", exitCode: 0, createdAt: "2026-01-01T00:00:00Z" });
  const crashed = session({ id: "b", state: "exited", exitCode: 3, createdAt: "2026-01-02T00:00:00Z" });
  const running = session({ id: "c", createdAt: "2026-01-03T00:00:00Z" });
  expect(sessionForChange([clean, crashed, running], "r", "c")?.id).toBe("c");
  expect(sessionForChange([clean, crashed], "r", "c")?.id).toBe("b");
  expect(sessionForChange([crashed, { ...clean, createdAt: "2026-01-05T00:00:00Z" }], "r", "c")).toBeUndefined();
});

test("small helpers", () => {
  expect(worktreeName("archive", "c")).toBe("archive-c");
  expect(worktreeName("implement", "c")).toBe("c");
  expect(sessionBranch("archive", "c")).toBe("chore/archive-c");
  expect(sessionBranch("draft", "c")).toBe("feat/c");
  // A Draft session that ships its proposal gets a branch and a worktree of its own; no other action ever does.
  expect(sessionBranch("draft", "c", { proposal: true })).toBe("docs/c");
  expect(worktreeName("draft", "c", { proposal: true })).toBe("docs-c");
  expect(worktreeName("draft", "c")).toBe("c");
  for (const action of ["fastForward", "implement", "validate"] as const) {
    expect(sessionBranch(action, "c", { proposal: true })).toBe("feat/c");
    expect(worktreeName(action, "c", { proposal: true })).toBe("c");
  }
  expect(sessionBranch("archive", "c", { proposal: true })).toBe("chore/archive-c");
  expect(parseArgLines(" claude \n\n {prompt} \n")).toEqual(["claude", "{prompt}"]);
  expect(slugId("My Agent!", ["my-agent"])).toBe("my-agent-2");
  const sb = new Scrollback(10);
  for (const part of ["aaaa", "bbbb", "cccc", "dd"]) sb.push(new TextEncoder().encode(part));
  expect(new TextDecoder().decode(sb.bytes())).toBe("bbbbccccdd"); // oldest chunk dropped once over the limit
});

test("the Integrate row says why the action is unavailable, and offers it when nothing is in the way", () => {
  const agent = fakeProfile({ prompts: { integrate: "set this project up" } });
  const on = { ...base, agentSessions: { ...base.agentSessions, enabled: true, agents: [agent], defaultAgent: "fake" } };
  const found: AgentAvailability[] = [{ id: "fake", name: "Fake Agent", available: true, path: "/usr/local/bin/fake" }];

  expect(integrateUnavailable(on, found)).toBeUndefined();
  expect(integrateUnavailable({ ...on, agentSessions: { ...on.agentSessions, enabled: false } }, found)).toBe("agent sessions are disabled");
  expect(integrateUnavailable({ ...on, agentSessions: { ...on.agentSessions, defaultAgent: "gone" } }, found)).toBe("no agent is configured");
  // No Integrate prompt of its own is no reason: the default applies.
  const noPrompt = { ...on, agentSessions: { ...on.agentSessions, agents: [fakeProfile()] } };
  expect(integrateUnavailable(noPrompt, found)).toBeUndefined();
  expect(integrateUnavailable(on, [{ ...found[0], available: false, path: undefined }])).toBe(`Fake Agent was not found (${agent.command[0]})`);
  // Availability not known yet (the list has not been polled): the action is offered and the request decides.
  expect(integrateUnavailable(on, [])).toBeUndefined();
});

test("starters: a change awaiting validation offers Validate and Archive, never Implement", () => {
  const a = (...s: ("done" | "ready" | "blocked")[]) => s.map((status, i) => ({ id: `a${i}`, status }));
  const done = a("done", "done");
  expect(availableActions({ artifacts: done, stage: "done", subState: "validate" })).toEqual(["validate", "archive"]);
  expect(availableActions({ artifacts: done, stage: "done", subState: "validate" })).not.toContain("implement");
  // `validate` belongs to `Done` alone; nothing earlier offers it.
  for (const stage of ["backlog", "drafts", "ready", "implementing", "unknown"] as const) {
    expect(availableActions({ artifacts: done, stage })).not.toContain("validate");
  }
  // An archived change offers nothing, whatever a leftover sub-state says.
  expect(availableActions({ artifacts: done, stage: "archived", subState: "validate", archived: "2026-06-18" })).toEqual([]);
  // A snapshot cached before sub-states existed reads as `complete`.
  expect(availableActions({ artifacts: done, stage: "done" })).toEqual(["archive"]);

  // Narrowed to the prompts the agent has: without a Validate prompt only Archive is offered.
  const repo = newRepoConfig("/w/demo-ops", true);
  const card = { repoId: repo.id, artifacts: done, stage: "done" as const, subState: "validate" as const };
  const withBoth = { ...base, repos: [repo], agentSessions: { ...base.agentSessions, enabled: true, agents: [fakeProfile({ prompts: { validate: "v {change}", archive: "a {change}" } })], defaultAgent: "fake" } };
  expect(startersFor(withBoth, card)).toEqual(["validate", "archive"]);
  const archiveOnly = { ...withBoth, agentSessions: { ...withBoth.agentSessions, agents: [fakeProfile({ prompts: { archive: "a {change}" } })] } };
  expect(startersFor(archiveOnly, card)).toEqual(["archive"]);
});

test("the resolve-conflicts prompt falls back to the agent-neutral default, like Ship", () => {
  const plain = fakeProfile({ prompts: {} });
  expect(resolveConflictsPrompt(plain, "cache-api-calls")).toBe(DEFAULT_RESOLVE_CONFLICTS_PROMPT.replaceAll("{change}", "cache-api-calls"));
  // It states the goal and leaves rebase-or-merge to the agent, which knows the repository's convention.
  expect(resolveConflictsPrompt(plain, "cache-api-calls")).toContain("cache-api-calls");
  expect(resolveConflictsPrompt(plain, "cache-api-calls")).not.toMatch(/\brebase\b/);
  expect(shipPrompt(plain, "cache-api-calls")).not.toBe(resolveConflictsPrompt(plain, "cache-api-calls"));
});

test("a profile's own resolve-conflicts prompt wins and substitutes the change", () => {
  const custom = fakeProfile({ prompts: { resolveConflicts: "fix {change} please, {change}" } });
  expect(resolveConflictsPrompt(custom, "alpha-infra")).toBe("fix alpha-infra please, alpha-infra");
});

test("additional instructions are appended to the resolve-conflicts prompt, and to the default too", () => {
  const withSuffix = fakeProfile({ prompts: { resolveConflicts: "fix {change}" }, promptSuffixes: { resolveConflicts: "We rebase here,\n  never merge." } });
  // Collapsed to one line: the prompt may be typed into a terminal, where a newline would submit it early.
  expect(resolveConflictsPrompt(withSuffix, "alpha-infra")).toBe("fix alpha-infra We rebase here, never merge.");

  const onDefault = fakeProfile({ prompts: {}, promptSuffixes: { resolveConflicts: "Always run bun run check." } });
  expect(resolveConflictsPrompt(onDefault, "alpha-infra")).toBe(`${DEFAULT_RESOLVE_CONFLICTS_PROMPT.replaceAll("{change}", "alpha-infra")} Always run bun run check.`);

  // A suffix meant for another key is not borrowed.
  const shipOnly = fakeProfile({ prompts: {}, promptSuffixes: { ship: "Mention the ticket." } });
  expect(resolveConflictsPrompt(shipOnly, "alpha-infra")).toBe(DEFAULT_RESOLVE_CONFLICTS_PROMPT.replaceAll("{change}", "alpha-infra"));
});

test("an invalid change name never reaches a resolve-conflicts prompt", () => {
  const plain = fakeProfile({ prompts: {} });
  for (const bad of ["../escape", "a b", "", "x;rm -rf /", "sub/dir"]) {
    expect(() => resolveConflictsPrompt(plain, bad)).toThrow("invalid change name");
  }
});

test("an agent's waiting report comes first, worded as the agent's report", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  const reported = "2026-01-01T00:57:00Z";
  // Even while the terminal prints (a console redraw, a status line), the report is what the badge says.
  for (const lastOutputAt of ["2026-01-01T00:59:59Z", "2026-01-01T00:50:00Z"]) {
    expect(sessionBadge(session({ lastOutputAt, waitingReportedAt: reported }), now)).toMatchObject({ icon: "◆", label: "waiting for you · 3m", tone: "warning", title: "Fake Agent reported 3m ago that it is waiting for you" });
  }
  expect(sessionBadge(session({ waitingReportedAt: "2026-01-01T00:59:30Z" }), now).label).toBe("waiting for you · 30s");
  expect(sessionBadge(session({ waitingReportedAt: reported }), now).live).toBeUndefined();
  // Its words differ from both silence-based states.
  const words = new Set([sessionBadge(session({ waitingReportedAt: reported }), now), sessionBadge(session({ lastOutputAt: "2026-01-01T00:59:59Z" }), now), sessionBadge(session({ lastOutputAt: "2026-01-01T00:50:00Z" }), now)].map((b) => b.label.split(/[ ·]+\d/)[0]));
  expect(words.size).toBe(3);
  // An ended or failed session is shown as ended or failed, whatever the agent reported last.
  expect(sessionBadge(session({ state: "exited", exitCode: 0, waitingReportedAt: reported }), now).label).toBe("ended");
  expect(sessionBadge(session({ state: "failed", error: "no such file", waitingReportedAt: reported }), now).tone).toBe("danger");
  // Nothing unparseable claims anything.
  expect(sessionBadge(session({ lastOutputAt: "2026-01-01T00:50:00Z", waitingReportedAt: "nonsense" }), now).label).toBe("may need you 10m");
});

test("starters: Draft is decided by stage, and in Ready only for an artifact implementing does not need", () => {
  const optional = (status: "done" | "ready") => [{ id: "proposal", status: "done" as const, required: true }, { id: "tasks", status: "done" as const, required: true }, { id: "design", status, required: false }];
  // Done without a design: only Archive, and Draft is refused as past drafting.
  expect(availableActions({ artifacts: optional("ready"), stage: "done" })).toEqual(["archive"]);
  expect(availableActions({ artifacts: optional("ready"), stage: "done", subState: "validate" })).toEqual(["validate", "archive"]);
  expect(pastDraftingReason({ stage: "done" })).toContain("past drafting");
  // Implementing without a design: Implement only.
  expect(availableActions({ artifacts: optional("ready"), stage: "implementing" })).toEqual(["implement"]);
  expect(pastDraftingReason({ stage: "implementing" })).toContain("past drafting");
  // Ready may still draft its design; with every artifact written it is Implement only.
  expect(availableActions({ artifacts: optional("ready"), stage: "ready" })).toEqual(["draft", "implement"]);
  expect(availableActions({ artifacts: optional("done"), stage: "ready" })).toEqual(["implement"]);
  expect(pastDraftingReason({ stage: "ready" })).toBeUndefined();
  // Before planning, Draft is offered whatever the artifacts say.
  for (const stage of ["unknown", "backlog", "drafts"] as const) expect(availableActions({ artifacts: optional("ready"), stage })).toContain("draft");
});

test("Fast-forward: offered only while a change is unplanned and not blocked, and only to an agent that can draft and implement", () => {
  const a = (...s: ("done" | "ready" | "blocked")[]) => s.map((status, i) => ({ id: `a${i}`, status }));
  expect(availableActions({ artifacts: [], stage: "unknown" })).toEqual(["draft", "fastForward"]);
  expect(availableActions({ artifacts: a("ready", "blocked"), stage: "backlog" })).toEqual(["draft", "fastForward"]);
  expect(availableActions({ artifacts: a("done", "ready"), stage: "drafts", blocked: true })).toEqual(["draft"]);
  // Ready with an optional design still missing: Draft stays offered, Fast-forward does not.
  expect(availableActions({ artifacts: [{ id: "tasks", status: "done", required: true }, { id: "design", status: "ready", required: false }], stage: "ready" })).toEqual(["draft", "implement"]);
  expect(availableActions({ artifacts: a("done", "ready"), stage: "archived", archived: "2026-06-18" })).toEqual([]);

  const repo = newRepoConfig("/w/demo-ops", true);
  const withPrompts = (prompts: Record<string, string>) => ({ ...base, repos: [repo], agentSessions: { ...base.agentSessions, enabled: true, agents: [fakeProfile({ prompts })], defaultAgent: "fake" } });
  const card = { repoId: repo.id, artifacts: a("done", "ready"), stage: "drafts" as const };
  expect(startersFor(withPrompts({ draft: "d {change}", implement: "i {change}" }), card)).toEqual(["draft", "fastForward"]);
  expect(startersFor(withPrompts({ draft: "d {change}" }), card)).toEqual(["draft"]);
  expect(startersFor(withPrompts({ implement: "i {change}" }), card)).toEqual([]);
});

test("Fast-forward: Draft, then Implement, then Ship, each with its additional instructions, and never an auto-merge instruction", () => {
  const profile = fakeProfile({ promptSuffixes: { draft: "Keep it short.", implement: "Run the tests.", ship: "Mention the ticket." } });
  const ship = shipPrompt(profile, "cache-api-calls");
  const expected = `draft cache-api-calls Keep it short. ${FAST_FORWARD_CONTINUE_SENTENCE} implement cache-api-calls Run the tests. ${FAST_FORWARD_SHIP_SENTENCE} ${ship}`;
  expect(fastForwardPrompt(profile, "cache-api-calls")).toBe(expected);
  expect(openingPrompt(profile, "fastForward", "cache-api-calls")).toBe(expected);
  // Asked for an auto-merge instruction, a starter other than Archive ignores it — Fast-forward included.
  expect(openingPrompt(profile, "fastForward", "cache-api-calls", { autoMerge: true })).toBe(expected);
  expect(expected).not.toContain(AUTO_MERGE_DOCS_INSTRUCTION);
  expect(expected).not.toContain(AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION);
  expect(expected).not.toContain("\n");
  // The project's title convention reaches its Ship part exactly as Ship would send it.
  const titled = fastForwardPrompt(profile, "cache-api-calls", { convention: "conventional-commits" }) as string;
  expect(titled.endsWith(shipPrompt(profile, "cache-api-calls", { convention: "conventional-commits" }))).toBe(true);
  expect(titled).toContain(CONVENTIONAL_COMMITS_SHIP_SENTENCE);
  // Without both phases there is nothing to fast-forward.
  expect(fastForwardPrompt(fakeProfile({ prompts: { draft: "d {change}" } }), "cache-api-calls")).toBeUndefined();
  expect(openingPrompt(fakeProfile({ prompts: { implement: "i {change}" } }), "fastForward", "cache-api-calls")).toBeUndefined();
  expect(() => fastForwardPrompt(profile, "../etc")).toThrow("invalid change name");
});

test("Fast-forward with the preconfigured Claude Code profile starts with the ff command and carries the `- [~]` meaning", () => {
  const prompt = fastForwardPrompt(CLAUDE_PROFILE, "cache-api-calls") as string;
  expect(prompt.startsWith("/opsx:ff cache-api-calls ")).toBe(true);
  expect(prompt).toContain("/opsx:apply cache-api-calls — ");
  expect(prompt).toContain("`- [~]`");
  expect(prompt.endsWith(DEFAULT_SHIP_PROMPT)).toBe(true);
  expect(prompt.indexOf(FAST_FORWARD_CONTINUE_SENTENCE)).toBeLessThan(prompt.indexOf("/opsx:apply"));
  expect(launchCommand(CLAUDE_PROFILE, prompt).argv).toEqual(["claude", prompt]);
});

test("every preset says how to install it on each platform, with a command to copy", () => {
  for (const preset of AGENT_PRESETS) {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const steps = preset.install[platform];
      expect([preset.profile.id, platform, steps.length > 0, steps.some((step) => !!step.command)]).toEqual([preset.profile.id, platform, true, true]);
    }
  }
});

test("every preset's Archive prompt asks for the whole move to be committed; the previous text upgrades, an edited one stays", () => {
  for (const { profile, formerPrompts } of AGENT_PRESETS) {
    const archive = profile.prompts.archive ?? "";
    expect([profile.id, archive.endsWith("and include in your commit every file the archive moved or removed.")]).toEqual([profile.id, true]);
    // The text before this clause, verbatim, is one of the preset's former Archive prompts and is read as the current one.
    const previous = archive.replace(", and include in your commit every file the archive moved or removed.", ".");
    expect(formerPrompts.archive).toContain(previous);
    const agent = { ...profile, prompts: { archive: previous } };
    expect(validateConfig(withAgents([agent], profile.id)).agentSessions.agents[0].prompts.archive).toBe(archive);
    const edited = { ...profile, prompts: { archive: `${previous} Then stop.` } };
    expect(validateConfig(withAgents([edited], profile.id)).agentSessions.agents[0].prompts.archive).toBe(`${previous} Then stop.`);
  }
});

test("every preset's Implement and Validate prompts cover tasks only the user can carry out; the previous texts upgrade, edited ones stay", () => {
  for (const { profile, formerPrompts } of AGENT_PRESETS) {
    for (const key of ["implement", "validate"] as const) {
      const current = profile.prompts[key] ?? "";
      expect([profile.id, key, /check or do/.test(current)]).toEqual([profile.id, key, true]);
      // The text that only spoke of verifying, verbatim, is one of the preset's former prompts and reads as the current one.
      const previous = formerPrompts[key]?.at(-1) ?? "";
      expect([profile.id, key, previous.includes("`- [~]`"), previous === current]).toEqual([profile.id, key, true, false]);
      const agent = { ...profile, prompts: { [key]: previous } };
      expect(validateConfig(withAgents([agent], profile.id)).agentSessions.agents[0].prompts[key]).toBe(current);
      const edited = { ...profile, prompts: { [key]: `${previous} Then stop.` } };
      expect(validateConfig(withAgents([edited], profile.id)).agentSessions.agents[0].prompts[key]).toBe(`${previous} Then stop.`);
    }
  }
});

// agent-sessions: "An agent asked to open a pull request is asked to record its branch". The server picks the text
// (`SessionManager.recordInstruction`); these are the places it goes.
const RECORD = openSpec.recordInstruction({ change: "rotate-keys", archive: false });
const ARCHIVE_RECORD = openSpec.recordInstruction({ change: "rotate-keys", archive: true });

test("Ship carries the record instruction right after the prompt, and is unchanged without one", () => {
  expect(shipPrompt(fakeProfile(), "rotate-keys", { record: RECORD })).toBe(`${DEFAULT_SHIP_PROMPT} ${RECORD}`);
  expect(shipPrompt(fakeProfile(), "rotate-keys", { record: undefined })).toBe(DEFAULT_SHIP_PROMPT);
  expect(shipPrompt(fakeProfile(), "rotate-keys", { record: ARCHIVE_RECORD })).toContain("archive-branch:");
  // A profile with its own Ship prompt gets it all the same.
  const own = fakeProfile({ prompts: { ...fakeProfile().prompts, ship: "Ship {change}." } });
  expect(shipPrompt(own, "rotate-keys", { record: RECORD })).toBe(`Ship rotate-keys. ${RECORD}`);
});

test("Ship with every addition: prompt, Conventional Commits, record, additional instructions, auto-merge", () => {
  const extra = "Mention the ticket.";
  const profile = fakeProfile({ promptSuffixes: { ship: extra } });
  expect(shipPrompt(profile, "rotate-keys", { convention: "conventional-commits", record: RECORD, autoMerge: true })).toBe(
    `${DEFAULT_SHIP_PROMPT} ${CONVENTIONAL_COMMITS_SHIP_SENTENCE} ${RECORD} ${extra} ${AUTO_MERGE_DOCS_INSTRUCTION}`,
  );
});

test("Fast-forward carries the record instruction exactly once, within its Ship part", () => {
  const profile = fakeProfile();
  const prompt = openingPrompt(profile, "fastForward", "rotate-keys", { record: RECORD }) as string;
  expect(prompt.split(RECORD).length - 1).toBe(1);
  expect(prompt.endsWith(shipPrompt(profile, "rotate-keys", { record: RECORD }))).toBe(true);
  expect(openingPrompt(profile, "fastForward", "rotate-keys")).not.toContain("spec-control:");
});

test("Archive: the record instruction follows the archive auto-merge instruction, and only with it", () => {
  const profile = fakeProfile();
  expect(openingPrompt(profile, "archive", "rotate-keys", { autoMerge: true, record: ARCHIVE_RECORD })).toBe(`archive rotate-keys ${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION} ${ARCHIVE_RECORD}`);
  expect(openingPrompt(profile, "archive", "rotate-keys", { record: ARCHIVE_RECORD })).toBe("archive rotate-keys");
  for (const action of ["draft", "implement", "validate"] as const) {
    expect(openingPrompt(profile, action, "rotate-keys", { autoMerge: true, record: RECORD })).toBe(openingPrompt(profile, action, "rotate-keys"));
  }
  const stranded = { branch: "feat/rotate-keys", archive: "2026-10-20-rotate-keys", commit: "c0ffee0000000000000000000000000000000001" };
  const plain = carryOverPrompt("rotate-keys", stranded, "main");
  expect(carryOverPrompt("rotate-keys", stranded, "main", { record: ARCHIVE_RECORD })).toBe(plain);
  expect(carryOverPrompt("rotate-keys", stranded, "main", { autoMerge: true, record: ARCHIVE_RECORD })).toBe(`${plain} ${AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION} ${ARCHIVE_RECORD}`);
});

test("launch arguments go directly after the executable on every start; without them the argv is unchanged", () => {
  const agy = { ...ANTIGRAVITY_PROFILE, launchArgs: ["--mode", "auto"] };
  const prompt = openingPrompt(agy, "implement", "cache-api-calls") as string;
  expect(launchCommand(agy, prompt)).toEqual({ argv: ["agy", "--mode", "auto", `--prompt-interactive=${prompt}`] });
  expect(launchWithoutPrompt(agy)).toEqual(["agy", "--mode", "auto"]); // no option left over that expects a value
  expect(resumeLaunch(agy)).toEqual(["agy", "--mode", "auto", "--continue"]);
  expect(launchCommand(fakeProfile({ command: ["my-agent-cli"], launchArgs: ["--model", "fast"] }), "hi")).toEqual({ argv: ["my-agent-cli", "--model", "fast"], typed: "hi" });
  expect(resumeLaunch(fakeProfile({ resumeCommand: undefined, launchArgs: ["--model", "fast"] }))).toBeUndefined();

  expect(launchCommand(ANTIGRAVITY_PROFILE, prompt)).toEqual({ argv: ["agy", `--prompt-interactive=${prompt}`] });
  expect(launchWithoutPrompt(ANTIGRAVITY_PROFILE)).toEqual(["agy"]);
  expect(resumeLaunch(CODEX_PROFILE)).toEqual(["codex", "resume", "--last"]);
});
