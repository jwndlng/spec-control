# Tasks

## 1. Detection (server)

- [x] 1.1 Replace `SettledWorktree`/`SessionWorktree.settled` with `StaleLeftovers` (`archive`, `leftovers` of kind `worktree`/`branch`/`main`, `kept`) as `stale?` on `ChangeSnapshot` in `src/shared/types.ts`; verify with `bun run typecheck`
- [x] 1.2 Add `changeBranches` (recorded `branch`/`archive-branch` when the snapshot carries them, else from the archive's `.openspec.yaml` on the base via `cat-file`; `sessionBranch` names; session records' branches; exact, de-duplicated, invalid names dropped) and verify with unit tests for the recorded and containment scenarios
- [x] 1.3 Switch `findStrandedArchives` to `changeBranches` (remote-tracking refs matched without their remote prefix); verify with the existing stranded tests plus "A branch that only contains the name"
- [x] 1.4 Implement `staleLeftovers` in `src/server/staleChanges.ts` (worktree, branch and main-checkout leftovers, merged by `rev-list` or `contentIsInBase`, running sessions kept, name-reuse rule, paths capped at 200), call it from the scan, and remove `settledArchive` and its call in `src/server/sessions/workStatus.ts`; verify with `test/staleChanges.test.ts` against temp git repositories for every scenario of "A change that is archived and merged is stale"

## 2. Cleanup (server)

- [x] 2.1 Add `previewStaleCleanup` (with `ending`) and `applyStaleCleanup` to `src/server/cleanup.ts`: per-item re-checks, `deleteBranch` per worktree, merged `branch -D` per branch, backup of differing files and the dismissal's deletion and `git add --all` (`src/server/dismissChange.ts`) for the main-checkout copy, the repository's cleanup lock, per-item outcomes; verify with `test/cleanup.test.ts` for the two-leftover, inside-only, main-checkout, changed-item, archive-gone and remote-untouched scenarios
- [x] 2.2 Add `GET`/`POST /api/repos/<id>/changes/<name>/stale-cleanup` in `src/server/api.ts` behind `crossSiteRefusal`; verify with an API test including `?ending=`, foreign origin, non-leftover item and missing acknowledgement

## 3. Prevention

- [x] 3.1 Append the commit-the-whole-move clause to `ARCHIVE_TAIL` in `src/shared/agentDefaults.ts` and add the previous Archive prompts to each preset's former prompts; verify with the agent-defaults tests (new text, verbatim upgrade, edited prompt kept)

## 4. Session end (UI)

- [x] 4.1 In `src/ui/endSessionDialog.tsx` fetch the `?ending=` preview for a session whose change is archived on the base; show Clean up leftovers in place of the removal offer (pre-selected only when every uncommitted path is inside the change's directories), confirm as end → cleanup → pull, report per-item outcomes and the backup folder; say the worktree will be marked stale when the change is not stale yet and removal is not possible; verify with dialog-state tests in `test/` for the four session-end scenarios
- [x] 4.2 Keep the in-place and plain-removal paths unchanged; verify with the existing end-session tests

## 5. Board and detail (UI)

- [x] 5.1 Update `staleReason` and `staleHint` in `src/ui/staleState.ts` (counts of worktrees, branches, main-checkout copies and uncommitted files; Pull hint when not pulled); verify with `test/staleState.test.ts`
- [x] 5.2 Add `src/ui/staleCleanup.tsx` (shared list component also used by the end-session dialog) and open it from the notice in `src/ui/changeDetail.tsx` in place of Remove worktree…; update the badge title in `src/ui/kanban.tsx`; verify with `bun run check` and a state test that the column is unchanged

## 6. Documentation

- [x] 6.1 Update invariant 1 in `CLAUDE.md` (entries for the forced deletion and the dismissal write) and the stale and end-session sections of `src/ui/helpContent.tsx`; verify with `bun run check`
- [x] 6.2 Add a What's new entry at the top of `src/ui/changelog.ts`; verify with `bun run check`

## 7. Verification

- [x] 7.1 Run `bun run check` and `bun run build`, and verify the compiled binary starts and the stale-cleanup routes answer
- [~] 7.2 Confirm on a real repository that ending an archive session after its merge cleans up both worktrees, the branches and the main checkout's staged copy with backups (needs the user's repositories)
