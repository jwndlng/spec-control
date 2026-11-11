# Session handoff

## Start here

Work on OpenSpec change `repair-permission-spec-structure` in `/Users/jan/Workspace/projects/spec-control/.claude/worktrees/repair-permission-spec-structure` on its existing branch. Read CLAUDE.md and CONTRIBUTING.md, then proposal.md, design.md, all spec deltas, tasks.md, and this SESSION.md. Use openspec-apply-change if available. If native skill discovery misses it, read the tracked `.claude/skills/openspec-apply-change/SKILL.md` in this checkout and follow it; obtain `openspec status --change repair-permission-spec-structure --json` and `openspec instructions apply --change repair-permission-spec-structure --json`, read all returned context files, and honor blocked states and task tracking. Do not improvise a workflow just because a skill name is unavailable. Check dependencies before starting code. Refresh against merged origin/main without modifying another worktree, then implement only this change and verify its tasks. Preserve other sessions' work and explicit permission boundaries.

## Required predecessors

None; this session can start independently.

## Ownership and overlaps

This session owns only structural heading repair in the two named main specs. Preserve all requirement and scenario text. Land before other sessions modify these main-spec blocks.

## Session commands

```sh
cd /Users/jan/Workspace/projects/spec-control/.claude/worktrees/repair-permission-spec-structure
openspec status --change repair-permission-spec-structure --json
openspec instructions apply --change repair-permission-spec-structure --json
```

Do not apply simplify-agent-lifecycle as an implementation change; it is the coordination index only.
