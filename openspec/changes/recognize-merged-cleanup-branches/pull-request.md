# Reviewer notes

This branch adds the proposal, design, spec delta, and task list for
`recognize-merged-cleanup-branches`. It delivers no runtime changes.

Implementation remains incomplete (0/6 tasks): merged PR merge-commit identity is
not parsed/cached (1.1), cleanup still uses only ancestry/content proofs (1.2),
and stale worktree records still require a second cleanup pass (1.3). Evidence
freshness/recovery UI, Help/demo updates (1.4), feature-specific regression tests
(1.5), and this change's What's new entry (1.6) are absent. These require
implementation work; none requires a user-only check.

Checks run:

- `openspec validate recognize-merged-cleanup-branches --strict` passed.
- `bun test test/cleanup.test.ts test/cleanupApi.test.ts test/cleanupUi.test.ts test/pullRequests.test.ts test/pullRequestsApi.test.ts test/whatsNew.test.ts`
  passed outside the sandbox: 84 tests, 0 failures. These cover existing behavior,
  not the unimplemented requirements above.
- After merging current `main`, `bun run check` passed outside the sandbox:
  lint, typecheck, and 2,347 tests (0 failures). The earlier prompt-migration
  failure is fixed by `main`; the earlier scanner timeouts did not recur.
