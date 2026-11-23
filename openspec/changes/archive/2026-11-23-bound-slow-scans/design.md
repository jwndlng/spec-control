## Approach

Resolve a worktree or session path only when it is needed. Reuse the result among all archive checks in a single invocation and resolve paths afresh on the next scan. Use three workers and collect results in input order. Keep the existing checks for branch identity, locks, running sessions, merge evidence, and uncommitted files.
