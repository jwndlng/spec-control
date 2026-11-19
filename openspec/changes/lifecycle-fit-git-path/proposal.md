# Proposal

## Why

The detail timeline takes more width than the view provides, forcing horizontal scrolling. Lifecycle observation also starts Git by command name, which fails noisily when the app's launch environment cannot resolve Git on `PATH`.

## What Changes

- Fit the phase and delivery checkpoints to the timeline's available width, with compact action labels and PR state text.
- Resolve Git to its executable path before lifecycle observation and treat unavailable Git as missing evidence without repeated spawn errors.

## Capabilities

### Modified Capabilities

- `change-detail`: the lifecycle rail fits without horizontal scrolling.
- `lifecycle-delivery`: Git-backed observation degrades quietly when Git cannot be resolved.

## Impact

- `src/ui/styles.css`
- `src/server/lifecycleDelivery.ts`
- lifecycle timeline and delivery tests
