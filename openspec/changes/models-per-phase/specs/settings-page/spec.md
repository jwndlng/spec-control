# Spec Delta

## ADDED Requirements

### Requirement: Agent sessions settings configure default and phase models
The Agent sessions section in Settings SHALL provide controls to manage global and profile model configuration:
1. A global **Default model** field located under the Agent sessions general controls, allowing users to enter a default model name applied to all profiles that do not override it.
2. Inside each agent profile card, a **Model** field allowing the user to specify a profile-level default model or leave it blank to inherit the global default model. An indicator or placeholder text SHALL show which model is inherited when the field is empty.
3. An expandable or collapsible **Phase models** sub-panel per agent profile, exposing input fields for each starter phase (`Draft`, `Implement`, `Validate`, and `Archive`). When a phase field is empty, it SHALL indicate inheritance from the profile model (or global default model).

All model fields SHALL support live editing, preserving typed input and validating against whitespace, control characters, and permission-bypass flags upon save.

#### Scenario: Global default model configuration
- **WHEN** the user opens Settings → Agent sessions
- **THEN** a Default model input is present before the agent profiles list, and entering a value sets `agentSessions.defaultModel` upon save

#### Scenario: Profile model inheritance indicator
- **WHEN** the global default model is set to `claude-3-5-sonnet` and an agent profile's Model field is empty
- **THEN** the profile's Model input placeholder or hint indicates that `claude-3-5-sonnet` is inherited from the global default

#### Scenario: Configuring a phase-specific model override
- **WHEN** the user expands Phase models on profile `claude` and enters `claude-3-opus` into the `Draft` field and saves
- **THEN** the saved profile configuration records `claude-3-opus` under `phaseModels.draft`

#### Scenario: Clearing a phase model override restores inheritance
- **WHEN** a profile has `phaseModels.draft` set to `claude-3-opus` and the user clears the Draft field and saves
- **THEN** `phaseModels.draft` is removed and subsequent draft sessions inherit the profile or global default model
