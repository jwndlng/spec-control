# Design

## Context

This change is one independently scoped session split from simplify-agent-lifecycle. Read proposal.md and this change's spec deltas for its contract. Required predecessors: `repair-permission-spec-structure`.

## Goals / Non-Goals

Implement only the proposal's listed concern in its owned paths. Preserve unrelated session behavior, remote protections, tracked repository write boundaries, and other sessions' work. No code implementation belongs to this planning branch until a new apply session starts.

## Decisions

### 5. Dismiss the logical change without deleting work

Store project/change incarnation dismissal records in the dashboard home. Apply dismissal as a presentation filter after scanning, so dependencies, archive detection, Open work, and running sessions still see the real data. Prefer validated creation metadata for incarnation identity. When absent, assign a stable local token that survives content edits and checkout shifts; restore is explicit, and a verified later created identity becomes visible. Do not infer a new incarnation merely because a stale worktree changes its files.

Provide Show dismissed and Restore. Confirm that agents continue and files are preserved. Move the old destructive operation behind the clearly labeled Delete change files action and API, retaining its current fingerprint, main-only path, symlink, running-session, staging, and concurrency protections. Do not silently interpret legacy POST dismissal fingerprints as new dismissal authorization or deletion. No automatic conversion of past deletions into dismissal records.

Alternative considered: delete all linked copies on dismissal. Rejected because worktrees can hold unrelated edits and active agents; cleanup already owns the explicit removal flow.

### Product interpretation

Dismiss means reversible hiding from active management. This is the chosen implementation contract; Delete change files remains separately destructive. Do not merge the two or remove running sessions from Open work.


## Risks / Trade-offs

- Shared files may change in neighboring sessions → use the concern ownership and landing order in SESSION.md; refresh against merged predecessors and reconcile only the relevant blocks.
- Missing evidence or changed data during operations → expose a concrete blocker and retain current no-loss/path/permission protections.
- Runtime behavior differs across versions → automated tests use fake agents and GitHub; verify installed runtimes separately where this change affects them.

## Migration Plan

Land required predecessors first, refresh this worktree from origin/main, then implement the tracked tasks. Preserve backward-compatible reads where records change. Document breaking destructive-API changes explicitly when applicable. Rollback must retain files, worktrees, remote PRs, and recoverable home records; do not delete state to hide a failure.
