# Session handoff

## Start here

Work on OpenSpec change `make-change-dismissal-reversible` in `/Users/jan/Workspace/projects/spec-control/.claude/worktrees/make-change-dismissal-reversible` on its existing branch. Read CLAUDE.md and CONTRIBUTING.md, then proposal.md, design.md, all spec deltas, tasks.md, and this SESSION.md. Use openspec-apply-change if available. If native skill discovery misses it, read the tracked `.claude/skills/openspec-apply-change/SKILL.md` in this checkout and follow it; obtain `openspec status --change make-change-dismissal-reversible --json` and `openspec instructions apply --change make-change-dismissal-reversible --json`, read all returned context files, and honor blocked states and task tracking. Do not improvise a workflow just because a skill name is unavailable. Check dependencies before starting code. Refresh against merged origin/main without modifying another worktree, then implement only this change and verify its tasks. Preserve other sessions' work and explicit permission boundaries.

## Required predecessors

`repair-permission-spec-structure`

See depends-on.yaml for machine-readable dependencies.

## Ownership and overlaps

Shared-file rule: stay in proposal.md's listed concerns. Resolve only the relevant blocks when updating shared types, API routes, Help, or demo files. Do not include another session's uncommitted work. Coordinate landing order before modifying the same shared blocks.

Existing proposals retain ownership: ship-button-has-no-description owns pull-request.md generation/body selection; ship-button-should-only-block-implement owns explicit Ship/Archive task gating; add-validate-phase owns validation behavior. This session must read their current artifacts before touching overlapping behavior, preserve their contracts, and update its own proposal before expanding scope. Missing predecessor artifacts in this branch are available in the original project/main checkout or merged origin/main; do not copy another session's uncommitted code.

## Session commands

```sh
cd /Users/jan/Workspace/projects/spec-control/.claude/worktrees/make-change-dismissal-reversible
openspec status --change make-change-dismissal-reversible --json
openspec instructions apply --change make-change-dismissal-reversible --json
```

Do not apply simplify-agent-lifecycle as an implementation change; it is the coordination index only.
