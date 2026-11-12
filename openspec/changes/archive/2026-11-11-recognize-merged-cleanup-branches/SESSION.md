# Session handoff

## Start here

Work on OpenSpec change `recognize-merged-cleanup-branches` in `/Users/jan/Workspace/projects/spec-control/.claude/worktrees/recognize-merged-cleanup-branches` on its existing branch. Read CLAUDE.md and CONTRIBUTING.md, then proposal.md, design.md, all spec deltas, tasks.md, and this SESSION.md. Use openspec-apply-change if available. If native skill discovery misses it, read the tracked `.claude/skills/openspec-apply-change/SKILL.md` in this checkout and follow it; obtain `openspec status --change recognize-merged-cleanup-branches --json` and `openspec instructions apply --change recognize-merged-cleanup-branches --json`, read all returned context files, and honor blocked states and task tracking. Do not improvise a workflow just because a skill name is unavailable. Check dependencies before starting code. Refresh against merged origin/main without modifying another worktree, then implement only this change and verify its tasks. Preserve other sessions' work and explicit permission boundaries.

## Required predecessors

None; this session can start independently.

## Ownership and overlaps

Shared-file rule: stay in proposal.md's listed concerns. Resolve only the relevant blocks when updating shared types, API routes, Help, or demo files. Do not include another session's uncommitted work. Coordinate landing order before modifying the same shared blocks.

Existing proposals retain ownership: ship-button-has-no-description owns pull-request.md generation/body selection; ship-button-should-only-block-implement owns explicit Ship/Archive task gating; add-validate-phase owns validation behavior. This session must read their current artifacts before touching overlapping behavior, preserve their contracts, and update its own proposal before expanding scope. Missing predecessor artifacts in this branch are available in the original project/main checkout or merged origin/main; do not copy another session's uncommitted code.

## Session commands

```sh
cd /Users/jan/Workspace/projects/spec-control/.claude/worktrees/recognize-merged-cleanup-branches
openspec status --change recognize-merged-cleanup-branches --json
openspec instructions apply --change recognize-merged-cleanup-branches --json
```

Do not apply simplify-agent-lifecycle as an implementation change; it is the coordination index only.
