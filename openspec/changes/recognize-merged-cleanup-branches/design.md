# Design

## Context

This change is one independently scoped session split from simplify-agent-lifecycle. Read proposal.md and this change's spec deltas for its contract. Required predecessors: None.

## Goals / Non-Goals

Implement only the proposal's listed concern in its owned paths. Preserve unrelated session behavior, remote protections, tracked repository write boundaries, and other sessions' work. No code implementation belongs to this planning branch until a new apply session starts.

## Decisions

### 6. Prove cleanup eligibility with exact merge evidence

Keep current local ancestry and content tests. As an additional proof, use cached same-repository/default-base merged PR evidence whose head SHA exactly equals the current branch head and whose merge commit is reachable from the locally known base. Extend cached parsed PR fields if needed. An old merged PR on the same branch name is insufficient after new commits; a merge not yet fetched is insufficient until local base evidence catches up. Preview remains local/read-only and does not start hidden network requests.

Represent stale-record pruning as a selection dependency just like worktree removal. Process selected worktrees, prune records, then re-evaluate selected branches in the same operation. Preserve changed-head, dirty-file, external-lock, running-session, default/main branch, and canonical repository lock protections. Distinguish missing evidence from proven unique work in reasons and offer a useful next action. Retain restoration commands for deleted branches.

## Risks / Trade-offs

- Shared files may change in neighboring sessions → use the concern ownership and landing order in SESSION.md; refresh against merged predecessors and reconcile only the relevant blocks.
- Missing evidence or changed data during operations → expose a concrete blocker and retain current no-loss/path/permission protections.
- Runtime behavior differs across versions → automated tests use fake agents and GitHub; verify installed runtimes separately where this change affects them.

## Migration Plan

Land required predecessors first, refresh this worktree from origin/main, then implement the tracked tasks. Preserve backward-compatible reads where records change. Document breaking destructive-API changes explicitly when applicable. Rollback must retain files, worktrees, remote PRs, and recoverable home records; do not delete state to hide a failure.
