## Context
The scanner sorts worktrees by changes-directory mtime and reads twelve. Directory mtime changes on adding or removing children, so it does not measure work on existing drafts. A repository with more worktrees can silently lose cards on a successful scan. Stale detection resolves every linked path once per archive, multiplying filesystem work by archive count.

## Decisions
Remove the worktree count cap, preserving three concurrent workers, ten-second per-worktree timeouts and the repository deadline. Keep newest-first traversal as scheduling only. Reading failures still produce warnings and unread paths. Resolve each linked path once per stale-leftover invocation and reuse it without persisting across scans, so subsequent scans observe changed paths. Cleanup continues to recheck its own state.

A profile also identified sequential stale checks across hundreds of leftover branches as a dominant cost. Inspect at most four archived changes concurrently, preserving report order. All checks remain read-only and each change retains its existing classification rules.

## Risks
Repositories with very many worktrees can still exceed the repository deadline. This change removes redundant path resolution without extending that deadline or changing cleanup authorization. Existing per-command and per-worktree limits still apply.

## Validation
A regression with fifteen linked worktrees must show every unique draft, including the oldest. Run stale-detection and read-only tests, the full check, and compare read-only scan profiles before and after.

Scanner fixture tests copy their synthetic projects to temporary folders so git does not discover the developer checkout and scan all of its real worktrees. Real worktree and read-only coverage continues using temporary git repositories.
