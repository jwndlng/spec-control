# stale-changes Specification

## Purpose
Marks a change whose work is finished but whose board state says otherwise — an archive committed on a branch that
never reached the default branch, or a session worktree left over after the default branch archived its change — with
the reason on the board and one fitting action, using read-only git only.

## Requirements

### Requirement: A change whose archive is stranded on a branch is reported
For every active change of an enabled git repository with at least one commit, the scan SHALL look for a **stranded
archive**: a directory `openspec/changes/archive/<YYYY-MM-DD>-<name>/` for the change's name in the tree of a local
branch or a remote-tracking branch that is one of the change's branches (requirement "A change's branches are named
exactly"), other than the default branch and a remote's `HEAD`. Such an archive is stranded only when neither the main
checkout nor the default branch as locally known (`origin/HEAD`, else the main checkout's `HEAD`) holds an archive of
that name of the same or a later date, and when the change was not created after that archive's date (which would make
it a new change reusing the name). The scan SHALL report, on the change, the branch, the archive directory's name and the
commit that added it — the newest commit on that branch that touched the archive directory. When several branches hold
one, the newest archive wins, then the local branch over the remote-tracking one, then the branch name in order. At most
four candidate branches SHALL be inspected per change.

The detection SHALL use only read-only git (`for-each-ref`, `ls-tree`, `log`), SHALL NOT contact a remote, and SHALL NOT
change the change's stage, column or any count: the change stays in the column its checkouts give it. A repository
without git, or without a commit, reports nothing. A git failure for one branch leaves that branch out and fails nothing.

#### Scenario: Archive committed on a merged branch and never brought over
- **WHEN** the change `fix-release-pipeline` is active in the main checkout and the local branch
  `feat/fix-release-pipeline` holds `openspec/changes/archive/2026-10-22-fix-release-pipeline/` that neither the main
  checkout nor `origin/main` holds
- **THEN** the scan reports a stranded archive on that change, naming `feat/fix-release-pipeline`, the archive directory
  and the commit that added it, and the change stays in its column

#### Scenario: The default branch already has the archive
- **WHEN** `origin/main` holds the archive but the main checkout has not pulled it yet
- **THEN** no stranded archive is reported: pulling brings it

#### Scenario: A newer change reusing the name
- **WHEN** a branch holds `archive/2026-01-03-auth/` and the active change `auth` was created on 2026-03-01
- **THEN** no stranded archive is reported for `auth`

#### Scenario: Only the remote-tracking branch is left
- **WHEN** the local branch was deleted but `origin/feat/fix-release-pipeline` still holds the archive
- **THEN** the stranded archive is reported naming `origin/feat/fix-release-pipeline`

#### Scenario: A branch that only contains the name
- **WHEN** the change `fix-release` records no branch and only `feat/fix-release-pipeline` holds an archive directory
  `2026-10-22-fix-release/`
- **THEN** no stranded archive is reported, because `feat/fix-release-pipeline` is not one of `fix-release`'s branches

### Requirement: Stale changes are marked on the board with their reason
A change card SHALL show a **Stale** badge, in the warning tone, when the change has a stranded archive or when it is
stale because it is archived and merged and has stale leftovers. The badge's title and accessible name SHALL state the
reason in words:
- for a stranded archive: that the archive was committed on the named branch but never reached the default branch;
- for an archived and merged change: that the change is archived and merged on the default branch while the given
  number of worktrees, branches and main-checkout copies are left over, with the number of uncommitted files they hold.

The badge SHALL NOT move the card, change its column or any count.

#### Scenario: Stranded archive on an Implementing card
- **WHEN** a change in `Implementing` has a stranded archive on `feat/fix-release-pipeline`
- **THEN** its card shows a Stale badge whose title says the archive was committed on `feat/fix-release-pipeline` but
  never reached the default branch, and the card stays in `Implementing`

#### Scenario: Settled worktree of an archived change
- **WHEN** an archived change has one stale worktree holding 2 uncommitted files and one stale branch
- **THEN** its card in `Archived` shows a Stale badge saying it is archived and merged while 1 worktree and 1 branch
  are left over with 2 uncommitted files

