# repository-cleanup Specification

## Purpose
Lets the user remove a repository's leftover worktrees, stale worktree records and merged local branches from the
dashboard, offering only what provably holds no work that exists nowhere else, and only on the user's confirmation.

## Requirements

### Requirement: Cleanup lists what can be removed and why the rest is kept
For an enabled git repository whose last scan succeeded, the dashboard SHALL compute a cleanup preview from local git
with read-only commands and without contacting a remote. The base is the repository's default branch as locally known
(`origin/HEAD`, else a local `main` or `master`). The preview SHALL contain three lists, each item either **removable**
or **kept with a reason**:

- **Worktrees**: every linked worktree of the repository (never the main checkout), whether the dashboard created it
  or not, with its path, branch (or that it is detached), work status, last commit time, and whether the dashboard
  created it. A worktree is removable only if it is a directory and a git worktree, it has no uncommitted or untracked
  file, and either its work status is `merged` or it has no commit that exists nowhere else (nothing ahead of its
  upstream, or, without an upstream, no commit unreachable from every other local or remote-tracking branch). A
  worktree MUST be kept when an agent session is running in it, and when it is locked and the dashboard did not create
  it (the lock reason is shown).
- **Stale worktree records**: worktrees git lists as prunable because their directory no longer exists. They are
  always removable.
- **Branches**: every local branch except the default branch. A branch is removable only if the base is known and
  either every commit on the branch is reachable from the base, or every file the branch changed since it forked from
  the base has the same content in the base (which recognises squash and rebase merges). A branch MUST be kept when it
  is the default branch or the branch the main checkout is on, and when it is checked out in a linked worktree that is
  not itself removable. A branch checked out in a removable worktree SHALL be marked as depending on that worktree.

Every kept item's reason SHALL be stated in words (for example: uncommitted files, commits not in the base with their
count, session running, locked, checked out in the main checkout, default branch unknown). The preview MUST NOT write
anything to the repository.

#### Scenario: Squash-merged branch and its worktree
- **WHEN** worktree `feat/audit-trail` is clean and the base contains a single commit with the same file content as the
  branch's three commits, and its remote branch was deleted
- **THEN** the preview lists the worktree as removable and the branch `feat/audit-trail` as removable, depending on
  that worktree

#### Scenario: Unmerged branch
- **WHEN** local branch `fix/parser` has two commits whose changes are not in the base
- **THEN** the preview lists it as kept with the reason that 2 commits are not in the base

#### Scenario: Worktree with untracked files
- **WHEN** a linked worktree the user created contains one untracked file and its branch is merged
- **THEN** the worktree is kept with the reason that it has uncommitted files, and its branch is kept because it is
  checked out there

#### Scenario: Worktree deleted by hand
- **WHEN** the directory of a linked worktree was deleted with `rm -rf`
- **THEN** the preview lists it under stale worktree records as removable

#### Scenario: Default branch and main checkout
- **WHEN** the main checkout is on `feat/redesign`, which is fully merged, and the default branch is `main`
- **THEN** neither `main` nor `feat/redesign` is listed as removable

#### Scenario: Running session
- **WHEN** an agent session is running in a merged, clean session worktree
- **THEN** the worktree is kept with the reason that a session is running in it

#### Scenario: Locked worktree created by the user
- **WHEN** a clean, merged linked worktree outside `~/.spec-control/worktrees/` is locked with reason
  `in use by editor`
- **THEN** it is kept and the reason names the lock and `in use by editor`

#### Scenario: Unknown default branch
- **WHEN** the repository has no `origin/HEAD` and no local `main` or `master`
- **THEN** every branch is kept with the reason that the default branch is unknown

#### Scenario: Preview writes nothing
- **WHEN** a preview is computed for a repository whose index has stale stat information
- **THEN** no file in the repository, its git directory or any of its worktrees is modified and no remote is contacted

