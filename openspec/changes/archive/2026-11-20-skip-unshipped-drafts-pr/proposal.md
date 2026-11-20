# Proposal

## Why

When implementation has started without shipping a Drafts pull request, the Drafts delivery checkpoint still says “Not shipped,” which reads like unfinished work. Showing it as skipped makes the timeline reflect that implementation has moved past that optional delivery step.

## What Changes

- Mark the Drafts PR checkpoint as “Skipped” after implementation starts when no Drafts PR or delivery attempt exists.
- Derive this status from the current lifecycle phase and recorded PR/delivery evidence; do not add a duplicate phase flag to `.openspec.yaml`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: distinguish a skipped Drafts PR delivery from an unshipped delivery after implementation begins.

## Impact

- `src/ui/lifecycleTimeline.tsx` derives the Drafts delivery status from lifecycle and PR state.
- The change-detail specification documents the skipped status and its conditions.
- `.openspec.yaml` remains the source for recorded branch identity; no new persisted field is needed for this derivable status.
