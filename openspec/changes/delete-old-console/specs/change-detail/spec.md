# Spec Delta

## MODIFIED Requirements

### Requirement: The console tab selects among the change's sessions
A change MAY have more than one session record — at most one of them running (`agent-sessions`: "Session lifecycle and
control"), the others ended, their output still readable and their worktrees possibly still holding work. When it has more than one, the Console tab SHALL list them with their action, branch and live
state, most recent first, and show the selected one; with a single session the list MAY be omitted. The most recently
active session SHALL be selected by default.

Each ended session in the list SHALL offer a removal control ("X") to delete that session's record. A running session MUST NOT offer a removal control. Activating the removal control SHALL delete the session's record and stored output via session deletion. When the removed session was selected, the Console tab SHALL fall back to the most recently active remaining session. When removing a session leaves only one session, the session list MAY be omitted.

The selected session SHALL be part of the URL, so the console can be linked to and survives a reload, alongside the
selected tab. A URL naming a session the change does not have SHALL fall back to the default selection without an
error. Typing, default responses and next-step prompts MUST reach only the selected session.

#### Scenario: Two sessions
- **WHEN** a change has an ended Draft session on `docs/rotate-keys` and a running Implement session on `feat/rotate-keys`
- **THEN** the Console tab lists both with their branch and state, shows the more recently active one, and only the
  running one offers next steps

#### Scenario: Selection is linkable
- **WHEN** the user selects the Console tab and its second session and reloads the page
- **THEN** the same tab and the same session are shown again, with that session's earlier output

#### Scenario: Stale session in the URL
- **WHEN** a URL names a session id the change does not have
- **THEN** the Console tab opens on the change's most recently active session and no error is reported

#### Scenario: Input reaches only the selected session
- **WHEN** the change has two sessions and the user activates a default response
- **THEN** only the selected session's terminal receives it

#### Scenario: Removing an ended session from the list
- **WHEN** the change has multiple sessions and the user activates the removal control ("X") on an ended session
- **THEN** the session's record and stored output are deleted, and it is removed from the session list

#### Scenario: Running session has no removal control
- **WHEN** the change has multiple sessions and one session is running
- **THEN** the running session's entry in the list shows no removal control ("X")

#### Scenario: Removing the selected session falls back to the most recent
- **WHEN** the user activates the removal control on the currently selected ended session
- **THEN** that session is deleted and the Console tab selects the change's most recently active remaining session
