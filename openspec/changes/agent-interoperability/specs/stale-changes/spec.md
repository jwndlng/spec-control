# Spec Delta

## MODIFIED Requirements

### Requirement: The change detail offers the fitting action for a stale change
The change detail SHALL show, for a stale change, a notice with the reason and one action:

- For an archived and merged change, **Clean up leftovers…** SHALL open the cleanup dialog of the requirement "A stale
  change's leftovers are cleaned up on one confirmation". Nothing is removed before the user confirms in that dialog.
  When the main checkout has not pulled the archive yet, the notice SHALL also say that Pull brings it.
- For a stranded archive, **Carry over archive** SHALL be offered where agent sessions are enabled for the repository
  and no session for the change is running. It prepares the change's archive worktree on `chore/archive-<name>` from the
  default branch and attempts `git cherry-pick <commit>` directly on the server via `gitWrite`:
  - When `git cherry-pick <commit>` succeeds cleanly (or the branch already contains that archive directory) and every
    changed path lies under `openspec/`, Spec Control SHALL record `spec-control.archive-branch` in the archived
    `.openspec.yaml`, commit if needed, push `chore/archive-<name>`, and open the archive pull request deterministically
    without starting an agent process, recording an ended `archive` session with the auto-merge timestamp when docs
    auto-merge is enabled.
  - When `git cherry-pick <commit>` encounters a merge conflict, Spec Control SHALL abort the in-progress cherry-pick so
    the worktree is clean and start an archive agent session in that worktree whose opening prompt names the change, the
    stranded commit, its branch and the default branch, and asks the agent to cherry-pick that commit onto its branch and
    resolve the conflicts without archiving the change again. Once the agent exits cleanly with the archive directory
    present, Spec Control ships the branch automatically.
  Where sessions are not available the notice names the branch and commit so the user can do it by hand.

The server SHALL run Carry over archive only when its own last scan reports a stranded archive for that change, and
SHALL take the commit and branch from that scan, never from the request; a request for a change without one is refused
with the reason.

#### Scenario: Cleaning up a stale change's leftovers
- **WHEN** the user presses Clean up leftovers… on a stale archived change and confirms in the dialog
- **THEN** its stale leftovers are removed as that requirement describes, with a copy of their uncommitted files under
  the dashboard's home

#### Scenario: Carrying over a stranded archive
- **WHEN** the user presses Carry over archive on a change whose archive commit `abc…` on `feat/fix-release-pipeline`
  cherry-picks cleanly onto `chore/archive-fix-release-pipeline` and touches only `openspec/`
- **THEN** Spec Control cherry-picks `abc…`, records `archive-branch: chore/archive-fix-release-pipeline`, pushes the
  branch and opens the pull request without starting an agent process, and the change stays where it is until that work
  reaches the default branch

#### Scenario: Carrying over a conflicting stranded archive falls back to an agent
- **WHEN** the user presses Carry over archive on a change whose archive commit `abc…` conflicts when cherry-picked onto
  `chore/archive-fix-release-pipeline`
- **THEN** Spec Control aborts the failed cherry-pick and starts an archive agent session in the worktree whose prompt
  asks the agent to cherry-pick `abc…` and resolve the conflicts

#### Scenario: Carry over without a stranded archive
- **WHEN** a request to carry over the archive names a change whose last scan reports no stranded archive
- **THEN** the server refuses it and starts nothing

### Requirement: A duplicate is marked on the board and offered Remove duplicate
A change reported as a duplicate after archive SHALL keep the column, stage and counts it has without the report. Its
card SHALL show the **Stale** badge in the warning tone, whose title and accessible name say that the change is archived
on the default branch while `openspec/changes/<name>/` is still committed there too; a change that is also stale for
other reasons SHALL show one badge naming every reason. The change detail's hint about an active copy left next to an
archive SHALL, for a duplicate, say that the copy is committed next to its archive on the default branch, not that it is
probably uncommitted. When the main checkout has not pulled the default branch's state yet, the notice SHALL add that
Pull brings it.

