## MODIFIED Requirements

### Requirement: The console is a tab of the detail view
Whenever agent sessions apply to the change's repository — agent sessions on and the repository not excluded — the
detail view SHALL offer a **Console** tab beside the artifact tabs, after them, as the last tab of the strip, whether or
not the change has ever had a session. The tab SHALL be selectable whenever it is offered, whatever state the change's
artifacts are in, and MUST NOT carry an artifact state label.

Selecting it SHALL show the selected session's terminal — what the agent printed, as it printed it, with what the
terminal has shown so far before it follows live — together with the session's change, repository, agent, worktree path
and branch, its state, its default responses and its actions: End session or Clean up, Resume when available, Delete
record for an ended session, "Copy cd" for the worktree and **Open in editor** (`editor-launch`) for the folder the
session's agent works in. The terminal SHALL be coloured from the dashboard's theme
tokens and SHALL load nothing from the network. It SHALL follow the size of the panel, and SHALL be the part of the
overlay that scrolls, so the page behind it does not move.

With no session to show the tab SHALL say why and leave the user something to do: for a change whose session worktree
has outlived its session record, that there is no terminal to show while its work is still there, with the worktree's
path, a `cd` to copy and **Open in editor** for that worktree; for a change that has neither a session nor a session worktree, that no agent has worked on it
yet, together with the starters its stage allows. Neither state SHALL show a terminal, and neither MUST be reported as
an error.

When agent sessions are off for the repository, or the repository is excluded from them, no Console tab SHALL be shown
and the detail view MUST look and behave as it did before.

#### Scenario: A change with a session
- **WHEN** the user opens the detail view of a change whose Implement session is running
- **THEN** the tab strip shows `Proposal`, `Design`, `Specs`, `Tasks` and `Console`, and selecting `Console` shows that
  session's terminal with its earlier output, its worktree path and branch, and its actions, **Open in editor** among
  them

#### Scenario: Console is selectable while artifacts are not
- **WHEN** a change has a running session and no artifact file at all
- **THEN** every artifact tab is unselectable and the `Console` tab is selectable and shows the terminal

#### Scenario: A change no agent has worked on
- **WHEN** the user opens the Console tab of a change in `Ready` that has neither a session nor a session worktree
- **THEN** the tab says that no agent has worked on this change yet, offers **Implement**, shows no terminal and reports
  no error

#### Scenario: Starting from the empty console
- **WHEN** the user activates that **Implement** starter
- **THEN** a session starts for the change and the same Console tab shows its terminal

#### Scenario: A worktree without a session record
- **WHEN** the change's session record is gone and its worktree still holds uncommitted work
- **THEN** the Console tab says there is no terminal to show, names the worktree's path, offers a `cd` to copy and offers
  **Open in editor** for that worktree

#### Scenario: Feature off
- **WHEN** agent sessions are disabled
- **THEN** no detail view shows a `Console` tab

#### Scenario: Long output scrolls in the terminal
- **WHEN** the agent has printed more than fits the panel
- **THEN** the output scrolls inside the terminal and the board behind the overlay does not move
