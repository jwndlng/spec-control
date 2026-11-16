## Why
Changes that exist only in older worktrees disappear from the board once a repository exceeds twelve worktrees. Repeated path resolution across all archived changes also makes scans exceed their thirty-second deadline.

## What Changes
- Read all eligible linked worktrees with bounded concurrency and existing per-worktree failure isolation.
- Resolve linked worktree paths once during stale-leftover detection, rather than once per archived change, and inspect archived changes with bounded concurrency.
- Document that unreadable worktrees and scan failures can leave the board incomplete.

## Capabilities
### Modified Capabilities
- `change-scanner`: do not omit readable worktrees solely because newer ones exist.

## Impact
- `src/server/scanner.ts`, `src/server/staleChanges.ts`
- `test/worktreeScan.test.ts`, `test/scanner.test.ts`, existing stale-change regression tests
- `src/ui/helpContent.tsx`
- `openspec/changes/fix-scan-draft-visibility/`