### Requirement: The change detail offers the fitting action for a stale change
The change detail SHALL show, for a stale change, a notice with the reason and one action:

- For an archived and merged change, **Clean up leftovers…** SHALL open the cleanup dialog of the requirement "A stale
  change's leftovers are cleaned up on one confirmation". Nothing is removed before the user confirms in that dialog.
  When the main checkout has not pulled the archive yet, the notice SHALL also say that Pull brings it.
- For a stranded archive, **Carry over archive** SHALL be offered where agent sessions are enabled for the repository
  and no session for the change is running. It starts an archive session for the change — in its own worktree on the
  archive session's branch, like any archive session — whatever the change's stage. Its opening prompt is a fixed text
  that names the change, the stranded commit, its branch and the default branch, and asks the agent to bring that
  commit onto its branch with `git cherry-pick` (nothing to do when the branch already contains it), not to archive the
  change again, and to leave committing further, pushing and the pull request to Ship. The docs auto-merge archive
  instruction is appended under the same conditions as for any archive session. Where sessions are not available the
  notice names the branch and commit so the user can do it by hand.

The server SHALL start a carry-over session only when its own last scan reports a stranded archive for that change, and
SHALL take the commit and branch from that scan, never from the request; a request for a change without one is refused
with the reason. The dashboard itself runs no git command beyond those of any archive session's worktree.

#### Scenario: Cleaning up a stale change's leftovers
- **WHEN** the user presses Clean up leftovers… on a stale archived change and confirms in the dialog
- **THEN** its stale leftovers are removed as that requirement describes, with a copy of their uncommitted files under
  the dashboard's home

#### Scenario: Carrying over a stranded archive
- **WHEN** the user presses Carry over archive on a change whose archive commit `abc…` is stranded on
  `feat/fix-release-pipeline`
- **THEN** an archive session starts in a fresh worktree whose prompt asks the agent to cherry-pick that commit onto its
  branch without archiving again, and the change stays where it is until that work reaches the default branch

#### Scenario: Carry over without a stranded archive
- **WHEN** a request to carry over the archive names a change whose last scan reports no stranded archive
- **THEN** the server refuses it and starts nothing

### Requirement: A change's branches are named exactly
Wherever stale detection looks for branches of a change, the change's **branches** SHALL be exactly:
- the implementation branch and the archive branch recorded in the change's metadata, when recorded
  (`spec-control.branch` and `spec-control.archive-branch` in `.openspec.yaml`);
- the dashboard's own session branches for it, `feat/<name>`, `chore/archive-<name>` and the proposal branch
  `docs/<name>` a Draft session works on in a project with docs auto-merge;
- the branch of every dashboard session record for that change in that repository.

The metadata is read from the change's own directory in the checkout the board shows it from or, for a change archived
on the default branch, from that archive directory on the default branch, with read-only git. A remote-tracking branch
matches when its name without the remote's prefix is one of them. Branch names SHALL be compared exactly as written, with
no containment, abbreviation or normalisation. A recorded name that is not a valid branch name SHALL be ignored.

#### Scenario: Recorded branches
- **WHEN** the change `rotate-keys` records `branch: fix/rotate-keys` and `archive-branch: chore/archive-rotate-keys`
- **THEN** its branches are `fix/rotate-keys`, `chore/archive-rotate-keys`, `feat/rotate-keys` and `docs/rotate-keys`

#### Scenario: Containment is not a match
- **WHEN** the change `auth` records nothing and the repository has `feat/auth-v2`
- **THEN** `feat/auth-v2` is not one of `auth`'s branches

#### Scenario: The proposal branch
- **WHEN** the change `rotate-keys` is archived and merged on the default branch, and its proposal session's worktree on `docs/rotate-keys` was kept
- **THEN** `docs/rotate-keys` is one of its branches, and that worktree is offered as a stale leftover like any other of its branches

