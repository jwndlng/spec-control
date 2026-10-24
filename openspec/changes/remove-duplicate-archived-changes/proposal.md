# Proposal

## Why

An archive can reach the default branch while the change it archived stays there too: the archive commit added
`openspec/changes/archive/<YYYY-MM-DD>-<name>/` but never removed `openspec/changes/<name>/`. Both are then committed,
side by side, on the default branch — a **duplicate after archive**. This repository has one right now:
`add-validate-phase` is on `main` both as `openspec/changes/add-validate-phase/` and as
`openspec/changes/archive/2026-09-29-add-validate-phase/`, the two differing in two lines of `tasks.md`.

Nothing in the dashboard handles it:

- The scanner folds the main checkout's active copy into the archived card (`foldLeftovers`), so the board shows one
  archived change — correct — but the detail's "active copy left" hint says the copy *usually holds files that were never
  committed* and tells the user to remove it, which is wrong for a committed copy: removing it in the main checkout leaves
  a staged deletion there that nobody commits.
- `stale-means-archived-and-merged` treats the active directory as a leftover only when **none** of its files is in the
  main checkout's commit. A committed duplicate is not a leftover and is never cleaned up.
- The dashboard never commits, so it cannot remove a committed directory itself. Every pull brings the duplicate back.

## What Changes

- **Detection.** For every enabled git repository with a commit, the scan reports a change as a **duplicate after
  archive** when the default branch as locally known holds both `openspec/changes/<name>/` and an archive of that name,
  and the active copy was not created after the archive's date. It reports the archive directory and the files whose
  content differs between the two copies (capped). Read-only git (`ls-tree`, `diff`, `cat-file`), no remote, no new
  subcommand. Stage, column and counts are unchanged: the card stays the archived one it already is.
- **Board.** The archived card shows the **Stale** badge with this reason, and the detail's "active copy left" hint says
  that the copy is committed next to its archive on the default branch instead of calling it uncommitted.
- **Remove duplicate.** The detail notice offers **Remove duplicate** where agent sessions are enabled and no session for
  the change runs: an archive session, on the archive session's branch `chore/archive-<name>`, with a fixed opening
  prompt that names the change, the archive directory and the differing files and asks the agent to show the user what
  the active copy holds that the archive lacks, carry into the archive only what the user confirms, delete
  `openspec/changes/<name>/`, then commit, push and open a docs-only pull request. The docs auto-merge archive
  instruction and auto-merge record apply as for any archive session, so a project with docs auto-merge gets it merged
  and the session ended by the existing flows. The server takes everything from its own last scan, never from the
  request. Where sessions are not available the notice names the directory to delete in a commit by hand.
- **No new write.** The dashboard writes nothing to the repository for this; invariant 1 is unchanged.

## Non-goals

- A change whose active directory is committed in the main checkout's `HEAD` while the default branch already removed it:
  pulling resolves it, and the pull action already covers that.
- Dismiss change as the way out: it deletes the directory in the main checkout and stages the deletion, leaving
  uncommitted state in the one checkout nobody edits.
- The dashboard committing or pushing anything.
- Preventing the cause: `stale-means-archived-and-merged` already appends "include in your commit every file the archive
  moved or removed" to the Archive prompts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `stale-changes`: a duplicate after archive is reported, marked on the board and offered Remove duplicate.
- `dashboard-api`: the session start request accepts `removeDuplicate`, checked against the last scan.

## Impact

- `src/server/staleChanges.ts` (detection), `src/server/scanner.ts` (call it), `src/shared/types.ts` (`duplicate?` on
  `ChangeSnapshot`, the start request flag)
- `src/server/sessions/manager.ts`, `src/server/sessions/agents.ts` (the fixed prompt, refusals)
- `src/server/api.ts` (pass the flag through)
- `src/ui/staleState.ts`, `src/ui/format.ts` (`leftoverHint`), `src/ui/changeDetail.tsx`, `src/ui/kanban.tsx`
- `src/ui/demo/` (one demo duplicate), `src/ui/changelog.ts`
- `test/staleChanges.test.ts`, `test/sessions*.test.ts`, `test/staleState.test.ts`

## Order and overlaps

- Builds on `stale-means-archived-and-merged` (not archived yet): it adds requirements next to that change's stale
  requirements and modifies none of them, so either can be archived first. Both edit `src/server/staleChanges.ts`,
  `src/ui/staleState.ts` and the detail notice; whichever is implemented second rebases.
- Uses the archive branch that `record-change-pull-request` and the pull-request link already treat as a candidate, so
  the pull request it opens is linked to the change with no change to the link rule.
