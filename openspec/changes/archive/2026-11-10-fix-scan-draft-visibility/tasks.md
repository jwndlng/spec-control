## 1. Restore visibility and scan efficiency
- [x] 1.1 Remove the worktree count cap, cover more than twelve unique drafts, reuse resolved paths and bound concurrency of stale detection, and update Help.
- [x] 1.2 Run focused regression tests, the full check, build, and a read-only profile confirming missing drafts are scanned.

## Verification results
- Scanner tests: 38 pass; fifteen-worktree visibility regression passes; compiled build and typecheck pass.
- Full check with a 30-second test timeout: 2,319 pass, one unrelated pull-request freshness test fails and passes when rerun alone. The full check did not exit successfully; no push or deployment was performed.
- Read-only scan through the actual repository deadline completes in 28 seconds and includes the five previously omitted changes. Very large or busy repositories can still exceed the deadline.
