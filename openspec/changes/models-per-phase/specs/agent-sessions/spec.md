# Spec Delta

## ADDED Requirements

### Requirement: Agent model selection and phase model overrides
The dashboard SHALL support configuring an AI model globally, per agent profile, and per session starter phase. The global `agentSessions` configuration MAY specify a `defaultModel`. Each agent profile MAY specify a profile-level `model`, and MAY specify phase-specific model overrides under `phaseModels` for each supported starter (`draft`, `implement`, `validate`, and `archive`).

When starting a session for an action, the dashboard SHALL determine the **effective model** by evaluating:
1. The profile's phase model override for that starter (`agent.phaseModels[starter]`), if defined;
2. Otherwise, the profile's default model (`agent.model`), if defined;
3. Otherwise, the global default model (`config.agentSessions.defaultModel`), if defined;
4. If none of these are defined, no model is selected.

When an effective model is selected, the dashboard SHALL pass it to the agent process:
- If any argument in the agent profile's `command` or `launchArgs` contains the `{model}` placeholder, each occurrence SHALL be replaced by the effective model string as part of argument substitution.
- If no argument contains `{model}`, the arguments `--model` and `<effective-model>` SHALL be added as launch arguments directly following the executable before other arguments.
- If no effective model is selected, `{model}` placeholders SHALL NOT be expanded and no `--model` arguments SHALL be added.

Model strings SHALL be trimmed, single-line strings of 1 to 128 characters, MUST NOT contain control characters, and MUST NOT contain permission-bypass modes or flags. A configuration containing an invalid model string SHALL be refused when saved, leaving the stored configuration unchanged. A running session SHALL keep the model it was started with; changes to models take effect upon the next session start.

#### Scenario: Phase override takes precedence
- **WHEN** the global default model is `claude-3-5-haiku`, the profile `claude` specifies model `claude-3-5-sonnet`, and `draft` in `phaseModels` specifies `claude-3-opus`
- **THEN** starting a `draft` session with the `claude` profile starts with `--model` `claude-3-opus`

#### Scenario: Agent model takes precedence over global default
- **WHEN** the global default model is `gemini-1.5-flash`, the profile `agy` specifies model `gemini-1.5-pro`, and no phase override is set for `implement`
- **THEN** starting an `implement` session with the `agy` profile starts with `--model` `gemini-1.5-pro`

#### Scenario: Global default model applies when profile model is unset
- **WHEN** the global default model is `codex-davinci`, the profile `codex` specifies no profile model and no phase overrides
- **THEN** starting an `implement` session with the `codex` profile starts with `--model` `codex-davinci`

#### Scenario: No model arguments when unset
- **WHEN** no global default model is set, and a profile specifies no model and no phase overrides
- **THEN** starting a session with that profile adds no `--model` argument and leaves the command line to the agent CLI's defaults

#### Scenario: Custom command with model placeholder
- **WHEN** a profile defines the command `my-cli`, `--select-model={model}`, `{prompt}` and the effective model is `custom-model-v1`
- **THEN** starting the agent replaces `{model}` with `custom-model-v1` and does not append an extra `--model` argument

#### Scenario: Running session keeps its started model
- **WHEN** a session is running with model `claude-3-5-sonnet` and the user updates the profile's model to `claude-3-opus` and saves Settings
- **THEN** the running session is not restarted or sent new arguments, and the next session started with that profile uses `claude-3-opus`

#### Scenario: Model with control characters or bypass is rejected
- **WHEN** the user attempts to save a profile with model `sonnet\n--dangerously-skip-permissions`
- **THEN** saving the configuration is refused and the previous configuration is retained
