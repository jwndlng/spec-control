# Tasks

## 1. Session state and eligibility

- [x] 1.1 Implement `canEndArchivedSession` in `src/ui/sessionState.ts` checking that the change is archived, its session is running and not auto-ended, and either its pull request is merged or its session worktree is merged; verify with unit tests in `test/sessionState.test.ts`
- [x] 1.2 Export and test helper functions for archived session controls; verify with tests covering unmerged pull requests, active changes, auto-ended sessions, and missing worktrees

## 2. Card UI

- [x] 2.1 Update `SessionControls` in `src/ui/sessions.tsx` to render the **End session** button on the card (`place === "card"`) beside the running session badge when eligible, wiring it to `ui.requestEnd(session.id)`; verify with tests in `test/kanban.test.ts` or `test/sessionControls.test.ts`
- [x] 2.2 Ensure the button is not offered for active (non-archived) changes or sessions that have already been automatically ended; verify with component tests

## 3. Verification and changelog

- [x] 3.1 Run `bun run check` and `bun run test` to verify all lint checks, type checks, and tests pass — Verified 2026-11-05 with pinned Bun 1.4.2 after incorporating main’s blocker fixes: full `bun run check` passed (2,261 tests, including the latest custom-session merge and the CI version-test isolation fix); focused `bun run test` passed (31 tests); binary and demo builds passed.
- [x] 3.2 Add a What's new entry at the top of `src/ui/changelog.ts` (see "What's new" in CONTRIBUTING.md) describing that archived changes whose pull request merged offer **End session** directly on the card; verify it appears in the What's new list
