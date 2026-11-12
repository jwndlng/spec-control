# Proposal: Repair main specification structure

## Why

Earlier permission-profile archival left delta headers inside two main specs, hiding requirements from the OpenSpec parser and blocking future spec merges.

## What Changes

- Remove only misplaced delta section headers from agent-sessions and dashboard-api main specs; preserve all requirement and scenario text.
- Verify permission requirements remain visible to list, show, validation, and delta comparison.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None.

## Impact

- `openspec/specs/agent-sessions/spec.md`
- `openspec/specs/dashboard-api/spec.md`

## Dependencies and session ownership

Required predecessors: None. Start the implementation session in this change's dedicated worktree and merge predecessors first. Shared files are owned only for the listed concern; do not refactor neighboring functionality. Refresh against latest origin/main before implementation and re-read predecessor contracts.

Shared-file landing order and external proposal overlaps are documented in SESSION.md. Implement only this change, never the former umbrella.
