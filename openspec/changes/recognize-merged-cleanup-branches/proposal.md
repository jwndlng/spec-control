# Proposal: Recognize merged branches and resolve cleanup dependencies in one pass

## Why

Squash/rebase merges followed by later base edits can defeat cleanup's ancestry/content proofs, and stale worktree records currently require a second cleanup pass.

## What Changes

- Accept exact merged PR head evidence when the merge commit is reachable from the locally known base.
- Keep dirty work, running agents, external locks, changed heads, and main/default branches protected.
- Model stale-record pruning as a dependency and re-evaluate branches in the same confirmed operation.
- Explain missing evidence separately from proven additional work and offer relevant recovery actions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `repository-cleanup`: Additional merge proof, stale-record dependencies, and actionable kept reasons.

## Impact

- `src/server/cleanup.ts`
- `src/server/pullRequests.ts (cached merged evidence fields only)`
- `src/shared/types.ts (cleanup/evidence contracts)`
- `src/ui/cleanup.tsx`
- `src/ui/cleanupState.ts or corresponding existing selection helpers`
- `src/ui/demo/`
- `src/ui/helpContent.tsx`
- `test/cleanup.test.ts and PR parser/UI fixtures`
- `src/ui/changelog/entries/`

## Dependencies and session ownership

Required predecessors: None. Start the implementation session in this change's dedicated worktree and merge predecessors first. Shared files are owned only for the listed concern; do not refactor neighboring functionality. Refresh against latest origin/main before implementation and re-read predecessor contracts.

Shared-file landing order and external proposal overlaps are documented in SESSION.md. Implement only this change, never the former umbrella.
