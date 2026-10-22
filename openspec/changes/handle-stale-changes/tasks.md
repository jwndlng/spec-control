# Tasks

## 1. Detection (server)

- [x] 1.1 Add `StrandedArchive` (`branch`, `archive`, `commit`) as `strandedArchive?` on `ChangeSnapshot` and `SettledWorktree` (`archive`, `uncommitted`) as `settled?` on `SessionWorktree` in `src/shared/types.ts`; verify with `bun run typecheck`
- [x] 1.2 Implement `findStrandedArchives` in `src/server/staleChanges.ts` (for-each-ref, ls-tree, log; candidate rules, cap, base and main-checkout exclusions, name-reuse rule, ordering) and verify with `test/staleChanges.test.ts` against temp git repositories covering every scenario of "A change whose archive is stranded on a branch is reported"
- [x] 1.3 Call it from the scan through an optional `RepoSource.strandedArchives` (implemented by `LocalRepoSource`) for active changes of git repositories with a commit, attaching the result without touching stage or column; verify with a scanner test that a fixture repository with a stranded archive branch reports it and keeps the column
- [x] 1.4 Implement `settledArchive` in `src/server/staleChanges.ts` and call it from `listWorktrees` for worktrees without a running session; verify with tests for the settled, outside-file and running-session scenarios

## 2. Carry-over archive session (server)

- [x] 2.1 Add the fixed `CARRY_OVER_ARCHIVE_PROMPT` and `carryOverPrompt` (re-validating commit and branch) and verify with a unit test of the composed text, with and without the auto-merge archive instruction
- [x] 2.2 Accept `carryOver: true` with `action: "archive"` in `SessionManager.open` and `POST /api/sessions`: require the scan's `strandedArchive`, skip only the stage check, use the carry-over prompt; verify with a session test using the fake agent (prompt typed, worktree on the archive branch) and a refusal test for a change without a stranded archive

## 3. Board and detail (UI)

- [x] 3.1 Add `src/ui/staleState.ts` (`staleReason`) and verify with `test/staleState.test.ts` for both kinds and for none
- [x] 3.2 Show the Stale badge on the card (`src/ui/kanban.tsx`, styles) with the reason as title and accessible name; verify with a render or state test that the badge appears and the column is unchanged
- [x] 3.3 Show the stale notice in the change detail with Remove worktree… (opening `DeleteBranchDialog` for the settled worktree, with its note) and Carry over archive (via `api.startSession` with `carryOver`), falling back to naming branch and commit without sessions; verify with `bun run check`
- [x] 3.4 Add help text and a What's new entry; verify with `bun run check`

## 4. Verification

- [x] 4.1 Run `bun run check` and `bun run build`, and verify the compiled binary starts and serves the board
- [~] 4.2 Confirm on a real repository that a stranded archive and a settled worktree are marked and their actions work (needs the user's repositories)
