# Reviewer notes

Cleanup can select a branch together with its stale worktree record and prune
the record before rechecking/deleting the branch in one confirmation. Failed
pruning keeps the branch; moved heads and running sessions remain protected.
Selection dependencies, the demo, Help, and a What's new entry cover this flow.

Cleanup also accepts fresh cached, same-repository/default-base PR evidence
when the branch head matches exactly and the merge commit is in the local base,
including squash/rebase merges followed by later base edits. Stale, fork,
wrong-base, and changed-head evidence does not prove a merge. Kept branches show
evidence age and next steps; preview never fetches or queries GitHub.

Active-change protection and main's independent age-based eligibility for old
unrelated work are preserved, as confirmed by the user. Five of six tasks are
complete; full-check verification remains unresolved. Nothing has been pushed.

Checks run:

- Focused cleanup, parser/cache, UI, demo and changelog suite: 106 passed.
- `bun test test/cleanupApi.test.ts`: 5 passed, including cache-only proof with no gh calls.
- `bun run build` and compiled cleanup API smoke passed: exact PR proof after
  later base edits, removal/deletion, and no gh calls.
- `openspec validate recognize-merged-cleanup-branches --strict` passed.
- `bun run check`: lint passed; typecheck failed with 16 errors in untouched
  files (`sessions/manager.ts`, `sessions/taskSummary.ts`, `ui/changeDetail.tsx`,
  `ui/sessions.tsx`, `test/shipPreflightUi.test.tsx`). Missing symbols include
  `shipPreviews`, `artifactsReady`, and `ShipPreflight`; tests were not reached.
