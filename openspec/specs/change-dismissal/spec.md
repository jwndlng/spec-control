# change-dismissal Specification

## Purpose
Lets the user dismiss an active change they do not want to proceed with: erase its directory from the repository's main
checkout on an explicit, informed confirmation, without touching anything else in the repository.

## Requirements

### Requirement: Only an active change in the main checkout can be dismissed
A change SHALL be dismissable when it is not archived and a directory `openspec/changes/<name>/` exists in the main
checkout of a repository that is configured, enabled and whose last scan succeeded. The change name MUST match the
validated change-name pattern and MUST NOT be `archive`. The directory MUST be a real directory, not a symbolic link,
and MUST resolve to a path inside the main checkout's `openspec/changes/`. An archived change, a change whose directory
exists only in a linked worktree, and a change of an unknown, disabled or failed repository MUST NOT be dismissed.
Repositories with and without git SHALL both be supported.

#### Scenario: Change in the main checkout
- **WHEN** `lint-rules` of repository `demo-ops` is in `Drafts` and `openspec/changes/lint-rules/` exists in its main checkout
- **THEN** the change can be dismissed

#### Scenario: Archived change
- **WHEN** the user tries to dismiss `audit-trail`, which exists only under `openspec/changes/archive/`
- **THEN** the dismissal is refused and nothing is deleted

#### Scenario: Change only in a linked worktree
- **WHEN** `cloud-deployment` exists in a linked worktree on `feat/cloud-deployment` but not in the main checkout
- **THEN** the dismissal is refused with the reason that the change lives only in that worktree, and nothing is deleted

#### Scenario: Symbolic link
- **WHEN** `openspec/changes/lint-rules` in the main checkout is a symbolic link to a directory elsewhere
- **THEN** the dismissal is refused and neither the link nor its target is deleted

#### Scenario: Repository without git
- **WHEN** a change is dismissed in a tracked folder that is not a git repository
- **THEN** its directory is deleted and no git command is run

### Requirement: The confirmation shows what would be lost
Before anything is deleted, the dashboard SHALL show a confirmation that names the change and the repository and lists
every file in the change's directory, each marked as either restorable from git — tracked and identical to `HEAD` — or
lost for good — untracked, or with changes not in `HEAD`, or in a repository without git. When any file would be lost
for good, the confirmation SHALL say so above the list. It SHALL list every linked worktree that holds its own copy of
the change by path and branch, stating that those copies are kept and that the change stays on the board while one of
them holds it. It SHALL state that nothing is committed and, in a git repository, that the removal is staged. Computing
what the confirmation shows MUST NOT write anything. The confirmation's initial focus SHALL be on Cancel, and its
destructive control SHALL read **Dismiss change**.

#### Scenario: Committed change
- **WHEN** the confirmation is opened for a change whose three files are committed and unmodified
- **THEN** all three are listed as restorable from git and no loss warning is shown

#### Scenario: Uncommitted work
- **WHEN** the change's `design.md` has uncommitted edits and its `tasks.md` is untracked
- **THEN** both are listed as lost for good and a warning above the list says that some files cannot be restored

#### Scenario: Copy in a linked worktree
- **WHEN** a linked worktree on `feat/lint-rules` also holds `lint-rules`
- **THEN** the confirmation lists that worktree with its branch, says its copy is kept and that the change stays on the board

#### Scenario: Preview writes nothing
- **WHEN** the confirmation is opened and cancelled
- **THEN** no file, index entry or ref of the repository changed

### Requirement: Confirming deletes the change directory and stages its removal
On the user's confirmation the dashboard SHALL delete `openspec/changes/<name>/` from the main checkout with everything
in it, removing symbolic links inside it as links without following them. In a git repository it SHALL then stage the
removal with a single `git add --all -- openspec/changes/<name>/`, best-effort: when that fails, or when nothing in the
directory was tracked, the dismissal still succeeds and reports that nothing was staged. The dashboard MUST NOT commit,
and MUST NOT delete, move or stage anything outside that directory. A rescan SHALL follow, after which the change is
gone from the board unless a linked worktree holds a copy.