### Requirement: Cleanup is offered from the repository board and runs only on confirmation
The repository board header SHALL offer a **Clean up** action for an enabled git repository whose last scan succeeded.
It SHALL open a dialog showing the preview in three sections — worktrees, stale worktree records, branches — with
removable items pre-selected and selectable, and kept items listed with their reasons and not selectable. Selecting a
branch that depends on a worktree SHALL also select that worktree; deselecting the worktree SHALL deselect the branch.
The dialog SHALL state that "merged" reflects the last fetch and that pulling first brings it up to date, and SHALL
state that removing a worktree also deletes its ignored files (such as dependencies, build output and local
environment files). The confirm control SHALL name what will happen (for example `Remove 2 worktrees, prune 1 record,
delete 3 branches`) and SHALL be disabled when nothing is selected. When the preview has no removable item the dialog
SHALL say that there is nothing to clean up. Nothing SHALL be removed before the user confirms; closing the dialog
SHALL remove nothing. While a cleanup runs, the dialog SHALL show that it is running and SHALL NOT start a second one.

#### Scenario: Opening the dialog
- **WHEN** the user activates **Clean up** for a repository with one merged worktree and two merged branches
- **THEN** the dialog lists them pre-selected, nothing has been removed, and the confirm control reads
  `Remove 1 worktree, delete 2 branches`

#### Scenario: Cancelling
- **WHEN** the user closes the dialog without confirming
- **THEN** no worktree, record or branch is removed

#### Scenario: Nothing to do
- **WHEN** every worktree and branch of the repository is kept
- **THEN** the dialog says there is nothing to clean up and lists the kept items with their reasons

#### Scenario: Dependent selection
- **WHEN** the user deselects a worktree whose branch is selected
- **THEN** that branch is deselected as well

#### Scenario: Non-git repository
- **WHEN** a tracked repository is not a git repository
- **THEN** no **Clean up** action is offered for it

### Requirement: Confirmed cleanup re-checks every item and removes only what is still safe
When the user confirms, the dashboard SHALL re-check every selected item against the current state, independently of
the preview, and SHALL remove only items that are still removable; an item that is no longer removable, no longer
exists, or was not in the repository's own list SHALL be kept and reported with the reason. A branch SHALL be deleted
only if it still points at the commit shown in the preview. Items SHALL be processed in this order: worktrees, then
stale records, then branches, so that a branch whose worktree was removed in the same run can then be deleted, and a
branch whose worktree was kept is kept. A worktree SHALL be removed with a non-forcing `git worktree remove`, preceded
by `git worktree unlock` only for a worktree the dashboard created; stale records SHALL be removed with
`git worktree prune`; a branch SHALL be deleted with `git branch -D` only after the checks above. A failure of one item
SHALL NOT stop the others. The result SHALL list each item's outcome — removed, pruned, deleted, or kept with the
reason — and for every deleted branch the commit it pointed to and a command that restores it
(`git branch <name> <commit>`). The repository SHALL be rescanned afterwards and the view SHALL update without a page
reload.

#### Scenario: Merged worktree and branch
- **WHEN** the user confirms the removal of a clean, merged worktree on `feat/audit-trail` and of that branch
- **THEN** the worktree directory is gone, `git branch --list feat/audit-trail` is empty, and the result shows the
  branch's former commit and `git branch feat/audit-trail <commit>`

#### Scenario: Changed since the preview
- **WHEN** a file is created in a selected worktree after the preview was shown, and the user then confirms
- **THEN** that worktree and its branch are kept and reported with the reason that the worktree has uncommitted files,
  and the other selected items are removed

#### Scenario: Branch moved since the preview
- **WHEN** a selected branch receives a new commit after the preview was shown
- **THEN** the branch is kept and reported as changed since the preview

#### Scenario: Session started meanwhile
- **WHEN** an agent session is started in a selected worktree before the user confirms
- **THEN** the worktree is kept and reported with the reason that a session is running in it

#### Scenario: Restoring a deleted branch
- **WHEN** the user runs the restore command shown for a deleted branch
- **THEN** the branch exists again at the same commit

### Requirement: Cleanup never touches more than it lists
Cleanup MUST NOT contact a remote, delete or change a remote-tracking branch, delete a remote branch, force a worktree
removal, delete the default branch or the branch the main checkout is on, change the main checkout's branch, index or
working tree, commit, reset, stash, or run repository hooks. It MUST NOT remove anything the user did not select in
the dialog, and MUST NOT run on a timer, during a scan, on page load or as a side effect of another action. Cleanup
SHALL be available whether or not agent sessions are enabled. The only forced worktree removal and the only deletion
of a branch whose work is not in the default branch are those of "One branch and its worktree can be deleted whatever
they hold", for the one worktree the user confirmed there; the Clean up dialog never offers either.

