The Backlog timeline omits the Fast-forward route banner while Fast-forward remains in the action menu with its existing confirmation. This change updates the requirement and adds a rendered Backlog regression test. Scanner scheduling tests now use minimal temporary repositories, and API tests avoid redundant full-fixture scans.

## Verification

- `bun run check` passed. Lint and typecheck completed, and all 2,505 tests passed across 202 files.
- `openspec validate remove-fast-forward-banner --strict` passed.
- `bun test test/lifecycleTimeline.test.ts` passed all 28 tests.
