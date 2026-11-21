# Proposal

## Why

A running managed phase can currently show both **Confirm & Ship** and a separate **Ship** button for the same pull request. The duplicate controls are confusing and make it unclear which action to take.

## What Changes

- Show only the completion confirmation while that managed phase is awaiting verification and shipping.
- Keep the direct Ship action available when no matching completion confirmation is active.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: Do not show two shipping actions for the same lifecycle phase at once.

## Impact

- `src/ui/changeDetail.tsx` and lifecycle timeline tests.