#### Scenario: Dismiss a committed change
- **WHEN** the user confirms dismissing a change whose files are committed
- **THEN** the directory is gone, `git status` shows its files as deleted in the index, no commit was made, and the card disappears after the rescan

#### Scenario: Only the directory is staged
- **WHEN** a change is dismissed in a repository with unrelated modified and untracked files
- **THEN** none of those files is staged, and no ref, branch or commit changes

#### Scenario: Untracked change
- **WHEN** a change that was never staged or committed is dismissed
- **THEN** its directory is deleted and the result reports that nothing was staged

#### Scenario: Symbolic link inside the change
- **WHEN** the change directory contains a symbolic link to a file outside the repository
- **THEN** the link is removed and the file it points to is unchanged

#### Scenario: Copy in a linked worktree stays
- **WHEN** a change is dismissed while a linked worktree holds a copy of it
- **THEN** the worktree's copy, files, index and branch are unchanged and the card, now read from that worktree, stays on the board

### Requirement: Confirmation is re-checked, never trusted
The confirmation SHALL carry a fingerprint of what it showed: every file's relative path, size, modification time and
git state. When the user confirms, the dashboard SHALL recompute it and refuse the dismissal, deleting nothing, when it
differs — the directory changed since the confirmation was shown — or when an agent session for the change is running.
It SHALL also refuse a second dismissal of the same change while one is running. A refusal SHALL say why, and the
confirmation SHALL then offer to show the current state again.

#### Scenario: Agent wrote a file meanwhile
- **WHEN** an agent creates `specs/api/spec.md` in the change directory after the confirmation was opened, and the user confirms
- **THEN** the dismissal is refused because the change changed since it was shown, and nothing is deleted

#### Scenario: Running session
- **WHEN** an agent session for the change is running and the user confirms
- **THEN** the dismissal is refused because a session is running for the change, and nothing is deleted

### Requirement: Dismissal never reaches beyond the change directory
Dismissing a change MUST NOT remove or modify a linked worktree, a session record, a branch or any other ref, MUST NOT
contact a remote, MUST NOT change the main checkout's branch, and MUST NOT invoke the `openspec` CLI or any agent.
Worktrees and branches left for the change SHALL be left to ending their session and to repository cleanup. The
activity log MUST NOT be edited; the change's disappearance is recorded by the next scan like any removed change.

#### Scenario: Session worktree is kept
- **WHEN** a change with an ended session and a worktree on `feat/lint-rules` is dismissed
- **THEN** that worktree and branch still exist afterwards

#### Scenario: Activity
- **WHEN** a change in `Drafts` is dismissed
- **THEN** the activity feed shows it as removed from `Drafts`, and earlier entries about it are unchanged

### Requirement: Dismissal reaches the change directory through real directories only
Before it previews and again immediately before it deletes, dismissal SHALL check with `lstat` every path segment below
the repository's folder down to the change directory — `openspec`, `openspec/changes` and `openspec/changes/<name>` —
and SHALL refuse with `409`, naming the segment, unless every one of them is a directory and none is a symbolic link.
The repository's folder itself MAY be reached through a symbolic link. A refused dismissal MUST NOT delete, move or
stage anything, inside or outside the repository.

#### Scenario: Linked changes directory
- **WHEN** `openspec/changes` in `demo-ops` is a symbolic link to `/w/acme/shared-changes` and the user dismisses
  `lint-rules`
- **THEN** the dismissal is refused with `409` naming `openspec/changes`, and `/w/acme/shared-changes/lint-rules/` is
  byte-for-byte unchanged

#### Scenario: Linked openspec directory
- **WHEN** `openspec` in `demo-ops` is a symbolic link to a directory outside the repository
- **THEN** both the preview and the dismissal are refused with `409` and nothing is deleted

#### Scenario: Link appears after the preview
- **WHEN** the preview succeeded and `openspec/changes` is replaced by a symbolic link before the user confirms
- **THEN** the dismissal is refused with `409` and nothing is deleted
