# Proposal: Resolve agent workflow instructions in each session checkout

## Why

Fresh worktrees contain tracked Claude skills but not the main checkout's untracked .agents assets. Codex and Antigravity can miss the named skill and improvise a workflow.

## What Changes

- Check each action's workflow availability in its actual session worktree.
- Supply an explicit readable project skill path or a capability-checked CLI fallback preserving the OpenSpec action contract.
- Report actionable setup failures without silently changing global settings or copying untracked instructions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: Workflow availability, explicit skill resolution, and action-preserving CLI fallback.

## Impact

- `src/server/sessions/agents.ts`
- `src/server/sessions/manager.ts (launch preflight only)`
- `src/server/frameworks/openspec/`
- `src/server/environment.ts`
- `src/shared/types.ts (workflow diagnostics only)`
- `src/ui/sessionPanel.tsx (launch diagnostics only)`
- `src/ui/api.ts`
- `src/ui/demo/`
- `src/ui/helpContent.tsx`
- `test/agentSessions.test.ts and new workflow-resolution tests`
- `src/ui/changelog/entries/`

## Dependencies and session ownership

Required predecessors: `repair-permission-spec-structure` Start the implementation session in this change's dedicated worktree and merge predecessors first. Shared files are owned only for the listed concern; do not refactor neighboring functionality. Refresh against latest origin/main before implementation and re-read predecessor contracts.

Shared-file landing order and external proposal overlaps are documented in SESSION.md. Implement only this change, never the former umbrella.