The change detail SHALL show a notice for a duplicate with the archive directory, the differing paths and one action.
**Remove duplicate** SHALL be offered where agent sessions are enabled for the repository, no session for the change is
running, and no local branch `chore/archive-<name>` exists and no worktree is on it; otherwise the notice SHALL say why it
is not offered — for an existing archive branch, that **Clean up leftovers…** removes it when it is merged.
- When `differingCount === 0` (the active copy on the default branch is byte-for-byte identical to the archived copy),
  **Remove duplicate** SHALL create the worktree on `chore/archive-<name>` from the default branch, delete
  `openspec/changes/<name>/` (verifying with `lstat` that no segment is a symbolic link), record
  `spec-control.archive-branch` in `openspec/changes/archive/<archiveDir>/.openspec.yaml`, commit, push, and open the
  docs-only pull request deterministically without starting an agent process, recording an ended `archive` session with
  the auto-merge timestamp when docs auto-merge is enabled.
- When `differingCount > 0` (at least one file differs between the active copy and the archive), **Remove duplicate**
  SHALL start an archive session for the change in its own worktree on `chore/archive-<name>`, created from the default
  branch, whose opening prompt names the change, the archive directory and the differing paths, and asks the agent to
  show the user for each differing path what the active copy holds that the archive lacks, to carry into the archive
  only what the user confirms, and to delete `openspec/changes/<name>/`. Once the agent exits cleanly with
  `openspec/changes/<name>/` removed, Spec Control ships the branch automatically.
Where sessions are not available, the notice SHALL name the directory to delete and say that the deletion has to be
committed to the default branch.

The server SHALL run Remove duplicate only when its own last scan reports a duplicate for that change and SHALL take the
archive directory and the differing paths from that scan, never from the request; a request for a change without one, or
while the archive branch exists, is refused with the reason and starts nothing. The main checkout's working tree and
index MUST NOT be modified.

#### Scenario: The card stays archived
- **WHEN** `rotate-keys` is reported as a duplicate and the main checkout has pulled `origin/main`
- **THEN** one card for `rotate-keys` is shown in `Archived` with a Stale badge saying `openspec/changes/rotate-keys/` is
  still committed next to its archive, and no active card for it appears in `Done`

#### Scenario: Removing the duplicate
- **WHEN** the user presses Remove duplicate on `rotate-keys`, which differs from its archive in `tasks.md`, in a project
  with docs auto-merge on
- **THEN** an archive session starts in a fresh worktree on `chore/archive-rotate-keys` whose prompt names
  `2026-10-20-rotate-keys` and `tasks.md` and asks the agent to confirm with the user what to carry over before deleting
  `openspec/changes/rotate-keys/`; the session carries the auto-merge record

#### Scenario: Removing an identical duplicate without an agent
- **WHEN** the user presses Remove duplicate on `rotate-keys`, whose active copy is identical to `2026-10-20-rotate-keys` (`differingCount: 0`), in a project with docs auto-merge on
- **THEN** Spec Control creates the worktree on `chore/archive-rotate-keys`, removes `openspec/changes/rotate-keys/`, records `archive-branch: chore/archive-rotate-keys`, commits, pushes, and opens the pull request without starting an agent process, and the session carries the auto-merge record

#### Scenario: An old archive branch still exists
- **WHEN** the local branch `chore/archive-rotate-keys` from the original archive still exists
- **THEN** Remove duplicate is not offered, the notice says Clean up leftovers… removes that branch once merged, and a
  request for it is refused

#### Scenario: Request without a duplicate
- **WHEN** a request to remove the duplicate names a change whose last scan reports none
- **THEN** the server refuses it and starts nothing

#### Scenario: Sessions not available
- **WHEN** agent sessions are disabled
- **THEN** the notice names `openspec/changes/rotate-keys/` and says its deletion has to be committed to the default
  branch, and offers no action
