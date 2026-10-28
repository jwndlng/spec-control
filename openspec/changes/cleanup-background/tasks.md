# Tasks

## 1. Background cleanup lifecycle

- [ ] 1.1 Separate session termination from confirmed cleanup execution, and verify with lifecycle tests that cleanup starts only after session termination succeeds.
- [ ] 1.2 Track cleanup operation state and completion across dashboard reloads, and verify with tests that an interrupted operation is reported accurately and can be safely retried.
- [ ] 1.3 Preserve cleanup rechecks, backup behavior and per-item outcomes in background execution, and verify with tests covering changed worktrees and cleanup failures.

## 2. End-session experience

- [ ] 2.1 Close the end-session dialog after successful session termination when cleanup continues, and verify the user can interact with the dashboard while cleanup is pending.
- [ ] 2.2 Report background cleanup completion and failure outside dialog-local state, and verify a result cannot affect another session's dialog.
- [ ] 2.3 Update the relevant agent-session UI tests and user-facing Help text, and verify they cover the pending, completed and failed cleanup states.
- [ ] 2.4 Add a What's new entry at the top of `src/ui/changelog.ts` and verify the changelog shape and order checks pass.

## 3. Integration

- [ ] 3.1 Run `bun run check` and verify the full lint, typecheck and test suite passes.