#### Scenario: Remote untouched
- **WHEN** a cleanup deletes two branches in a repository whose remote is a local recording repository
- **THEN** the remote receives no request and every `refs/remotes/` ref of the repository is unchanged

#### Scenario: Main checkout untouched
- **WHEN** a cleanup removes worktrees and branches
- **THEN** the main checkout's branch, `git status` and `.git/index` are unchanged

#### Scenario: Agent sessions disabled
- **WHEN** agent sessions are disabled and the user confirms a cleanup of a merged worktree the user created
- **THEN** the worktree is removed and no agent process is started

#### Scenario: Clean up still keeps unsafe items
- **WHEN** the Clean up dialog is opened for a repository whose only worktree has uncommitted files
- **THEN** that worktree is listed as kept, as before, and is not offered for removal there

#### Scenario: Hooks do not run
- **WHEN** the repository has an executable `reference-transaction` hook and the user confirms a cleanup that removes a
  merged worktree, prunes a record and deletes a merged branch
- **THEN** all three happen and the hook did not run

### Requirement: One branch and its worktree can be deleted whatever they hold
For a linked worktree of an enabled git repository whose last scan succeeded, the dashboard SHALL offer to delete that
worktree and the local branch checked out in it (only the worktree when its HEAD is detached), even when the worktree
has uncommitted or untracked files and the branch has commits that are in no other branch, on no remote or not in the
default branch. It SHALL NOT be offered for the main checkout, a stale worktree record, a bare entry or a worktree on
the default branch.

Before anything is deleted the dashboard SHALL show, read with read-only git and without contacting a remote, what
the deletion would lose: the branch and the full commit it points to, the number of uncommitted and untracked files
with their paths (at most 200 listed, the rest counted), the number of commits not on any remote and the number not in
the default branch (both as of the last fetch), whether the dashboard created the worktree, and that the worktree's
ignored files (dependencies, build output, local environment files) are deleted without a copy. Reading this MUST NOT
write anything to the repository. Deleting SHALL be refused, with the reason stated, when an agent session is running
in the worktree, when the worktree is locked and the dashboard did not create it (the lock reason is shown), when the
branch is the default branch, and while a cleanup or another deletion runs in the repository.

When the worktree has uncommitted or untracked files, or the branch has commits that are not in the default branch,
the confirm control SHALL stay disabled until the user explicitly acknowledges that this work will be deleted. The
confirm control SHALL name what will happen (for example `Delete feat/report and its worktree`). Nothing SHALL be
deleted before the user confirms; closing the dialog SHALL delete nothing.

When the user confirms, the dashboard SHALL re-check, independently of what the client sends, that the path is still
a linked worktree of the repository, on the same branch (or still detached) at the commit the dialog showed, that its
uncommitted and untracked files are exactly those the dialog showed, that no session runs in it and that it is not
locked by the user; otherwise it SHALL delete nothing and say why. It SHALL then, in this order:
1. copy every uncommitted or untracked file that is not ignored and still exists (regular files and symbolic links,
   with their paths relative to the worktree) into a new folder under `~/.spec-control/branch-backups/`, together with
   a record of the repository, worktree path, branch, commit and copied files — and if that copy fails or exceeds the
   backup limit, delete nothing;
2. remove the worktree with `git worktree remove --force`, preceded by `git worktree unlock` only for a worktree the
   dashboard created, never forcing a lock;
3. delete the branch with `git branch -D` only if it still points at the commit the dialog showed and is still neither
   the default branch nor the main checkout's branch.

The result SHALL say what was removed and deleted, the backup folder when files were copied, and for a deleted branch
the commit it pointed to and a command that restores it (`git branch <name> <commit>`). A worktree removed while its
branch could not be deleted SHALL be reported as such with git's reason. The repository SHALL be rescanned afterwards
and the view SHALL update without a page reload. The deletion MUST NOT contact a remote, delete or change a
remote-tracking ref or a remote branch, change the main checkout's branch, index or working tree, touch any other
worktree, commit, reset, stash or run repository hooks, and SHALL be available whether or not agent sessions are
enabled.

#### Scenario: Worktree with uncommitted work
- **WHEN** the worktree on `feat/report` has 2 modified files and 1 untracked file and the user opens **Delete…** for it
- **THEN** the dialog lists the three paths, says that ignored files are not copied, and the confirm control
  `Delete feat/report and its worktree` stays disabled until the user ticks the acknowledgement

