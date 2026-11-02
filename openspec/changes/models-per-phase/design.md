# Design

## Context

See `proposal.md` — Why for motivation. Today, Spec Control supports user-defined `AgentProfile` records (`src/shared/types.ts`), each configured with an executable `command`, optional `launchArgs`, starter prompts (`draft`, `implement`, `validate`, `archive`), and `resumeCommand`.

When starting an agent session, `src/server/sessions/agents.ts` (`launchCommand`, `withLaunchArgs`) places any `launchArgs` directly after the executable. However, `launchArgs` applies uniformly across all invocations of that profile (consoles, draft, implement, validate, archive, resume). Currently, there is no mechanism to:
1. Specify a default model across all agents.
2. Specify a default model per agent profile without hardcoding options into `launchArgs`.
3. Provide different models per phase (e.g., a high-reasoning model for drafting, a coding model for implementation, and a lightweight model for routine archiving).

## Goals / Non-Goals

**Goals:**
- Provide a clear model hierarchy: Starter Phase Override → Profile Default Model → Global Default Model → CLI built-in default.
- Support provider-neutral model passing: automatically inject `--model <model>` after the executable when a model is resolved, while allowing custom commands to place `{model}` anywhere in `command` or `launchArgs`.
- Keep existing installations working unchanged: existing configurations without model settings experience no behavioral differences and pass no new arguments.
- Maintain all security and repository invariants: model names are sanitized and validated against control characters and permission-bypass flags; no credentials or API keys are handled by Spec Control.

**Non-Goals:**
- Managing API keys, credentials, or remote model availability checks: agent CLIs remain responsible for authentication and model availability.
- Dynamic runtime model swapping inside an already running terminal session: model selection is determined when a session starts.

## Decisions

### Decision 1: Arbitrary Agent Profiles with Phase Overrides vs. Hardcoded Phase Agents

*Choice*: Keep arbitrary Agent profiles and add model configuration (default model and optional per-phase overrides) to each profile, complemented by a global default model.

*Rationale*:
The prompt raised whether "Agent" maps directly to a phase (drafting, implementing, archiving), or whether users define arbitrary Agents and assign models to each.
- Mapping Agent directly to a phase would be a breaking architectural shift in Spec Control: projects and changes select an Agent profile, and a profile already encapsulates commands, prompts, and tool behavior across all phases.
- Retaining arbitrary agent profiles while allowing profiles to define a default model and optional phase overrides (`phaseModels: { draft?, implement?, validate?, archive? }`) cleanly separates agent execution environment (CLI, tool permissions, prompts) from the underlying LLM model selection. Users who want different models per phase configure them within their chosen profile, and users who want one model everywhere simply set the global default or profile default.

*Alternatives considered*:
- Hardcoding phase agents: Restricting the user to 3 fixed agents ("Drafting Agent", "Implementation Agent", "Archive Agent") would break existing per-repository and per-change agent overrides and prevent users from running different agent tools (e.g. Claude Code for change A and Antigravity for change B).

### Decision 2: Model Argument Injection Strategy

*Choice*: Support `{model}` placeholder in `command` / `launchArgs`, defaulting to inserting `["--model", effectiveModel]` into launch arguments if `{model}` is not present in the command template.

*Rationale*:
All major agent CLIs supported out-of-the-box (Claude Code `claude`, Codex CLI `codex`, Antigravity `agy`) accept the `--model <model>` argument. Inserting `["--model", effectiveModel]` into the launch arguments directly after the executable mirrors `withLaunchArgs` and works out-of-the-box for presets without requiring users to edit command strings. For non-standard custom agents that use flags like `-m <model>` or `--select-model=<model>`, users can include `{model}` in their `command` or `launchArgs`, which disables the default `--model` injection.

*Alternatives considered*:
- Requiring explicit `{model}` in all commands: Would break presets and require existing users to upgrade command lines.
- Provider-specific switch statements: Violates invariant that the dashboard is provider-agnostic and does not depend on vendor-specific protocols.

### Decision 3: Configuration Schema and Model Hierarchy

*Choice*:
- In `AgentSessionsConfig`: add optional `defaultModel?: string`.
- In `AgentProfile`: add optional `model?: string` and optional `phaseModels?: Partial<Record<StarterPromptKey, string>>`.
- Resolution function `resolveModel(config: Config, agent: AgentProfile, action?: SessionAction): string | undefined`.

*Rationale*:
Clear, intuitive cascading precedence:
`phaseModels[starter] ?? agent.model ?? config.agentSessions.defaultModel ?? undefined`.
When the result is `undefined`, the agent CLI runs without an injected model argument, adopting whatever default is built into that CLI.

## Risks / Trade-offs

- [Risk] An agent CLI might not support the `--model` flag (e.g., custom proprietary script).
  → Mitigation: Allow users to specify `{model}` in `command` or leave model fields blank (unset), in which case no `--model` argument is injected.
- [Risk] Invalid model string could cause agent CLI crash on startup.
  → Mitigation: Validate model strings with regex refusing control characters, whitespace-only, and permission-bypass flags (`--dangerously-skip-permissions`, etc.).
- [Risk] Resuming an ended session might receive a different model if settings changed.
  → Mitigation: In accordance with invariant that running/resumed sessions keep their established arguments, sessions track whether a model was passed or inherit the session's recorded profile settings.

## Migration Plan

- Backward compatibility: All new configuration fields (`defaultModel`, `model`, `phaseModels`) are optional in `src/server/config.ts`. Existing `config.json` files parse cleanly with no changes required.
- Presets: Default presets in `src/shared/agentDefaults.ts` remain unchanged (no model specified by default), leaving users in control of when to opt into model overrides.
