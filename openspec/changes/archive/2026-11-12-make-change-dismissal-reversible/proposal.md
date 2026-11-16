# Proposal: Dismiss logical changes durably and restore them

## Why

Current dismissal deletes only the main checkout directory, refuses worktree-only changes, and leaves cards visible when another checkout holds a copy.

## What Changes

- Make Dismiss change a durable reversible board filter across checkout copies.
- Expose Show dismissed and Restore while retaining dependency and running-session evidence.
- Keep destructive main-checkout file deletion behind a separately named action and API with existing safeguards.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-dismissal`: Durable logical dismissal, incarnation identity, and separate file deletion.
- `kanban-board`: Dismissed-change filtering and restore.
- `dashboard-api`: Revised dismissal, listing, restore, and explicit delete-files routes.

## Impact

- `src/server/dismissChange.ts`
- `new dismissal storage module under src/server/`
- `src/server/api.ts (dismissal routes only)`
- `src/shared/types.ts (dismissal contracts)`
- `src/ui/dismissChange.tsx`
- `src/ui/dismissState.ts`
- `src/ui/kanban.tsx`
- `src/ui/changeDetail.tsx (dismissal menu only)`
- `src/ui/api.ts`
- `src/ui/demo/`
- `src/ui/helpContent.tsx`
- `test/ (dismissal, API, board filtering, path safety)`
- `src/ui/changelog/entries/`

## Dependencies and session ownership

Required predecessors: `repair-permission-spec-structure` Start the implementation session in this change's dedicated worktree and merge predecessors first. Shared files are owned only for the listed concern; do not refactor neighboring functionality. Refresh against latest origin/main before implementation and re-read predecessor contracts.

Shared-file landing order and external proposal overlaps are documented in SESSION.md. Implement only this change, never the former umbrella.
