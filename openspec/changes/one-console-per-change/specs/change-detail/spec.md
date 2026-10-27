## MODIFIED Requirements

### Requirement: The console tab offers the change's next step
The Console tab SHALL be the place the dashboard offers a change's next step while its session runs. For the selected
session it SHALL offer the starters of the change's current stage whose prompt would go into that very session — Draft
and Implement for a session in the change's own worktree — labelled and described as sending the prompt to the running
session, and MUST NOT ask the user for a further key press. When the prompt was typed but not submitted, the tab SHALL
say so as it does for any other text sent on the user's behalf. Archive SHALL open its own session as before, and no
starter SHALL be offered for a session that a prompt cannot reach.

For a running **Draft artifacts** session on `docs/<change>` the tab SHALL offer Draft as sent into that session and
every other starter the stage allows but Fast-forward as **ending the proposal session and starting** that action —
labelled and described so, never as sending the prompt to this session — so the tab always offers the change's next
step. Activating one SHALL open the action asking to end the proposal session first (`agent-sessions`: "The proposal
session gives way to the next step") and then show the new session. When the proposal worktree's work status is
`uncommitted` or `unpushed`, it SHALL first ask one confirmation saying that the proposal is not pushed yet and that its
worktree and branch are kept; for any other work status it SHALL ask nothing, since ending it loses nothing.

For a change with no session and no session worktree the tab SHALL offer the starters its stage allows as openings for
a new session, disabled with an explanation when the repository's agent is not found on this machine.

In both cases the tab SHALL offer its starters as the same split button a card shows (`kanban-board`: "A change's
actions are one split button"), with the same recommended action and the same menu, limited to the starters a prompt
can reach where a session runs. A **Draft artifacts** item offered in `Ready` SHALL say that it writes the artifacts
not required for implementing, such as a design.

#### Scenario: Draft finished, Implement next
- **WHEN** a Draft session is still running, the change has moved to `Ready`, and its Console tab is open
- **THEN** the tab offers **Implement**, saying it sends the prompt to this session, and activating it types that prompt
  into the terminal without asking the user for another key press

#### Scenario: Proposal finished, Implement next
- **WHEN** the Draft session of `rotate-keys` runs on `docs/rotate-keys`, its proposal is pushed, the change has moved to
  `Ready`, and its Console tab is open
- **THEN** the split button shows **Implement**, described as ending the proposal session and starting Implement;
  activating it asks nothing, ends that session, starts Implement on `feat/rotate-keys` and shows it in the tab

#### Scenario: Proposal not pushed yet
- **WHEN** the same holds but the `docs-rotate-keys` worktree has uncommitted files
- **THEN** activating **Implement** first asks for confirmation, saying the proposal is not pushed and its worktree is kept,
  and cancelling ends nothing

#### Scenario: The prompt was not sent
- **WHEN** the next step is sent to a session whose agent never shows the typed prompt
- **THEN** the Console tab says that the text was typed but not sent, and the session keeps running

#### Scenario: Nothing a prompt can reach
- **WHEN** the selected session is the change's Archive session
- **THEN** the tab offers no next-step starter for it

#### Scenario: The agent is missing
- **WHEN** a change has no session and the repository's agent executable is not found
- **THEN** the Console tab's starters are disabled and say that the agent was not found

#### Scenario: Drafting a design for a ready change
- **WHEN** a change is in `Ready`, its optional `design.md` is not written, and it has no session
- **THEN** its Console tab's split button shows **Implement**, and its menu offers **Draft artifacts**, described as writing the artifacts not required for implementing

#### Scenario: Waiting pull request keeps the menu
- **WHEN** a change in `Implementing` links an open pull request whose checks are running and it has no running session
- **THEN** its Console tab's main part says it waits for the checks, and its menu offers **Implement**


### Requirement: The console tab selects among the change's sessions
A change MAY have more than one session record — at most one of them running (`agent-sessions`: "Session lifecycle and
control"), the others ended, their output still readable and their worktrees possibly still holding work. When it has more than one, the Console tab SHALL list them with their action, branch and live
state, most recent first, and show the selected one; with a single session the list MAY be omitted. The most recently
active session SHALL be selected by default.

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

