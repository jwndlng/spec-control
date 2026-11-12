## Why
Repository cleanup currently keeps every unmerged branch, even when no active OpenSpec change uses it and its latest commit is old. This makes cleanup overlook branches and worktrees that no longer represent active work.

## What Changes
- Keep worktrees and branches associated with active change directories.
- Keep unmerged work with a commit in the last 30 days.
- Offer older unrelated work and merged branches/worktrees for cleanup, while preserving dirty, running, locked, main and stale-record safeguards.

## Capabilities
### Modified Capabilities
- `repository-cleanup`: determine cleanup eligibility from active-change association, merge state and recent commit time.

## Impact
- `src/server/cleanup.ts`
- `src/server/api.ts` (equivalent optional-chain form to keep repo lint passing)
- `test/cleanup.test.ts`