#### Scenario: Confirmed deletion with backup
- **WHEN** the user acknowledges and confirms the deletion of that worktree
- **THEN** the three files are copied under `~/.spec-control/branch-backups/`, the worktree directory is gone,
  `git branch --list feat/report` is empty, and the result names the backup folder, the branch's former commit and
  `git branch feat/report <commit>`

#### Scenario: Unmerged branch in a clean worktree
- **WHEN** a clean worktree's branch `fix/parser` has 2 commits that are on no remote and not in the default branch
- **THEN** the dialog says 2 commits are not on any remote and not in the default branch, asks for the
  acknowledgement, and after confirmation the branch is deleted and its restore command shown, with no backup folder

#### Scenario: Nothing at stake
- **WHEN** the worktree is clean and its branch is fully merged into the default branch
- **THEN** the confirm control is enabled without an acknowledgement

#### Scenario: Changed since the dialog
- **WHEN** a file is created in the worktree after the dialog was shown and the user then confirms
- **THEN** nothing is copied, removed or deleted and the user is told the worktree changed since they looked

#### Scenario: Branch moved since the dialog
- **WHEN** the branch receives a new commit after the dialog was shown and the user then confirms
- **THEN** nothing is removed or deleted and the user is told the branch changed since they looked

#### Scenario: Session running
- **WHEN** an agent session is running in the worktree
- **THEN** the dialog says deletion is refused until the session is ended, and a confirmation sent anyway deletes nothing

#### Scenario: Locked by the user
- **WHEN** the worktree lies outside `~/.spec-control/worktrees/` and is locked with reason `in use by editor`
- **THEN** deletion is refused and the reason names the lock and `in use by editor`

#### Scenario: Detached worktree
- **WHEN** the worktree's HEAD is detached
- **THEN** the confirm control reads `Remove this worktree` and confirming removes the worktree and deletes no branch

#### Scenario: Restoring
- **WHEN** the user runs the restore command shown and copies the backup folder's files back into a new worktree of
  that branch
- **THEN** the branch exists again at the same commit and the uncommitted files have their former content

#### Scenario: Remote and main checkout untouched
- **WHEN** a deletion runs in a repository whose remote is a local recording repository
- **THEN** the remote receives no request, every `refs/remotes/` ref is unchanged, and the main checkout's branch,
  `git status` and `.git/index` are unchanged

### Requirement: Merge checks work from a project in a subfolder
Whether a branch's work is in the default branch — for the Clean up dialog's branches, for the re-check on confirmation
and for the deletion preview's "merged" — SHALL be decided the same way for a project in a subfolder of its git
repository as for one at the top level: by ancestry, or by every file the branch changed since it forked from the
default branch, named relative to the repository's top level and including both sides of a rename, having the same
content there. The answer MUST NOT depend on the working directory the check runs in or on `diff.relative`,
`diff.renames` or an external diff driver. A branch with a file whose content the default branch lacks SHALL NOT be
offered for deletion and SHALL NOT be deleted on a confirmation that names it.

#### Scenario: Unmerged branch in a subfolder project
- **WHEN** the project `/w/acme/monorepo/packages/tools` has a local branch `feat/rotate-keys` with one commit changing
  `packages/tools/src/keys.ts` that `origin/main` lacks
- **THEN** the Clean up dialog lists it as kept with `1 commit(s) not in origin/main`, and a confirmation naming it
  deletes nothing

#### Scenario: Squash-merged branch in a subfolder project
- **WHEN** that commit was squash-merged into `origin/main`
- **THEN** the branch is offered as merged by content and is deleted on confirmation

#### Scenario: Deletion preview in a subfolder project
- **WHEN** the user opens the branch-and-worktree deletion for the worktree on the unmerged `feat/rotate-keys`
- **THEN** the preview counts one commit not in the default branch and does not call it merged

### Requirement: One cleanup per git repository
A cleanup, a branch-and-worktree deletion and a stale change's cleanup SHALL be refused as busy while any one of them
runs for any tracked project of the same git repository, identified by its git common directory, so that two projects
sharing one repository never remove worktrees or delete branches of it at the same time.

#### Scenario: Two projects in one repository
- **WHEN** `/w/acme/monorepo/packages/a` and `/w/acme/monorepo/packages/b` are tracked and the user confirms a cleanup of
  `b` while a cleanup of `a` runs
- **THEN** the cleanup of `b` is refused as busy and nothing is removed for it
