# Proposal

## Why

The change detail timeline currently mixes session lifecycle status into phase progress, making an ended agent session look like part of the change's progress. It also derives the current phase only from the snapshot stage, so an active implementation can leave Ready looking unfinished.

## What Changes

- Keep session ended/running status out of the lifecycle progress timeline.
- Derive the displayed current phase from active work when it has progressed beyond the snapshot stage, so preceding phases are shown complete.
- Place archive shipping controls and status at the Archive PR checkpoint.
- Discover implementation and archive PRs by their own recorded or managed branch, not by a single best PR for the whole change.
- Make the Antigravity launch test wait for its complete terminal argument line before parsing it, avoiding a race under parallel test load.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: clarify phase progression and keep session status out of the phase timeline.

## Impact

- `src/ui/lifecycleTimeline.tsx`
- `src/ui/changeDetail.tsx`
- `src/ui/sessions.tsx`
- phase-specific PR discovery in `src/shared/pullRequestLink.ts`
- archive delivery actions in `src/ui/changeDetail.tsx`
- lifecycle timeline tests and the change detail spec.
- `test/agentSessions.test.ts` for the terminal-output race in the full check.
