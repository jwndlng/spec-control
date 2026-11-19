# Proposal

## Why

The lifecycle timeline should help people understand and move a change forward, but its uneven spacing, vertical draft milestones, and misplaced actions make it hard to scan. Its current marker also suggests work is active when it is simply waiting, and it shows only one of the three lifecycle pull requests.

## What Changes

- Rework the timeline as a centered, evenly aligned stepper with a cleaner visual hierarchy and horizontal draft artifact milestones.
- Place lifecycle actions and phase completion checks inside their matching checkpoints.
- Animate only actively working phases and in-progress delivery checkpoints.
- Show proposal, implementation, and archive pull-request checkpoints after Drafts, Implementing, and Archived, respectively, including their readiness, conflict, and merged states.

## Capabilities

### New Capabilities

### Modified Capabilities
- `change-detail`: lifecycle progress, action placement, motion, and phase-specific pull-request status.

## Impact

- `src/ui/lifecycleTimeline.tsx`, `src/ui/changeDetail.tsx`, and lifecycle styles/tests.
- Change-detail lifecycle specification and What's new entry.
