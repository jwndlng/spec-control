# Spec Delta

## MODIFIED Requirements

### Requirement: One change permission profile control across detail tabs
For an active change with agent sessions enabled, the Console tab SHALL show exactly one control labelled "Permission profile for this change", beside the change's agent picker. Artifact tabs SHALL NOT show this control. Switching away from and back to Console SHALL retain the saved selection. Archived changes, changes absent from the snapshot, and views with agent sessions disabled SHALL show no change permission selector.

#### Scenario: Switching between artifacts and Console
- **WHEN** the user opens an active change, switches between an artifact tab and Console, and changes the permission profile in Console
- **THEN** only Console shows the single permission control beside the agent picker, and switching back to Console shows the saved selection

#### Scenario: No existing session
- **WHEN** an active change has no session or worktree and agent sessions are enabled
- **THEN** its Console tab still offers the single permission control

#### Scenario: Ineligible detail view
- **WHEN** the change is archived, absent from the snapshot, or agent sessions are disabled
- **THEN** no change permission selector is shown, including in an available Console tab
