## MODIFIED Requirements

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
  the base has the same content in the base (which recognises squash and rebase merges), or exact merged PR evidence satisfies "Cleanup recognizes the exact merged PR head", or the existing relevance-based rule finds old unrelated work eligible. A branch MUST be kept when it
  is the default branch or the branch the main checkout is on, and when it is checked out in a linked worktree that is
  not itself removable. A branch checked out in a removable worktree SHALL be marked as depending on that worktree.

The relevance-based cleanup rules on main SHALL be preserved: work associated with an active change is kept; old unrelated work remains eligible without merge proof, while recent work without sufficient merge evidence is kept. Exact PR evidence is an additional merge proof, not a new prerequisite for age-based deletion. Dirty work, running sessions, external locks, protected branches, and changed heads remain protected.

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

A branch selected with a stale-record dependency SHALL be re-evaluated after pruning in the same cleanup operation. A failed prune SHALL keep its dependent branch with the actual reason; a successful prune SHALL NOT require the user to reopen cleanup.


## ADDED Requirements

### Requirement: Cleanup recognizes the exact merged PR head
Cleanup SHALL accept cached PR merge proof only for a same-repository PR targeting the default branch, with an exact local head match and a merge commit reachable from the local base. Local ancestry/content proofs and age-based eligibility SHALL remain alternatives. Missing, stale, mismatched, or fork evidence SHALL NOT prove a merge. Preview SHALL NOT fetch or query GitHub.

#### Scenario: Cache freshness
- **WHEN** cleanup evaluates cached PR evidence
- **THEN** only a successful cache fetched within five minutes, with a valid non-future timestamp, can establish a PR merge proof

#### Scenario: Squash merge followed by edits
- **WHEN** a branch head exactly matches a merged PR head, its merge commit is in the base, and the base later edited the same files
- **THEN** the branch is recognized as merged despite failure of final file-content comparison

#### Scenario: More work after merge
- **WHEN** a local branch has a new commit beyond the head recorded on its merged PR
- **THEN** that PR does not authorize deleting the branch

#### Scenario: Cached merge not yet in local base
- **WHEN** cached GitHub evidence reports merged but its merge commit is not reachable from the local base
- **THEN** cleanup keeps the branch and offers Refresh/Pull guidance rather than treating the evidence as sufficient

### Requirement: Kept branches show evidence and recovery
Every branch SHALL appear in cleanup, except the protected default branch. Kept items SHALL state the concrete blocker, the evidence freshness when applicable, and a relevant next action. Missing merge evidence SHALL be distinguished from proven additional work. Cleanup SHALL NOT weaken dirty-file, running-session, external-lock, main-checkout, or changed-head protections.

#### Scenario: Evidence unavailable
- **WHEN** local comparisons fail and no exact merged PR evidence exists
- **THEN** cleanup explains that merge evidence is insufficient and offers refresh or inspection, without claiming definitively that the work was never merged

#### Scenario: Stale worktree dependency
- **WHEN** a merged branch is held only by a prunable record
- **THEN** it is selectable with the prune dependency and can be removed in one confirmed cleanup
