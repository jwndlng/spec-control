## ADDED Requirements

### Requirement: The end-session dialog stays until its confirmation has finished
While the end-session dialog carries out a confirmation — ending the session, removing its worktree, cleaning up
leftovers or pulling — Escape SHALL do nothing and **Cancel** SHALL be disabled, so that the dialog cannot be closed
while work it started is still running and its report is never lost. Escape SHALL close only the end-session dialog,
never a view behind it such as the change detail view. A confirmation SHALL report only into the dialog of the session
it was started for: when that dialog is no longer the open one, its outcome SHALL NOT change, report into or close the
dialog now open for another session.

#### Scenario: Escape while the end runs
- **WHEN** the user confirms ending a session with **Pull** selected and presses Escape while the pull runs
- **THEN** the dialog stays open, and when the pull is refused over change leftovers it shows that report with
  **Resolve and pull**

#### Scenario: Cancel while busy
- **WHEN** a confirmation is in progress
- **THEN** Cancel is disabled and nothing closes the dialog until the confirmation has finished

#### Scenario: Escape over the change detail view
- **WHEN** the end-session dialog is open over the change detail view of `rotate-keys` and the user presses Escape
  before confirming
- **THEN** the dialog closes, nothing is ended, and the change detail view stays open

#### Scenario: Another session's dialog
- **WHEN** a confirmation for the session of `rotate-keys` is still running and the end-session dialog of the session of
  `add-login` is opened
- **THEN** the outcome of the `rotate-keys` confirmation neither appears in nor closes the `add-login` dialog

### Requirement: A session panel action is sent once per activation
While one of the session panel's header actions — **Ship**, **Resolve conflicts**, **Merge**, **Resume** or **Delete
record** — is in flight, all of them SHALL be disabled, and a further activation SHALL send no request, so that a
double-click sends one request. The panel SHALL enable them again once the request has finished, whether it succeeded
or failed. This is independent of the server refusing a second concurrent start of the same session.

#### Scenario: Double-click on Ship
- **WHEN** the user double-clicks **Ship** on an ended session of `rotate-keys`
- **THEN** one Ship request is sent and one agent is started in its worktree

#### Scenario: Failed request
- **WHEN** a Resume request fails
- **THEN** the panel shows the error and its actions are enabled again
