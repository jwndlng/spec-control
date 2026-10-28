# Spec Delta

## MODIFIED Requirements

### Requirement: The end-session dialog stays until its confirmation has finished
While the end-session dialog carries out a confirmation that only ends the session, Escape SHALL do nothing and **Cancel** SHALL be disabled until that confirmation finishes. When a confirmation also starts worktree cleanup, the dashboard SHALL end the session and close the dialog without waiting for cleanup to finish, so the user can continue using the dashboard. It SHALL report the cleanup outcome after completion in a way that does not require the end-session dialog to remain open. A cleanup outcome SHALL NOT change, report into or close a dialog open for another session. Escape SHALL close only the end-session dialog, never a view behind it such as the change detail view. A confirmation SHALL report only into the dialog of the session it was started for while that dialog remains open.

#### Scenario: Escape while the end runs
- **WHEN** the user confirms ending a session without worktree cleanup and presses Escape while the end runs
- **THEN** the dialog stays open until the session has ended

#### Scenario: Continue while worktree cleanup runs
- **WHEN** the user confirms ending a session with worktree cleanup and ending the session succeeds
- **THEN** the dialog closes without waiting for worktree cleanup, and the user can continue using the dashboard while cleanup runs

#### Scenario: Cleanup outcome is reported
- **WHEN** worktree cleanup completes after its end-session dialog has closed
- **THEN** the dashboard reports whether cleanup succeeded or failed and any relevant reason, without reopening the dialog

#### Scenario: Cleanup completes while another session's dialog is open
- **WHEN** cleanup for the session of `rotate-keys` completes while the end-session dialog of `add-login` is open
- **THEN** the cleanup outcome is reported without appearing in, changing or closing the `add-login` dialog

#### Scenario: Cancel while busy
- **WHEN** the session-ending confirmation is still in progress
- **THEN** Cancel is disabled and nothing closes the dialog until session ending has finished

#### Scenario: Escape over the change detail view
- **WHEN** the end-session dialog is open over the change detail view of `rotate-keys` and the user presses Escape before confirming
- **THEN** the dialog closes, nothing is ended, and the change detail view stays open

#### Scenario: Another session's dialog
- **WHEN** cleanup for the session of `rotate-keys` is still running and the end-session dialog of the session of `add-login` is opened
- **THEN** the outcome of the `rotate-keys` cleanup neither appears in nor closes the `add-login` dialog
