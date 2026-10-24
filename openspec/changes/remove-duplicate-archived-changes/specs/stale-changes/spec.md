## ADDED Requirements

### Requirement: A change committed next to its archive is reported as a duplicate
For every enabled git repository with at least one commit, the scan SHALL report a change as a **duplicate after
archive** when the default branch as locally known (`origin/HEAD`, else the main checkout's `HEAD`) holds both
`openspec/changes/<name>/` and an archive `openspec/changes/archive/<YYYY-MM-DD>-<name>/`, and the active copy's
`created` date on that branch is not later than the archive's date. Of several archives of the name the newest SHALL
count. An active copy without a readable `created` date SHALL count as not later. The report SHALL name the archive
directory and list the paths whose content differs between the active copy and the archive, at most 50 plus their total
number.

The detection SHALL read only the default branch's tree with read-only git (`ls-tree`, `cat-file`, `diff`), SHALL NOT
contact a remote, and SHALL NOT read or change any working tree or index. It SHALL NOT change the change's stage, column
or any count. A git failure for one change SHALL leave that change's report out and fail nothing. A repository without
git or without a commit reports nothing.

#### Scenario: Archive merged with the active directory still committed
- **WHEN** `origin/main` of `demo-ops` holds `openspec/changes/rotate-keys/` created 2026-10-01 and
  `openspec/changes/archive/2026-10-20-rotate-keys/`, and the two differ only in `tasks.md`
- **THEN** the scan reports `rotate-keys` as a duplicate after archive naming `2026-10-20-rotate-keys` and `tasks.md`

#### Scenario: A new change reusing the name
- **WHEN** `origin/main` holds `openspec/changes/rotate-keys/` created 2026-11-02 and
  `openspec/changes/archive/2026-10-20-rotate-keys/`
- **THEN** no duplicate is reported and `rotate-keys` is an active change as before

#### Scenario: Only the main checkout still has it
- **WHEN** the main checkout's `HEAD` holds `openspec/changes/rotate-keys/` next to its archive but `origin/main` no
  longer holds the active directory
- **THEN** no duplicate is reported: pulling resolves it

#### Scenario: Identical copies
- **WHEN** both copies hold the same files with the same content
- **THEN** the duplicate is reported with no differing paths

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
is not offered — for an existing archive branch, that **Clean up leftovers…** removes it when it is merged. It starts an
archive session for the change in its own worktree on the archive session's branch, created from the default branch,
whose opening prompt is a fixed text that names the change, the archive directory and the differing paths, and asks the
agent: to show the user, for each differing path, what the active copy holds that the archive lacks; to carry into the
archive only what the user confirms; to delete `openspec/changes/<name>/`; and to commit, push and open a pull request
that changes only files under `openspec/`. The docs auto-merge archive instruction and the auto-merge record SHALL apply
under the same conditions as for any archive session. Where sessions are not available, the notice SHALL name the
directory to delete and say that the deletion has to be committed to the default branch.

The server SHALL start a remove-duplicate session only when its own last scan reports a duplicate for that change and
SHALL take the archive directory and the differing paths from that scan, never from the request; a request for a change
without one, or while the archive branch exists, is refused with the reason and starts nothing. The dashboard itself
SHALL write nothing to the repository for this action and run no git command beyond those of any archive session's
worktree; in particular it MUST NOT delete the active directory, stage anything in the main checkout or commit.

#### Scenario: The card stays archived
- **WHEN** `rotate-keys` is reported as a duplicate and the main checkout has pulled `origin/main`
- **THEN** one card for `rotate-keys` is shown in `Archived` with a Stale badge saying `openspec/changes/rotate-keys/` is
  still committed next to its archive, and no active card for it appears in `Done`

#### Scenario: Removing the duplicate
- **WHEN** the user presses Remove duplicate on `rotate-keys`, which differs from its archive in `tasks.md`, in a project
  with docs auto-merge on
- **THEN** an archive session starts in a fresh worktree on `chore/archive-rotate-keys` whose prompt names
  `2026-10-20-rotate-keys` and `tasks.md`, asks the agent to confirm with the user what to carry over before deleting
  `openspec/changes/rotate-keys/`, and to open a docs-only pull request; the session carries the auto-merge record

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
