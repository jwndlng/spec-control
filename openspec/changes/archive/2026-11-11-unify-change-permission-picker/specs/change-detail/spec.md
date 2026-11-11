# Spec Delta

## ADDED Requirements

### Requirement: One change permission profile control across detail tabs
For an active change with agent sessions enabled, the detail view SHALL show exactly one control labelled "Permission profile for this change", accessible across artifact and Console tabs. Switching tabs SHALL retain the saved selection. The embedded Console SHALL NOT render a second permission selector. Archived changes, changes absent from the snapshot, and views with agent sessions disabled SHALL show no change permission selector.

#### Scenario: Switching between artifacts and Console
- **WHEN** the user opens an active change and switches from its proposal to Console and back
- **THEN** each tab shows the same single change permission control and saved selection

#### Scenario: No existing session
- **WHEN** an active change has no session or worktree and agent sessions are enabled
- **THEN** its detail view still offers the single permission control

#### Scenario: Ineligible detail view
- **WHEN** the change is archived, absent from the snapshot, or agent sessions are disabled
- **THEN** no change permission selector is shown, including in an available Console tab

### Requirement: The change permission control explains inheritance and scope
The control SHALL offer "Inherit from project" with the resolved inherited profile, plus Minimum, Less friction and Full automation. Inheritance SHALL resolve the project setting, then the global default, then Minimum. Choosing a concrete profile SHALL save only the change override; choosing inheritance SHALL clear it. The control SHALL explain that it applies to this change and takes effect on the next session start.

#### Scenario: Project profile is inherited
- **WHEN** the project sets Less friction and the change has no override
- **THEN** the control selects "Inherit from project" and identifies Less friction as the inherited profile

#### Scenario: Global and built-in defaults
- **WHEN** the project has no permission profile and the change has no override
- **THEN** the inheritance option identifies the global default, or Minimum when no global default is configured

#### Scenario: Setting and clearing an override
- **WHEN** the user selects Full automation and later selects "Inherit from project"
- **THEN** only this change's override is first set and then cleared, leaving project and global settings unchanged

#### Scenario: Explicit choice equals inherited profile
- **WHEN** the user explicitly selects Minimum while the inherited profile is also Minimum
- **THEN** the control shows the explicit Minimum choice rather than claiming the change inherits

### Requirement: Change permission saves provide reliable feedback
While a permission save is pending, the control SHALL prevent duplicate submissions and show saving feedback. Success SHALL update the saved selection and announce completion. Failure SHALL show the previous saved selection and an accessible error with the refusal reason, permitting retry. Feedback SHALL belong to the change being edited and SHALL NOT appear on a different change after navigation.

#### Scenario: Successful save
- **WHEN** the user chooses Less friction and the save succeeds
- **THEN** the control shows saving feedback while pending, then the saved Less friction selection and completion feedback

#### Scenario: Refused save
- **WHEN** the user chooses Full automation but the save is refused
- **THEN** the previous saved selection remains, an accessible error explains the refusal, and the user can retry

#### Scenario: Navigation during a save
- **WHEN** a save for one change finishes after the user opens another change
- **THEN** its completion or error is not shown as feedback for the newly opened change

### Requirement: A running session's permission profile remains explicit
When the running change session's recorded permission profile differs from the change's resolved selection, the detail view SHALL identify both profiles and explain that the selection applies on the next session start. Saving SHALL NOT restart or modify the running session. The notice SHALL use recorded session data, never terminal output, and SHALL NOT claim an active profile when none was recorded.

#### Scenario: Different profile is saved while running
- **WHEN** a session is running with Minimum and the change's saved effective profile becomes Less friction
- **THEN** the view says the running session uses Minimum and the next session start uses Less friction, leaving the session running unchanged

#### Scenario: Inherited setting changes
- **WHEN** a change inherits its profile and a project or global update makes it differ from the running session's recorded profile
- **THEN** the view updates the inherited selection and the running-session explanation without restarting the session

#### Scenario: Profiles match or no session runs
- **WHEN** the running session's recorded profile matches the resolved selection, or no session is running
- **THEN** no differing-profile notice is shown

#### Scenario: Legacy session without a recorded profile
- **WHEN** the running session has no recorded permission profile
- **THEN** the view does not infer its active profile from current settings or terminal output
