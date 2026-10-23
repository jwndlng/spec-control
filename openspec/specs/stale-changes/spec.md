# stale-changes Specification

## Purpose
Marks a change whose work is finished but whose board state says otherwise — an archive committed on a branch that
never reached the default branch, or a session worktree left over after the default branch archived its change — with
the reason on the board and one fitting action, using read-only git only.

## Requirements

### Requirement: A change whose archive is stranded on a branch is reported
For every active change of an enabled git repository with at least one commit, the scan SHALL look for a **stranded
archive**: a directory `openspec/changes/archive/<YYYY-MM-DD>-<name>/` for the change's name in the tree of a local
branch or a remote-tracking branch whose short name contains the change's name, other than the default branch and a
remote's `HEAD`. Such an archive is stranded only when neither the main checkout nor the default branch as locally known
(`origin/HEAD`, else the main checkout's `HEAD`) holds an archive of that name of the same or a later date, and when the
change was not created after that archive's date (which would make it a new change reusing the name). The scan SHALL
report, on the change, the branch, the archive directory's name and the commit that added it — the newest commit on that
branch that touched the archive directory. When several branches hold one, the newest archive wins, then the local
branch over the remote-tracking one, then the branch name in order. At most four candidate branches SHALL be inspected
per change.

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

### Requirement: A session worktree of an archived change is reported as settled
The listing of session worktrees SHALL mark a worktree **settled** when all of the following hold, decided with
read-only git and without contacting a remote:

- no agent session is running in it;
- the default branch as locally known holds an archive `openspec/changes/archive/<YYYY-MM-DD>-<change>/` of the
  worktree's change;
- every commit on the worktree's `HEAD` is in the default branch, or every file it changed since it forked from the
  default branch has the same content there;
- every uncommitted or untracked file, if any, lies inside `openspec/changes/<change>/` or inside an
  `openspec/changes/archive/<YYYY-MM-DD>-<change>/` directory.

A settled worktree carries the archive's directory name and its number of uncommitted files. Anything else in the
worktree — a file outside those directories, a commit whose content the default branch lacks, a running session —
means it is not settled. Being settled changes nothing on disk and nothing about the session record.

#### Scenario: Interrupted session after its change was archived
- **WHEN** a session ended because the dashboard was restarted, its worktree's branch head is already in the default
  branch, the default branch holds `archive/2026-10-22-update-routines/`, and the worktree's only uncommitted change is
  the deletion of `openspec/changes/update-routines/tasks.md`
- **THEN** the worktree is listed as settled, with that archive and one uncommitted file

#### Scenario: Work outside the change's directory
- **WHEN** the same worktree also has an uncommitted edit to `src/app.ts`
- **THEN** it is not settled

#### Scenario: A running session
- **WHEN** an agent session is running in the worktree
- **THEN** it is not settled

### Requirement: Stale changes are marked on the board with their reason
A change card SHALL show a **Stale** badge, in the warning tone, when the change has a stranded archive or, for an
archived change, when one of its session worktrees is settled. The badge's title and accessible name SHALL state the
reason in words — for a stranded archive that the archive was committed on the named branch but never reached the
default branch; for a settled worktree that a session worktree is left over although everything it holds is already
archived on the default branch. The badge SHALL NOT move the card, change its column or any count.

#### Scenario: Stranded archive on an Implementing card
- **WHEN** a change in `Implementing` has a stranded archive on `feat/fix-release-pipeline`
- **THEN** its card shows a Stale badge whose title says the archive was committed on `feat/fix-release-pipeline` but
  never reached the default branch, and the card stays in `Implementing`

#### Scenario: Settled worktree of an archived change
- **WHEN** an archived change has a settled session worktree
- **THEN** its card in `Archived` shows a Stale badge naming the left-over worktree

### Requirement: The change detail offers the fitting action for a stale change
The change detail SHALL show, for a stale change, a notice with the reason and one action:

- For a settled worktree, **Remove worktree…** SHALL open the branch-and-worktree deletion dialog of the
  `repository-cleanup` capability for exactly that worktree, with the same preview, acknowledgement, backup, re-checks
  and refusals; the notice SHALL say that what the worktree holds is already archived on the default branch. Nothing is
  removed before the user confirms in that dialog.
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

#### Scenario: Removing a settled worktree
- **WHEN** the user presses Remove worktree… on a settled worktree's notice and confirms in the dialog
- **THEN** the worktree is removed exactly as the deletion dialog removes one from the project details, with a copy of
  its uncommitted files under the dashboard's home

#### Scenario: Carrying over a stranded archive
- **WHEN** the user presses Carry over archive on a change whose archive commit `abc…` is stranded on
  `feat/fix-release-pipeline`
- **THEN** an archive session starts in a fresh worktree whose prompt asks the agent to cherry-pick that commit onto its
  branch without archiving again, and the change stays where it is until that work reaches the default branch

#### Scenario: Carry over without a stranded archive
- **WHEN** a request to carry over the archive names a change whose last scan reports no stranded archive
- **THEN** the server refuses it and starts nothing
