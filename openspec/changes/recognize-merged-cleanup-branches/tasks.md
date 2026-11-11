# Tasks

## 1. Scoped implementation and verification

- [x] 1.1 Extend parsed/cached merged PR evidence with exact head and merge commit identity needed for cleanup; verify same-repository/default-base matching and backwards-compatible records without starting network activity from preview. Verified by parser/cache, cleanup and API tests, including a cache-only restart and no gh calls.

- [x] 1.2 Accept exact merged-head evidence whose merge commit is reachable from the local base in addition to ancestry/content proofs; verify squash/rebase followed by edits, post-merge branch commits, old same-name PRs, fork/wrong-base cases, and unfetched merges. Regression cases passed. User confirmed preserving main's independent age-based eligibility; proposal, design and spec now record that decision.

- [x] 1.3 Represent stale-record pruning as a branch dependency and re-evaluate after pruning in one confirmed operation; verify successful prune/deletion, failed prune retention, changed heads, concurrent sessions, and restoration commands. Verified by the focused cleanup/server and selection tests (6 passed).

- [x] 1.4 Show evidence freshness, specific blockers, and relevant next actions for kept branches; verify all nondefault branches appear and dirty worktree/external-lock/default-main protections stay intact; update cleanup Help and demo examples. Cleanup, UI row, selection and demo tests passed; Help explains cached proof, age-based eligibility and refresh/Pull actions.

- [ ] 1.5 Verify the change with focused tests appropriate to its touched behavior, then run bun run check before pushing; record results. Focused parser, prune, selection, demo and changelog checks passed. Full check fails in untouched files on current main; typecheck separately reports missing SessionManager.shipPreviews, artifactsReady, ChangePermissionPicker, ShipChoice/setShipAsk, and ShipPreflight/preview/click. Feature verification also awaits 1.2.

- [x] 1.6 Add an independent What's new JSON entry under src/ui/changelog/entries/ for this change only; verify its filename/id and summary with the repository changelog validator. The 2026-11-11-recognize-merged-cleanup-branches entry passes test/whatsNew.test.ts; it describes the delivered one-pass pruning behavior.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
