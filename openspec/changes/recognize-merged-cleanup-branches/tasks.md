# Tasks

## 1. Scoped implementation and verification

- [ ] 1.1 Extend parsed/cached merged PR evidence with exact head and merge commit identity needed for cleanup; verify same-repository/default-base matching and backwards-compatible records without starting network activity from preview.

- [ ] 1.2 Accept exact merged-head evidence whose merge commit is reachable from the local base in addition to ancestry/content proofs; verify squash/rebase followed by edits, post-merge branch commits, old same-name PRs, fork/wrong-base cases, and unfetched merges.

- [ ] 1.3 Represent stale-record pruning as a branch dependency and re-evaluate after pruning in one confirmed operation; verify successful prune/deletion, failed prune retention, changed heads, concurrent sessions, and restoration commands.

- [ ] 1.4 Show evidence freshness, specific blockers, and relevant next actions for kept branches; verify all nondefault branches appear and dirty worktree/external-lock/default-main protections stay intact; update cleanup Help and demo examples.

- [ ] 1.5 Verify the change with focused tests appropriate to its touched behavior, then run bun run check before pushing; record results.

- [ ] 1.6 Add an independent What's new JSON entry under src/ui/changelog/entries/ for this change only; verify its filename/id and summary with the repository changelog validator.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
