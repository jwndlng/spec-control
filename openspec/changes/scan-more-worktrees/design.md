# Design

Raise both scanner limits that govern linked-worktree inspection to 50: checkout status inspection and change discovery. Keep their existing concurrency and per-worktree timeouts unchanged, so the larger cap increases total work over a scan without increasing the number of simultaneous worktree operations. Preserve the existing rule that excess worktrees are listed but left uninspected, and continue prioritizing recently changed worktrees for change discovery.
