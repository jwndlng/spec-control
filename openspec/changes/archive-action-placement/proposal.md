# Proposal

## Why

For archived changes, the Archive action currently falls into a centered row below the lifecycle timeline because there is no next phase to own it. This breaks the phase/action relationship and makes the timeline harder to understand.

## What Changes

- Keep actions for archived changes inside the Archived checkpoint.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: Keep the Archive action within the Archived phase when a change is already archived.

## Impact

- `src/ui/lifecycleTimeline.tsx` and its lifecycle timeline tests.
