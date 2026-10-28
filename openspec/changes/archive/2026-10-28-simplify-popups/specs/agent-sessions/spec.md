# Spec Delta

## ADDED Requirements

### Requirement: The end-session dialog is short
The dialog that confirms ending or cleaning up a change session SHALL open with a headline naming what it does and the
change — **End session** for a running session, **Clean up** for one that has ended — followed by at most one line
saying that the options below tidy up after the session and can be chosen. Each option it offers (removing the
worktree, cleaning up a stale change's leftovers, pulling the repository) SHALL be a checkbox whose visible label is a
short phrase of a few words, such as *Remove worktree*, *Clean up leftovers* or *Pull `<repo>`*; what the option does
and why SHALL be its hover description, available to pointer and assistive technology alike, and SHALL NOT be repeated
as visible text. Every option the dialog offers SHALL be selected when the dialog opens.

Only what changes the user's decision SHALL be shown as visible text beside the options, each in one line: the warning
that the worktree holds unshipped work, the reason a worktree cannot be removed, the stale leftovers that would be
removed with the paths outside the change among their uncommitted files, and the leftovers kept with their reasons.
The dialog SHALL NOT show explanatory paragraphs about how ending stops the agent, which branch is kept, or how
backups are made; those MAY be hover descriptions. The reports the dialog turns into after a pull or a cleanup that
needs saying SHALL state the outcome and that the session has ended, without further explanatory sentences.

This requirement changes only what the dialog shows. What confirming, clearing an option or cancelling does SHALL stay
as the other requirements of this capability specify.

#### Scenario: Ending a session with a removable worktree
- **WHEN** the user ends a running session whose worktree is clean and merged, in a tracked git repository
- **THEN** the dialog shows the headline **End session** with the change's name, one line of explanation, and two
  checkboxes labelled *Remove worktree* and *Pull* with the repository's name, both selected, and no further prose

#### Scenario: Hover explains an option
- **WHEN** the user hovers over the *Pull* option
- **THEN** a description says that it fetches the repository's remote and fast-forwards its main checkout, and never
  merges, rebases, stashes or switches branches

#### Scenario: Unshipped work is still visible
- **WHEN** the user ends a session whose worktree has commits that exist only on its branch
- **THEN** the dialog shows the unshipped-work warning and why the worktree is kept, each in one line, and the pull
  option selected

#### Scenario: Cleaning up an ended session
- **WHEN** the user clicks **Clean up** on a session that has already ended
- **THEN** the dialog's headline is **Clean up** with the change's name

## MODIFIED Requirements

### Requirement: Ending a session cleans up a stale change's leftovers
When the user ends or cleans up a change session that has a worktree, and the change is archived on the default branch
as locally known and the session's worktree would be a stale leftover of it once the session has ended (`stale-changes`
capability: "A change that is archived and merged is stale"), the end-session dialog SHALL offer **Clean up leftovers**
in place of the plain worktree removal. It SHALL list the session's worktree and every other stale leftover of the
change, read afresh, with each worktree's uncommitted and untracked paths, and SHALL list the kept leftovers with their
reasons. The note that uncommitted files are copied first and ignored files are deleted without a copy SHALL be the
option's hover description.

The offer SHALL be pre-selected whenever it is made. When any listed uncommitted path lies outside
`openspec/changes/<name>/` and the change's archive directory, those paths SHALL be named in one line with the offer;
confirming with the offer selected is the user's acknowledgement that those files are deleted after a copy is kept. A
choice made in an earlier dialog SHALL NOT carry over.

Confirming with the offer selected SHALL, in this order:
1. end the session;
2. run the stale cleanup for the listed items, with the same server-side re-checks, backups and per-item outcomes as
   **Clean up leftovers…** on the board;
3. run the pull when the pull offer is selected.

So one confirmation ends the session and cleans up. The dialog SHALL report each item's outcome and the backup folder
under the rules for reporting a pull. Confirming with the offer cleared SHALL end the session and keep every leftover,
which stay marked stale on the board. Cancelling SHALL end, remove and pull nothing.

When the change is not stale at that moment — its archive is not on the default branch yet, for example because the
archive's pull request is still open, or its branch holds work the default branch lacks — the dialog SHALL keep the
plain removal offer and its rules. When that removal is not possible, the dialog SHALL say that the worktree is kept and
will be marked stale, with **Clean up leftovers…** on the board, once the change is archived and merged on the default
branch. An in-place session SHALL never get the offer.

#### Scenario: Ending the archive session after the merge
- **WHEN** the user ends the archive session of `rotate-keys`, whose archive is on `origin/main`, whose worktree on
  `chore/archive-rotate-keys` is merged and shows `openspec/changes/rotate-keys/tasks.md` deleted but uncommitted, and
  the merged implementation worktree on `feat/rotate-keys` is still there
- **THEN** the dialog offers Clean up leftovers, already selected, listing both worktrees and that file, and one
  confirmation ends the session, copies the file under `~/.spec-control/branch-backups/` and removes both worktrees
  and their branches

#### Scenario: A source file outside the change
- **WHEN** the session's merged worktree also holds an uncommitted edit to `src/keys.ts`
- **THEN** Clean up leftovers is offered and already selected, `src/keys.ts` is named with it, and confirming copies
  `src/keys.ts` under `~/.spec-control/branch-backups/` before the worktree is removed

#### Scenario: Leftovers kept by clearing the offer
- **WHEN** the user clears Clean up leftovers and confirms
- **THEN** the session ends and every leftover is kept and stays marked stale on the board

#### Scenario: Pull request still open
- **WHEN** the user ends the archive session while its pull request is open and the archive is not on `origin/main`,
  and the worktree has an uncommitted file
- **THEN** no cleanup is offered, the worktree is kept, and the dialog says it will be marked stale once the archive
  is merged into the default branch

#### Scenario: A changed item after the dialog
- **WHEN** another worktree listed in the offer receives a new commit before the user confirms
- **THEN** the session ends, that worktree is kept and reported as changed since the user looked, and the session's own
  worktree is still cleaned up
