# Spec Delta

## ADDED Requirements

### Requirement: Permission profiles configuration and effective permissions endpoint
The API SHALL support querying and validating agent permission configurations:
1. `GET /api/config` and `PUT /api/config` SHALL support `agentSessions.defaultPermissionProfile` (one of `"minimum"`, `"less-friction"`, `"full-automation"`), `agentSessions.optInMerge` (boolean), and `agentSessions.optInCleanup` (boolean). Invalid profile values or bypass flags in the configuration SHALL be rejected with `400`.
2. The API SHALL provide `GET /api/repos/:id/agent-permissions` with optional `?change=<name>&agent=<agentId>` returning:
   - `effectiveProfile`: the resolved profile identifier;
   - `effectivePolicy`: the resolved abstract policy settings;
   - `agentPreview`: a map of agent identifiers to their resolved CLI arguments and ephemeral settings;
   - `protectedCommands`: a list of command patterns that always require interactive confirmation;
   - `limitations`: runtime-specific constraint notices;
   - `securityNotice`: the standard code execution risk disclosure.
   The endpoint SHALL return `404` for an unknown repository or change, and `403` when agent sessions are disabled.

#### Scenario: Query effective permissions for a repository
- **WHEN** `GET /api/repos/repo-1/agent-permissions` is requested
- **THEN** the response is `200` with JSON containing `effectiveProfile`, `effectivePolicy`, and `agentPreview` for configured agents

#### Scenario: Reject invalid permission profile in config update
- **WHEN** `PUT /api/config` is called with `agentSessions.defaultPermissionProfile: "unrestricted"`
- **THEN** the response is `400` naming `agentSessions.defaultPermissionProfile` and the config is unchanged

#### Scenario: Unknown repository returns 404
- **WHEN** `GET /api/repos/unknown-repo/agent-permissions` is requested
- **THEN** the response is `404` with `{ "error": "repository not found" }`

### Requirement: Change permission profile override endpoint
The API SHALL provide `POST /api/repos/:id/changes/:change/permission-profile` with `{ "permissionProfile": "<profile>" | null }` to set or clear a change-level permission profile override:
1. Valid values for `permissionProfile` SHALL be `"minimum"`, `"less-friction"`, `"full-automation"`, or `null` (to inherit the repository or global default).
2. The endpoint MUST be refused with `400` for an invalid profile identifier, malformed JSON, or an invalid change name.
3. The endpoint MUST be refused with `404` for an unknown repository or an archived change.
4. The endpoint MUST be refused with `403` when agent sessions are disabled or when sent from a different origin.
5. Setting or clearing an override SHALL persist the change in `config.yaml` without triggering a repository scan or restarting running sessions.

#### Scenario: Set change permission override
- **WHEN** `POST /api/repos/repo-1/changes/fix-bug/permission-profile` is sent with `{ "permissionProfile": "less-friction" }`
- **THEN** the response is `200` and subsequent sessions for `fix-bug` resolve to `less-friction`

#### Scenario: Clear change permission override
- **WHEN** `POST /api/repos/repo-1/changes/fix-bug/permission-profile` is sent with `{ "permissionProfile": null }`
- **THEN** the response is `200` and subsequent sessions for `fix-bug` inherit the repository or global default profile

#### Scenario: Reject invalid override value
- **WHEN** `POST /api/repos/repo-1/changes/fix-bug/permission-profile` is sent with `{ "permissionProfile": "bypass" }`
- **THEN** the response is `400` and the stored configuration remains unchanged
