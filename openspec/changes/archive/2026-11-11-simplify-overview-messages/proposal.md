# Proposal: Remove internal agent evidence prose from overview cards

## Why

Finish checks renders a raw PR-cache timestamp and an agent verification instruction in the overview, without giving the user a useful action.

## What Changes

- Remove internal evidence instructions and raw ISO timestamps from routine card content.
- Retain the actual agent verification instruction and show useful refresh failures and relative freshness on demand.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: Concise overview messages and on-demand PR freshness.

## Impact

- `src/ui/finishChecks.tsx`
- `test/ (Finish checks and overview UI coverage)`
- `src/ui/helpContent.tsx`
- `src/ui/demo/`
- `src/ui/changelog/entries/`

## Dependencies and session ownership

Required predecessors: None. Start the implementation session in this change's dedicated worktree and merge predecessors first. Shared files are owned only for the listed concern; do not refactor neighboring functionality. Refresh against latest origin/main before implementation and re-read predecessor contracts.

Shared-file landing order and external proposal overlaps are documented in SESSION.md. Implement only this change, never the former umbrella.
