## MODIFIED Requirements

### Requirement: The console tab offers the change's next step
The Console tab SHALL be the place the dashboard offers a change's next step while its session runs. For the selected
session it SHALL offer the starters of the change's current stage whose prompt would go into that very session — Draft
and Implement for a session in the change's own worktree — labelled and described as sending the prompt to the running
session, and MUST NOT ask the user for a further key press. When the prompt was typed but not submitted, the tab SHALL
say so as it does for any other text sent on the user's behalf. Archive SHALL open its own session as before, and no
starter SHALL be offered for a session that a prompt cannot reach.

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
