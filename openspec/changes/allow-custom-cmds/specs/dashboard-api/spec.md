# Spec Delta

## ADDED Requirements

### Requirement: Project command allowances are saved through existing configuration routes
`GET /api/config` and `PUT /api/config` SHALL support optional `repo.agent.allowedCommands` as an array of command-prefix strings. `POST /api/repos/:id/agent` SHALL accept `allowedCommands` as a replacement array or `null` to clear it. An omitted patch key SHALL retain the list; an empty array or `null` SHALL remove it. Saving SHALL preserve unrelated settings, write only home configuration, and trigger neither a scan nor an agent restart.

#### Scenario: Replace and clear a project's list
- **WHEN** the project agent endpoint receives `{ "allowedCommands": ["bun run lint"] }`
- **THEN** the response is `200`, the returned configuration contains that project's normalized list and unrelated project settings are unchanged
- **WHEN** it subsequently receives `{ "allowedCommands": null }` or `{ "allowedCommands": [] }`
- **THEN** the key is absent from the saved project agent settings

#### Scenario: Unrelated patch preserves commands
- **WHEN** a project's agent endpoint receives `{ "agentId": "codex" }` and that project has saved commands
- **THEN** the agent selection changes and the command list remains unchanged

#### Scenario: Existing configurations remain valid
- **WHEN** configuration without any `allowedCommands` key is loaded and saved
- **THEN** it remains valid and no custom allowance is introduced

### Requirement: Command allowance updates share validation and request guards
Both configuration update routes SHALL enforce the command-prefix syntax, bounds and restrictions of `agent-sessions`. Invalid updates SHALL return `400` naming the field or entry, leaving stored configuration unchanged. The project endpoint SHALL retain its unknown-repository `404` behavior. Mutations SHALL retain loopback-host and same-origin guards; saving commands SHALL start no external process and write no tracked repository file.

#### Scenario: Reject invalid list atomically
- **WHEN** either update route receives a non-array value, a non-string entry, a protected prefix or shell syntax in `allowedCommands`
- **THEN** it returns `400` identifying `allowedCommands` and the stored configuration remains unchanged, including other fields in the same update

#### Scenario: Refuse a cross-origin update
- **WHEN** an external origin posts a valid command list to the project endpoint
- **THEN** the response is `403` and the configuration is unchanged

#### Scenario: Unknown project
- **WHEN** a valid command list is posted for an unknown repository
- **THEN** the response is `404` and no configuration is written

### Requirement: Effective permission preview explains project command application
`GET /api/repos/:id/agent-permissions` SHALL include normalized project commands in `effectivePolicy.allowedCommands`. Its existing `agentPreview` and `limitations` SHALL distinguish applied allowances from configured entries that are inactive under `minimum` or unsupported by the runtime. Change and agent filters SHALL use the same project list and effective profile as launch. Existing response fields and refusal behavior SHALL be preserved.

#### Scenario: Preview matches launch
- **WHEN** a project allows `bun run lint` and effective permissions are queried for a `less-friction` Claude change
- **THEN** the policy contains that command, and the preview shows the additional permission arguments that the next launch will receive

#### Scenario: Configured commands are visible even when not applied
- **WHEN** custom commands are queried under `minimum` or for a runtime without session allowlist support
- **THEN** the policy lists the saved entries and the runtime limitations explain why they will not be applied
