# Proposal

## Why

The change detail view repeats local progress directly under the title, separate from the lifecycle phases that explain what that progress means. Keeping progress with its Drafts or Implementing checkpoint makes the timeline the single place to understand phase and progress.

## What Changes

- Remove the local progress meter from the change facts row under the title.
- Show artifact progress and artifact milestones in Drafts, and task progress in Implementing.
- Keep Draft artifacts in the Drafts checkpoint when a Ready change still has an unfinished design artifact, while Implement remains in Implementing.
- Keep phase actions, completion confirmation, and progress centered within their timeline checkpoints.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: local progress belongs to its matching lifecycle checkpoint rather than the detail header.

## Impact

- `src/ui/changeDetail.tsx`
- `src/ui/lifecycleTimeline.tsx`
- `src/ui/sessions.tsx`
- `src/ui/styles.css`
- `test/changeDetail.test.ts`
- `test/lifecycleTimeline.test.ts`
