# Proposal

## Why

"We archive a change and then suddenly there is still uncommitted or left-over stuff." That is the pain this change
addresses. `handle-stale-changes` introduced a **settled** worktree, but the rule is narrow: a session worktree only
counts when every uncommitted file lies inside the change's own directory, and only worktrees under
`~/.spec-control/worktrees/` are looked at. Several kinds of leftover fall outside it and just sit there:
- the archive worktree whose agent committed the new archive directory but not the removal of the old one;
- the implementation worktree with a stray edit after its pull request merged;
- a worktree the user made by hand on `feat/<name>`;
- a local branch whose worktree is already gone;
- the change directory the dashboard created and staged in the main checkout, which nobody ever commits there.

Clean up refuses them because they might hold work. Ending the session that produced them offers nothing either.

The user's definition is simpler: **a change is stale when it is archived and merged.** Once both hold, nothing its
leftovers hold is still needed on its branches. Uncommitted files might still matter to someone, so they are copied
before anything goes, but they no longer keep the leftover around. The best moment to clean up is when the user ends
the session, so that is where the cleanup is offered first.

## What Changes

- **A change's branches are named exactly.** The recorded `spec-control.branch` and `spec-control.archive-branch` (from
  `record-change-pull-request`), `feat/<name>`, `chore/archive-<name>`, and the branches of the dashboard's session
  records for the change. No containment. The stranded-archive search switches to the same exact list.
- **Stale means archived and merged.** A change is stale when the default branch as locally known holds its archive and
  at least one leftover is merged. Leftovers are:
  - a linked worktree or local branch on one of its branches;
  - the main checkout's copy of `openspec/changes/<name>/` when none of its files was ever committed there.

  Merged is work status's rule, squash merges included, and it is derived on every scan, never stored. Uncommitted
  files no longer save a merged leftover. A running session or unmerged work keeps one, with the reason.
- **Clean up at session end.** Ending a session of a change that is archived and merged replaces the plain worktree
  removal with **Clean up leftovers**. It lists the session's worktree and the change's other leftovers with their
  uncommitted files, and is selected by default when every such file lies inside the change's own directories. One
  confirmation ends the session, cleans up with backups, then pulls. When the archive is not merged yet (its pull request
  still open), the worktree is kept as today and the dialog says it will be marked stale once merged.
- **Clean up from the board.** The Stale badge stays. **Clean up leftovers…** in the change detail runs the same cleanup
  for anything the session end did not catch.
- **The cleanup reuses existing writes.**
  - **Worktrees:** the branch-and-worktree deletion's re-checks, backup under `~/.spec-control/branch-backups/`,
    `git worktree remove --force` and `git branch -D` at the commit shown.
  - **Branches without a worktree:** the cleanup's merged `git branch -D`.
  - **The main checkout's copy:** the dismissal's directory deletion and `git add --all`, after copying the files that
    differ from the archive.

  Items are re-checked one by one. One that changed is skipped and reported, and the rest go ahead. Remote branches and
  remote-tracking refs are never touched. Session records stay, ended, as history.
- **Prevention, minimal.** The preconfigured Archive prompts gain one clause: include in the commit every file the
  archive moved or removed. The previous text is read as the current one, as for earlier prompt updates. No other
  prompt changes.
- **The settled rule is removed.** Stranded archive and Carry over archive stay; only their branch search becomes exact.
- No new git subcommand and no network. Invariant 1 entries (6) and (7) widen in wording only: the forced deletion
  covers each worktree confirmed in the deletion dialog or a stale cleanup, and the dismissal write also covers a stale
  main-checkout copy.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `stale-changes`: exact branches; the settled-worktree requirement is replaced by "archived and merged" with
  worktree, branch and main-checkout leftovers; the cleanup on one confirmation; the stranded-archive search uses exact
  branches; the badge and the detail action change.
- `agent-sessions`: the end-session dialog offers the stale cleanup; the preconfigured Archive prompt asks for the
  whole move to be committed.
- `dashboard-api`: stale-cleanup preview and apply endpoints (with an `ending` preview for the end-session dialog);
  "never writes" entries (6) and (7) worded for the stale cleanup.

## Impact

- `src/server/staleChanges.ts`: `changeBranches` (exact list), `staleLeftovers` replacing `settledArchive`, and
  `findStrandedArchives` switched to exact branches.
- `src/server/frameworks/openspec/`: reads `spec-control.branch` and `spec-control.archive-branch`. The key and its
  reader are owned by `record-change-pull-request`; this change only uses the neutral snapshot fields it adds.
- `src/server/sessions/workStatus.ts`: the `settled` call is removed.
- `src/server/cleanup.ts`: `previewStaleCleanup`/`applyStaleCleanup`, reusing `deleteBranch` per worktree and the
  merged `branch -D` per branch. `src/server/dismissChange.ts`: the deletion step reused for the main-checkout copy.
- `src/server/api.ts`: `GET`/`POST /api/repos/<id>/changes/<name>/stale-cleanup`.
- `src/shared/types.ts`: `StaleLeftovers` on `ChangeSnapshot`; `SettledWorktree` removed.
- `src/shared/agentDefaults.ts`: the Archive tail clause and the former Archive prompts.
- End-session dialog: `src/ui/endSessionDialog.tsx`, `src/ui/sessionState.ts`, `src/ui/api.ts`.
- Board: `src/ui/staleState.ts`, `src/ui/kanban.tsx`, `src/ui/changeDetail.tsx`, `src/ui/staleCleanup.tsx` (new),
  `src/ui/styles.css`.
- `src/ui/helpContent.tsx`, `src/ui/changelog.ts`, `CLAUDE.md` (invariant 1 wording).
- Tests: `test/staleChanges.test.ts`, `test/staleState.test.ts`, `test/cleanup.test.ts`, the end-session dialog state,
  agent defaults and an API test for the stale-cleanup routes.
- **Overlaps:**
  - `record-change-pull-request` owns the metadata keys. Until it lands, the exact list is the fixed names plus the
    session records' branches.
  - `one-next-action-per-stage` may also modify agent-sessions' "Session starters run a fixed prompt for a validated
    change". Whichever archives second must merge the two texts.
