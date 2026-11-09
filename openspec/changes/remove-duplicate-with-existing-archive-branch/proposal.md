# Remove a duplicate when its archive branch still exists

## Why

An archived change can remain committed beside its archive on the default branch while the original
`chore/archive-<name>` branch is still present locally. Today that branch hides the Remove duplicate action, even when the
two copies are identical and cleanup is safe to run on a new branch.

## What changes

Offer Remove duplicate whenever the change has no running session. If the original archive branch exists or is checked
out, create the cleanup session on `chore/remove-duplicate-<name>` in a separate worktree. Preserve the original branch
and worktree. Refuse only when the dedicated cleanup branch is already present or checked out.

## Impact

- `openspec/specs/stale-changes/spec.md`
- `openspec/specs/dashboard-api/spec.md`
- `src/shared/types.ts`
- `src/server/staleChanges.ts`
- `src/server/sessions/manager.ts`
- `src/ui/staleState.ts`
- `test/removeDuplicate.test.ts`
- `test/staleState.test.ts`
