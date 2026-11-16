# Proposal

## Why

Ship may run deterministic background git and GitHub operations while the UI offers little confirmation that it started or finished. Users cannot tell whether to wait, retry, or look for a PR.

## What Changes

- Acknowledge Ship immediately with a visible Shipping state and prevent duplicate clicks for the same operation.
- Expose actual server stages, or a truthful generic busy state until stage evidence is available; never fabricate progress.
- Show a durable success result with the created or reused PR link, and actionable failure/partial-success results that support safe retry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: Observable Ship progress and explicit results.
- `dashboard-api`: Observable Ship progress and explicit results.

## Impact

- `src/ui/sessionPanel.tsx`
- `src/ui/sessions.tsx`
- `src/ui/api.ts`
- `src/server/sessions/manager.ts (Ship operation status only)`
- `src/server/api.ts (Ship status only)`
- `src/shared/types.ts (Ship feedback state only)`
- `src/ui/demo/`
- `src/ui/helpContent.tsx`
- `test/ (Ship progress, API, UI, and retry fixtures)`
- `src/ui/changelog/entries/`

## Dependencies and ownership

Required predecessors: `repair-permission-spec-structure` (repairs existing dashboard-api structure before its delta is applied/archived) and `ship-button-should-only-block-implement`, which owns gating and result/PR URL fields. This change adds progress and result presentation without changing gating or PR body generation.
