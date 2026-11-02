# Spec Delta

## ADDED Requirements

### Requirement: The console tab chooses the change's agent
When more than one agent profile is configured, the Console tab SHALL offer an **Agent** picker for the change, listing
"Project agent" with the name of the repository's agent, followed by every configured profile by name, and showing the
change's current choice. Choosing a profile SHALL set the change's agent override and choosing "Project agent" SHALL
clear it (`dashboard-api`: "A change's agent override is set through the API"); the starters the tab offers and their
availability SHALL follow the change's agent at once. When the selected session is running with a profile other than
the change's agent, the tab SHALL say which agent that session runs and that the change's next session starts the
chosen one. When the request is refused the picker SHALL show the previous choice again and say why. With a single
profile configured the picker SHALL NOT be shown. The picker SHALL NOT be shown for an archived change, or where the
Console tab is not shown.

#### Scenario: Choosing another agent
- **WHEN** profiles `claude` (the project's agent) and `codex` are configured and the user picks Codex in the Console tab of `rotate-keys`
- **THEN** the override is saved, the picker shows Codex, and the tab's Implement starts `codex`

#### Scenario: Back to the project's agent
- **WHEN** the user picks "Project agent (Claude Code)" for `rotate-keys`
- **THEN** the override is cleared and the change's next session starts the project's agent

#### Scenario: A running session on another agent
- **WHEN** a `claude` session of `rotate-keys` is running and the user picks Codex
- **THEN** the session keeps running, and the tab says it runs Claude Code and that the next session starts Codex

#### Scenario: One profile only
- **WHEN** only one agent profile is configured
- **THEN** the Console tab shows no Agent picker
