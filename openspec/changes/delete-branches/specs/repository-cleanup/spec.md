## ADDED Requirements

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

## MODIFIED Requirements

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
