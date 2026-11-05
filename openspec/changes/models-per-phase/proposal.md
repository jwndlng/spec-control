# Proposal

## Why

Different OpenSpec phases have fundamentally different model requirements. Drafting a change proposal, specification deltas, technical design, and implementation task lists demands deep reasoning, structured writing, and careful adherence to architectural constraints. Implementing tasks requires fast coding capability, strong tool and shell execution, and adherence to existing repo patterns. Routine archiving and validation often require minimal reasoning capability and can be run faster and cheaper.

Today, Spec Control assigns one global agent or one profile per change/project, running every starter with identical arguments. Users cannot configure specific models for different phases, forcing them to compromise: either paying high latency and token costs on routine tasks, or using a less capable model that struggles with drafting and architecture.

## What Changes

- **Global Default Model**: Allow users to configure a default model in Settings under Agent sessions (`defaultModel`). When set, any agent that does not specify an override inherits this model.
- **Per-Agent Model Selection**: Each configured agent profile can specify a `model` property. Users can choose to inherit the global default model or explicitly assign a specific model to that agent profile.
- **Per-Phase Model Overrides**: Within an agent profile, users can configure phase-specific model overrides for OpenSpec starters (`draft`, `implement`, `validate`, `archive`). A phase override takes precedence over the agent's default model and the global default model.
- **Provider-Neutral Model Flag Application**: Apply the resolved model when starting an agent session regardless of provider (Claude Code, Codex, Antigravity, or custom agents) via standard model argument injection (using `--model <model>` or `{model}` placeholder substitution in `command` / `launchArgs`). If no model is configured or inherited, no model flag is passed, preserving existing CLI defaults and backward compatibility.
- **Settings UI Configuration**: In the Agent sessions section of the Settings page, display a global default model field and per-profile model configuration with an expandable "Phase overrides" section. The UI visually indicates whether an agent or phase is inheriting from the global default or using an explicit override.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: Persist model configuration on agent profiles and global agent settings; resolve the effective model for each session starter by checking phase override, profile default model, and global default model; inject the resolved model argument into the agent launch command without breaking existing presets, resume flows, or custom CLI commands.
- `settings-page`: Provide controls in the Agent sessions section to configure the global default model, view and set each profile's model, and configure phase-specific model overrides with visual indicators for inherited settings.

## Impact

- **Configuration & Types (`src/server/config.ts`, `src/shared/types.ts`)**:
  - Add optional `defaultModel` to `AgentSessionsConfig`.
  - Add optional `model` and `phaseModels?: Partial<Record<StarterPromptKey, string>>` to `AgentProfile`.
  - Validate model strings (trimmed single-line strings without control characters or permission bypass flags).
- **Session Execution (`src/server/sessions/agents.ts`, `src/server/sessions/manager.ts`)**:
  - Resolve effective model for a session action based on phase override -> profile model -> global default model.
  - Inject `--model <model>` into launch arguments (or replace `{model}` in `command`/`launchArgs` when present).
  - Ensure resume commands and console sessions cleanly handle model arguments.
- **UI & Settings (`src/ui/agentSettings.tsx`, `src/ui/changelog.ts`, `src/ui/helpContent.tsx`)**:
  - Add default model input and per-agent phase model inputs in `AgentSettings`.
  - Add What's new entry in `src/ui/changelog.ts`.
- **Tests**:
  - Unit tests in `test/config.test.ts` for schema validation and migration/inheritance.
  - Unit tests in `test/agentSessions.test.ts` for model resolution and CLI launch argument composition.
  - UI tests in `test/agentSettingsUi.test.ts`.
- **Invariants**:
  - Invariant 1 (read-only towards tracked repositories) and loopback-only invariants are fully preserved. No credentials or login flows are introduced; models are purely passed as CLI flags to the agent process.
