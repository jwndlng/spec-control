# Proposal

## Why

The board shows what the checkouts say, so a change whose work already landed can still look unfinished — and nothing
tells the user why, or what to do about it. Two cases keep happening:

- **A session worktree outlives an archived change.** A session interrupted by a dashboard restart is marked `exited`,
  never auto-ended, and its worktree stays on disk. When it holds an uncommitted edit — even only inside the change's own
  directory, which the archive on the default branch has long replaced — Clean up refuses to remove it, although
  everything it holds is already merged or archived.
- **An archive commit is stranded on a branch.** The agent archived the change on a branch whose implementation pull
  request had already merged, pushed it, and opened no new pull request. While the worktree existed the card showed
  `Archived`; once it was removed the board fell back to the main checkout and the change went back to `Implementing`.

## What Changes

- The scan recognises a **stranded archive**: an active change whose archive (`openspec/changes/archive/<date>-<name>/`)
  exists on a local or remote-tracking branch named after the change, but not in the main checkout or the default
  branch. It reports the branch and the commit that added the archive. Read-only git only (`for-each-ref`, `ls-tree`,
  `log`).
- The worktree listing recognises a **settled worktree**: a session worktree of a change that is archived in the default
  branch, with no session running in it, whose commits are all in the default branch and whose uncommitted files, if
  any, all lie inside that change's own directories. Everything it would lose is already on the default branch.
- The board marks both on the change's card with a **Stale** badge whose title names the reason, and the change detail
  shows the reason with a fitting action:
  - a settled worktree offers **Remove worktree…**, which opens the existing branch-and-worktree deletion dialog for
    that worktree — the same confirmation, backup and checks as from the project details, no new write;
  - a stranded archive offers **Carry over archive**, which starts an archive session whose prompt asks the agent to
    bring that exact commit onto the session's fresh branch with `git cherry-pick` instead of archiving again. The
    commit and branch come from the server's scan, never from the request; the user ships it as any other session.
- No new git write, no new git subcommand, no network access, and no change to columns or counts: a stale change stays
  in the column its checkouts give it, marked.

## Capabilities

### New Capabilities
- `stale-changes`: how stranded archives and settled worktrees are detected, how the board and the change detail mark
  them, and the action each one offers.

### Modified Capabilities
None — the deletion dialog, archive sessions and the read-only git list are reused as specified; the carry-over prompt
is specified in the new capability.

## Impact

- `src/server/staleChanges.ts` (new): stranded-archive and settled-worktree detection, read-only git.
- `src/server/scanner.ts`, `src/server/source.ts`: an optional source method the scan calls for active changes.
- `src/server/sessions/workStatus.ts`: settled detection per listed worktree.
- `src/server/sessions/manager.ts`, `src/server/sessions/agents.ts`, `src/shared/agentDefaults.ts`, `src/server/api.ts`:
  the carry-over archive session (`carryOver` on `POST /api/sessions`) and its fixed prompt.
- `src/shared/types.ts`: `StrandedArchive` on `ChangeSnapshot`, `settled` on `SessionWorktree`.
- `src/ui/staleState.ts` (new), `src/ui/kanban.tsx`, `src/ui/changeDetail.tsx`, `src/ui/api.ts`, `src/ui/styles.css`:
  the badge, the notice and its actions; `src/ui/deleteBranch.tsx` opened from the detail.
- `src/ui/helpContent.tsx`, `src/ui/changelog.ts`: help and what's new.
- Tests: `test/staleChanges.test.ts`, `test/staleState.test.ts`, session and API tests for carry-over.
