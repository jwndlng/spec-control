# Spec Delta

## ADDED Requirements

### Requirement: A change offers a custom session without a prompt
The dashboard SHALL offer the starter **Custom session** (`custom`) for any active change (not archived), regardless of its stage, sub-state or dependencies. It SHALL run the change's agent inside the change's git worktree (or in place for repositories that run change sessions in place) without a shell, from the agent profile's command argument list with every argument that contains `{prompt}` left out, and with no text typed into it on start-up. Unlike prompt-driven starters, Custom session SHALL NOT require any prompt to be configured on the agent profile, and a profile without prompts SHALL still be able to start a custom session. Being blocked by dependencies SHALL NOT withhold Custom session. Opening a custom session for a change that already has a running session SHALL return that running session without sending anything to its terminal. When the agent executable cannot be found, opening Custom session SHALL be refused with that reason, which names that agent, and on cards and in the change detail view the starter SHALL be disabled with that explanation.

#### Scenario: Custom session on a backlog change
- **WHEN** agent sessions are enabled and a change `first-feature` in `Backlog` has no running session
- **THEN** Custom session is offered for it, and starting it launches the change's agent in its worktree without an opening prompt and with no text typed into its terminal

#### Scenario: Custom session on a blocked change
- **WHEN** change `second-feature` in `Ready` is blocked by its dependencies
- **THEN** Custom session is offered for it, and starting it opens a session in its worktree

#### Scenario: Custom session on a change with a running session
- **WHEN** a session is already running for change `cloud-deployment` and the user starts Custom session for `cloud-deployment`
- **THEN** the existing running session is returned, no new process is started, and nothing is typed into the terminal

#### Scenario: Agent without prompt configuration
- **WHEN** an agent profile has no opening prompts configured at all, but its executable is found
- **THEN** Custom session is offered for changes using that agent and can be started successfully

#### Scenario: Agent executable missing
- **WHEN** the change's agent executable cannot be found
- **THEN** the Custom session starter is disabled, and an attempt to start it is refused with a reason naming the missing agent
