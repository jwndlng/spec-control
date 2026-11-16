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
unrelated work are preserved.

Checks run:

- `bun run check`: lint, typecheck and all 2,381 tests passed after merging main's verification fixes.
- Focused cleanup, API, parser/cache, UI, demo and changelog suite: 111 passed.
- `bun run build` and compiled cleanup API smoke passed: exact PR proof after
  later base edits, removal/deletion, and no gh calls.
- `openspec validate recognize-merged-cleanup-branches --strict` passed.
