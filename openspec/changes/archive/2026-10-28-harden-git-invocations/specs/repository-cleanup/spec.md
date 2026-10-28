## ADDED Requirements

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

#### Scenario: Hooks do not run
- **WHEN** the repository has an executable `reference-transaction` hook and the user confirms a cleanup that removes a
  merged worktree, prunes a record and deletes a merged branch
- **THEN** all three happen and the hook did not run