### Requirement: A change that is archived and merged is stale
For every change of an enabled git repository with at least one commit whose archive
`openspec/changes/archive/<YYYY-MM-DD>-<name>/` is held by the default branch as locally known (`origin/HEAD`, else the
main checkout's `HEAD`), and that was not created after that archive's date, the scan SHALL determine the change's
**leftovers**:
- a linked worktree on one of the change's branches;
- a local branch that is one of the change's branches;
- the change's directory `openspec/changes/<name>/` in the main checkout, when none of its files is in the main
  checkout's current commit, so that it exists only as files added locally (staged or untracked).

The default branch, the main checkout's branch and remote-tracking refs are never leftovers.

A worktree or branch leftover SHALL be **stale** when no agent session is running in it and its branch (or, for a
detached worktree, its `HEAD`) is **merged**: it has no commit the default branch lacks, or every file it changed since it
forked from the default branch has the same content there. A main-checkout leftover SHALL be stale when no agent session
runs in place in the main checkout. Uncommitted and untracked files, wherever they lie, SHALL NOT stop a merged leftover
from being stale; they are reported with it, capped at 200 paths plus a count. A leftover that is not merged, or that has
a running session, SHALL be reported as **kept** with that reason.

A change SHALL be marked stale when it has at least one stale leftover. Merged SHALL be derived on every scan from
read-only git and never stored in the repository, the change metadata or the dashboard's home. The detection SHALL NOT
contact a remote and SHALL NOT change the change's stage, column or any count. A git failure for one leftover SHALL leave
that leftover out and fail nothing.

#### Scenario: Worktree with an uncommitted source edit after the merge
- **WHEN** `origin/main` holds `archive/2026-10-20-rotate-keys/`, the session worktree on `feat/rotate-keys` has every
  commit's content in `origin/main`, and it holds an uncommitted edit to `src/keys.ts`
- **THEN** the worktree is a stale leftover of `rotate-keys`, reporting `src/keys.ts` as uncommitted, and the change is
  marked stale

#### Scenario: Archive worktree with the move half committed
- **WHEN** the archive worktree on `chore/archive-rotate-keys` is merged but still shows the deletion of
  `openspec/changes/rotate-keys/tasks.md` as uncommitted
- **THEN** it is a stale leftover reporting that one file

#### Scenario: Branch without a worktree
- **WHEN** the worktree of `rotate-keys` was removed but the local branch `feat/rotate-keys` remains, squash-merged into
  `origin/main`
- **THEN** the branch is a stale leftover

#### Scenario: The created change directory in the main checkout
- **WHEN** `openspec/changes/rotate-keys/` in the main checkout was created and staged by the dashboard, never committed
  there, and the main checkout has pulled `archive/2026-10-20-rotate-keys/`
- **THEN** that directory is a stale leftover, and the change no longer counts as active because of it once it is
  cleaned up

#### Scenario: A hand-made worktree
- **WHEN** the user's own worktree at `/w/acme/alpha-infra-wt` is on `feat/rotate-keys`, merged, outside
  `~/.spec-control/worktrees/`
- **THEN** it is a stale leftover like a session worktree

#### Scenario: Work the default branch lacks
- **WHEN** `feat/rotate-keys` has one commit whose content `origin/main` lacks
- **THEN** that branch is reported as kept because it holds unmerged work, and it is not a stale leftover

#### Scenario: A running session
- **WHEN** an agent session runs in the worktree on `chore/archive-rotate-keys`
- **THEN** that worktree is kept because a session runs in it

#### Scenario: Archive not on the default branch yet
- **WHEN** a change's archive exists only on `chore/archive-rotate-keys` and not on `origin/main`
- **THEN** the change is not stale; the stranded-archive requirement applies instead

#### Scenario: A newer change reusing the name
- **WHEN** `origin/main` holds `archive/2026-01-03-auth/` and the active change `auth` was created on 2026-03-01
- **THEN** nothing of `auth` is a leftover

### Requirement: A stale change's leftovers are cleaned up on one confirmation
The change detail of a stale change SHALL offer **Clean up leftovers…**, available whether or not agent sessions are
enabled. It SHALL open a dialog that lists every stale leftover, read afresh with read-only git and without contacting a
remote:
- for a worktree: its path, branch, full commit and uncommitted and untracked paths;
- for a branch: its name and full commit;
- for the main checkout's change directory: its files and whether each is staged.

The dialog SHALL also list the kept leftovers with their reasons, and SHALL say that ignored files are deleted without a
copy. When any listed uncommitted path lies outside `openspec/changes/<name>/` and the change's archive directory, the
confirm control SHALL stay disabled until the user acknowledges that those files will be deleted after a copy is kept.
Nothing SHALL be removed before the user confirms.

On confirmation the server SHALL, independently of what the client sends:
- require that the default branch still holds the archive;
- refuse while a cleanup or a deletion runs in the repository;
- handle each confirmed item on its own:
  - **a worktree:** every re-check and step of the branch-and-worktree deletion of the `repository-cleanup`
    capability. It must still be a merged leftover; its uncommitted, non-ignored files are copied under
    `~/.spec-control/branch-backups/`; it is removed with `git worktree remove --force`; and its branch is deleted with
    `git branch -D` only if it still points at the commit shown.
  - **a branch without a worktree:** deleted with `git branch -D` only if it still points at the commit shown and is
    still merged.
  - **the main checkout's change directory:** it must still hold exactly the files shown with the content shown, none
    of them in the current commit. Every file that differs from the archive's copy is copied under
    `~/.spec-control/branch-backups/`. The directory is then deleted and its removal staged exactly as the confirmed
    dismissal of the `change-dismissal` capability does: one `git add --all -- openspec/changes/<name>/`, best-effort,
    never followed by a commit.

An item whose re-check fails SHALL be left untouched and reported with the reason, and the remaining items SHALL still
be handled. The result SHALL name, per item, what was removed or deleted, the backup folder when files were copied, and
for a deleted branch its former commit and `git branch <name> <commit>`. The repository SHALL be rescanned afterwards.
The cleanup MUST NOT contact a remote, delete a remote-tracking ref or a remote branch, touch the main checkout beyond
the change directory listed, touch any worktree or branch it did not list, or delete or change a session record.
Session records of removed worktrees SHALL stay, ended, as history.

#### Scenario: Two leftovers, one confirmation
- **WHEN** `rotate-keys` has a stale worktree on `feat/rotate-keys` with an uncommitted `src/keys.ts` and a stale branch
  `chore/archive-rotate-keys`, and the user acknowledges and confirms
- **THEN** `src/keys.ts` is copied under `~/.spec-control/branch-backups/`, the worktree and both branches are gone, the
  result names the backup and both restore commands, and the change is no longer marked stale

#### Scenario: Only files inside the change
- **WHEN** the only uncommitted file is `openspec/changes/rotate-keys/tasks.md` deleted
- **THEN** the confirm control is enabled without the acknowledgement, and the file is still backed up

#### Scenario: The main checkout's staged copy
- **WHEN** the leftovers include the main checkout's staged `openspec/changes/rotate-keys/` whose `prompt.md` differs
  from the archive's
- **THEN** after confirmation `prompt.md` is copied under `~/.spec-control/branch-backups/`, the directory is gone from
  the main checkout's working tree and index, nothing is committed, and the main checkout's branch is unchanged

#### Scenario: One item changed since the dialog
- **WHEN** after the dialog was shown a new commit lands on `chore/archive-rotate-keys` and the user then confirms
- **THEN** that branch is left untouched and reported as changed since the user looked, and the worktree on
  `feat/rotate-keys` is still removed

#### Scenario: Archive gone from the default branch
- **WHEN** the default branch no longer holds the archive when the user confirms
- **THEN** nothing is removed and the user is told the change is no longer archived on the default branch

#### Scenario: Remote untouched
- **WHEN** a stale cleanup runs in a repository whose remote is a local recording repository
- **THEN** the remote receives no request and every `refs/remotes/` ref is unchanged
