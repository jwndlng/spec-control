# Proposal

## Why

Repositories with many linked worktrees can have relevant changes and checkout status omitted from the dashboard once the scanner reaches its current cap. Raise the cap so those repositories show more complete information while retaining bounded, failure-isolated scanning.

## What Changes

- Inspect up to 50 linked worktrees per repository for change data and checkout status.
- Keep the existing bounded concurrency, timeouts, and behavior for additional worktrees.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-scanner`: raise the maximum inspected linked worktrees from 12 to 50.

## Impact

- `src/server/scanner.ts` worktree inspection limits.
- `openspec/specs/change-scanner/spec.md` requirement and scenario.
- Scanner worktree tests.
