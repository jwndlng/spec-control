# Proposal

## Why

The lifecycle timeline is hard to scan because long artifact names and separate PR checkpoints compete for space. Short, recognizable artifact labels and PR status placed inside the phase that creates it will keep the change path readable without hiding useful detail.

## What Changes

- Show compact artifact labels (`Pro`, `Spe`, `Des`, `Tas`) in the Drafts progress strip, with full names available to screen readers and on hover.
- Move proposal, implementation, and archive PR state, links, and actions into the Drafts, Implementing, and Archived phase checkpoints.
- Remove the separate PR checkpoint nodes so the timeline uses one evenly spaced node per lifecycle phase.
- Keep delivery state text, color, links, shipping and recovery actions available at the corresponding phase.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: compact artifact labels and phase-integrated pull-request delivery state.

## Impact

- `src/ui/lifecycleTimeline.tsx` and `src/ui/styles.css` for timeline presentation.
- `test/lifecycleTimeline.test.ts` for labels, delivery placement, status, and action regressions.
- `openspec/specs/change-detail/spec.md` for the visible timeline contract.
- A What's new entry for the timeline refinement.
