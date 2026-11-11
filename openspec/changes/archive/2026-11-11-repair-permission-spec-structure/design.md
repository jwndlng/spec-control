# Design

## Context

This change is one independently scoped session split from simplify-agent-lifecycle. Read proposal.md and this change's spec deltas for its contract. Required predecessors: None.

## Goals / Non-Goals

Implement only the proposal's listed concern in its owned paths. Preserve unrelated session behavior, remote protections, tracked repository write boundaries, and other sessions' work. No code implementation belongs to this planning branch until a new apply session starts.

## Decisions

This is a specification structure repair, not a behavior change. Set skip_specs: true; do not invent a delta requirement. Remove misplaced ## ADDED Requirements headings only after verifying their surrounding ## Requirements section. Preserve requirement blocks byte-for-byte. Do not archive or rewrite other changes. Verify both main specs with the installed CLI and compare parsed permission requirement counts before/after.

## Risks / Trade-offs

- Shared files may change in neighboring sessions → use the concern ownership and landing order in SESSION.md; refresh against merged predecessors and reconcile only the relevant blocks.
- Missing evidence or changed data during operations → expose a concrete blocker and retain current no-loss/path/permission protections.
- Runtime behavior differs across versions → automated tests use fake agents and GitHub; verify installed runtimes separately where this change affects them.

## Migration Plan

Land required predecessors first, refresh this worktree from origin/main, then implement the tracked tasks. Preserve backward-compatible reads where records change. Document breaking destructive-API changes explicitly when applicable. Rollback must retain files, worktrees, remote PRs, and recoverable home records; do not delete state to hide a failure.
