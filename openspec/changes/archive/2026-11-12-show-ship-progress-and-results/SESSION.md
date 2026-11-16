# Session handoff

Required predecessors: repair-permission-spec-structure, ship-button-should-only-block-implement

Start a session in /Users/jan/Workspace/projects/spec-control/.claude/worktrees/show-ship-progress-and-results on its existing fix/show-ship-progress-and-results branch. Read CLAUDE.md, CONTRIBUTING.md, and this change's proposal, design, specs, and tasks. Apply only show-ship-progress-and-results. Use the available openspec-apply-change skill; if native discovery misses it, read .claude/skills/openspec-apply-change/SKILL.md in this checkout and use `openspec status --change show-ship-progress-and-results --json` and `openspec instructions apply --change show-ship-progress-and-results --json`. Honor returned context, blocked states, and task tracking rather than improvising from directory layout. Refresh against merged predecessor work before implementation. Keep other sessions' changes intact.
