# Session handoff

## Start here

Work on OpenSpec change `simplify-overview-messages` in `/Users/jan/Workspace/projects/spec-control/.claude/worktrees/simplify-overview-messages` on its existing branch. Read CLAUDE.md and CONTRIBUTING.md, then proposal.md, design.md, all spec deltas, tasks.md, and this SESSION.md. Use openspec-apply-change if available. If native skill discovery misses it, read the tracked `.claude/skills/openspec-apply-change/SKILL.md` in this checkout and follow it; obtain `openspec status --change simplify-overview-messages --json` and `openspec instructions apply --change simplify-overview-messages --json`, read all returned context files, and honor blocked states and task tracking. Do not improvise a workflow just because a skill name is unavailable. Check dependencies before starting code. Refresh against merged origin/main without modifying another worktree, then implement only this change and verify its tasks. Preserve other sessions' work and explicit permission boundaries.

## Required predecessors

None; this session can start independently.

## Ownership and overlaps

This session owns only the Finish checks presentation. Do not implement delivery state, timeline controls, dismissal, PR policy, or server behavior.

## Session commands

```sh
cd /Users/jan/Workspace/projects/spec-control/.claude/worktrees/simplify-overview-messages
openspec status --change simplify-overview-messages --json
openspec instructions apply --change simplify-overview-messages --json
```

Do not apply simplify-agent-lifecycle as an implementation change; it is the coordination index only.
