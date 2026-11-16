# Design

## Context

This change is one independently scoped session split from simplify-agent-lifecycle. Read proposal.md and this change's spec deltas for its contract. Required predecessors: `repair-permission-spec-structure`.

## Goals / Non-Goals

Implement only the proposal's listed concern in its owned paths. Preserve unrelated session behavior, remote protections, tracked repository write boundaries, and other sessions' work. No code implementation belongs to this planning branch until a new apply session starts.

## Decisions

### 7. Resolve workflow instructions in the session checkout

Observed repository state: `.claude/skills/openspec-apply-change/SKILL.md` is tracked, but `.agents/` is untracked in the main checkout and is absent from fresh git worktrees. The quoted agent response is therefore consistent with missing native discovery; it does not establish the exact Antigravity search path. Do not assume that instructions visible to the parent agent or main checkout are visible to a child CLI in its worktree.

Before launching Draft, Implement, Validate, or Archive, resolve framework/action support in the actual checkout. Inspect documented runtime/project skill locations and readable project workflow assets; use an explicit checkout-relative instruction path when the runtime cannot discover the asset by name. Validate the installed OpenSpec CLI supports the required commands and use its resolved schema, planning home, context files, and action state. For Implement, the fallback must obtain `openspec status --change <name> --json` and `openspec instructions apply --change <name> --json`, read all returned context files, honor blocked/all-done states, track tasks at returned locations, and verify completion. Equivalent Draft/Validate/Archive fallbacks must preserve each action's boundaries; archive must not skip sync assessment merely because its skill is unavailable.

Build an action instruction packet from the selected workflow, not an unbounded copy of arbitrary repository text. Preserve repository trust/permission boundaries and prompt size/submission checks. Treat unsupported CLI versions, missing files, and missing commands as specific capability failures; show project setup or explicit generation guidance. Do not auto-run `openspec init/update`, install global skills, copy untracked main-checkout instructions into another worktree, or invent Antigravity flags. Existing project setup remains an explicit action. A compatible checked-in skill can operate without the CLI only if its own documented workflow supports that; otherwise report the missing CLI.

Test with a tracked Claude skill and absent native agent skill directory, main-only untracked skills, explicit-path skill loading, verified CLI fallback, blocked CLI instructions, and total workflow absence. Use fake runtimes for automated tests and record the actual installed Codex/Antigravity versions and observed discovery behavior during disposable-repository acceptance.

## Risks / Trade-offs

- Shared files may change in neighboring sessions → use the concern ownership and landing order in SESSION.md; refresh against merged predecessors and reconcile only the relevant blocks.
- Missing evidence or changed data during operations → expose a concrete blocker and retain current no-loss/path/permission protections.
- Runtime behavior differs across versions → automated tests use fake agents and GitHub; verify installed runtimes separately where this change affects them.

## Migration Plan

Land required predecessors first, refresh this worktree from origin/main, then implement the tracked tasks. Preserve backward-compatible reads where records change. Document breaking destructive-API changes explicitly when applicable. Rollback must retain files, worktrees, remote PRs, and recoverable home records; do not delete state to hide a failure.
