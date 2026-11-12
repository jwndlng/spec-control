## REMOVED Requirements

### Requirement: Only an active change in the main checkout can be dismissed
**Reason**: Dismissal becomes a durable, reversible board action rather than directory deletion.
**Migration**: Use durable dismissal below. Retain the former deletion safeguards for a separately labeled Delete change files action; do not infer dismissal records from past deletions.

### Requirement: The confirmation shows what would be lost
**Reason**: Dismissal becomes a durable, reversible board action rather than directory deletion.
**Migration**: Use durable dismissal below. Retain the former deletion safeguards for a separately labeled Delete change files action; do not infer dismissal records from past deletions.

### Requirement: Confirming deletes the change directory and stages its removal
**Reason**: Dismissal becomes a durable, reversible board action rather than directory deletion.
**Migration**: Use durable dismissal below. Retain the former deletion safeguards for a separately labeled Delete change files action; do not infer dismissal records from past deletions.

### Requirement: Confirmation is re-checked, never trusted
**Reason**: Dismissal becomes a durable, reversible board action rather than directory deletion.
**Migration**: Use durable dismissal below. Retain the former deletion safeguards for a separately labeled Delete change files action; do not infer dismissal records from past deletions.

### Requirement: Dismissal never reaches beyond the change directory
**Reason**: Dismissal becomes a durable, reversible board action rather than directory deletion.
**Migration**: Use durable dismissal below. Retain the former deletion safeguards for a separately labeled Delete change files action; do not infer dismissal records from past deletions.

### Requirement: Dismissal reaches the change directory through real directories only
**Reason**: Dismissal becomes a durable, reversible board action rather than directory deletion.
**Migration**: Use durable dismissal below. Retain the former deletion safeguards for a separately labeled Delete change files action; do not infer dismissal records from past deletions.

## ADDED Requirements

### Requirement: Dismissal applies to a logical active change
Dismiss change SHALL persist a dismissal record in the dashboard home for an active change identity in a configured enabled successfully scanned project. It SHALL support main-checkout and worktree-only changes, with or without git and regardless of agent-session enablement. Dismissal SHALL hide all copies of that identity from the default board without changing files, git, session records, or running agents.

#### Scenario: Worktree-only change
- **WHEN** an active change exists only in a linked worktree and the user dismisses it
- **THEN** the card disappears from the default board and all worktree files and processes remain intact

#### Scenario: Running agent
- **WHEN** the user dismisses a change whose agent is running
- **THEN** confirmation states the agent will continue, the board hides the change, and Open work still exposes the running session

### Requirement: Dismissal is reversible and scoped to an incarnation
The dashboard SHALL confirm that dismissal hides the change and preserves its work, then save a durable project-and-change identity record. Dismissed changes SHALL have a discoverable Restore action. A verified new change reusing the name with a later creation identity SHALL NOT inherit dismissal. Unknown creation identity SHALL use a stable local incarnation token and remain restorable rather than guessing that edits create a new change.

#### Scenario: Restart and restoration
- **WHEN** a dismissed change is rescanned after restart and the user chooses Restore
- **THEN** its dismissal record is removed and the card returns with its actual current progress

#### Scenario: Name reused
- **WHEN** a new change reuses a dismissed name with a distinct later creation identity
- **THEN** the new change is visible by default

#### Scenario: Other repository
- **WHEN** another repository has a change with the same name
- **THEN** its visibility is unaffected

### Requirement: File deletion is a separate explicit action
A Delete change files action SHALL retain the former main-checkout-only deletion contract: preview each file's recoverability, recheck content fingerprint and real path segments, refuse running sessions and concurrent deletion, delete only the named change directory, and stage only that removal best-effort. It SHALL state that linked copies are preserved and SHALL NOT claim to dismiss the logical change. No branch, worktree, or remote SHALL be modified.

#### Scenario: Delete files without dismissing
- **WHEN** the user confirms Delete change files while an ended linked worktree contains another copy
- **THEN** only the main checkout's confirmed directory is removed and its removal staged, and the remaining card is not represented as dismissed

#### Scenario: Changed files or symbolic link
- **WHEN** content changes after preview or a path segment becomes a symbolic link
- **THEN** deletion is refused before any file or index change
