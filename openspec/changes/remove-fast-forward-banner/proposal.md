# Proposal

## Why

The Backlog banner that repeats “Backlog → Implementing; Fast-forward is in the action menu” adds visual noise without helping users take an action. The Fast-forward control remains available through the existing action menu.

## What Changes

- Remove the explanatory Fast-forward banner from the lifecycle timeline.
- Keep Fast-forward available through its existing action menu.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: The timeline no longer displays the Fast-forward route banner.

## Impact

- `src/ui/lifecycleTimeline.tsx`, `src/ui/styles.css`, and lifecycle timeline tests.
