## MODIFIED Requirements

### Requirement: Agent sessions are off until enabled, then apply to every tracked repository
Agent sessions SHALL be available only when the global `agentSessions.enabled` setting is true. That switch SHALL be in the Agent sessions section of Settings. Once it is on, agent sessions apply to every tracked (enabled) repository by default. A repository MAY be excluded individually, and MAY be given an agent profile other than the default, with that repository's agent-session toggle and agent picker on the projects overview, which take effect at once. The Agent sessions section of Settings SHALL also hold the editor command of the `editor-launch` capability. It SHALL NOT list repositories; it SHALL say that agent sessions are switched on or off per project on the projects overview, and link there. An excluded or untracked repository MUST NOT show session starters and MUST be refused by the API. A fresh or migrated configuration MUST have the feature disabled. A repository entry without agent settings counts as included.

#### Scenario: Default configuration
- **WHEN** the dashboard starts with a configuration that predates this feature
- **THEN** agent sessions are disabled and no card shows a session starter

#### Scenario: One switch enables all tracked repositories
- **WHEN** the user turns agent sessions on and has not changed any per-repository setting
- **THEN** cards of every tracked repository offer the starters their stage and agent allow, and every project's toggle on the overview reads Enabled

#### Scenario: Repository switched off
- **WHEN** agent sessions are enabled and the user switches `alpha-infra` to Disabled on the projects overview
- **THEN** cards of `alpha-infra` show no session starter and opening a session for it is refused, while other repositories are unaffected

#### Scenario: Settings points to the overview
- **WHEN** the user opens the Agent sessions section of Settings
- **THEN** it has the global switch, the agent profiles, the shortcuts, the console folder and the editor command, lists no repository, and links to the projects overview for per-project settings
