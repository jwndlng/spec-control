## Why

Repositories with many archives and worktrees can exceed the scan deadline. Stale-leftover detection repeats worktree path resolution for every archive and checks archives one at a time.

## What changes

Reuse path resolution within each scan and check archives with bounded concurrency. Preserve the last good snapshot fallback when a scan exceeds its deadline.

## Impact

Read-only stale-leftover detection and scan latency. Cleanup eligibility and report ordering are preserved.
