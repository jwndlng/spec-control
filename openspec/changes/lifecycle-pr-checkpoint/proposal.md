# Lifecycle PR checkpoint

## Problem

The change detail timeline shows local phases, while Ship, pull-request checks, and conflict recovery are surfaced elsewhere. People cannot follow the change from implementation through remote delivery in one place.

## Proposal

Make the lifecycle stepper the primary guide through a change. Show the existing phase action under the step it advances, with completed, current, and next steps visually distinct. Add a smaller pull-request checkpoint after Done with Ship when eligible, a link to the PR, a live status dot for checks and mergeability, and Resolve conflicts when the existing eligibility rules allow it. Keep each action on its existing server path.

## Scope

- Completed phases show green check markers, the current phase pulses, and the next phase is visually highlighted.
- Draft artifacts, Implement, Validate, and Archive remain governed by existing session controls and render under their relevant phase.
- Managed phase completion confirmation appears compactly in the phase being checked instead of in a separate large notice.
- Backlog indicates the Fast-forward route to Implementing; Fast-forward remains the existing menu action and confirmation path.
- A pull-request checkpoint follows Done. Shipping and checks in progress pulse orange, passing checks with a mergeable PR are green, and conflicts or failing checks are red. Merged PRs are green.
- Ship and Resolve conflicts are integrated into that checkpoint without changing their eligibility, confirmation, or server-side validation.

## Non-goals

- Changing the phase model, automatic delivery behavior, PR readiness policy, or merge policy.
- Adding GitHub queries or changing when cached pull-request data refreshes.

## Impact

- `src/ui/lifecycleTimeline.tsx`
- `src/ui/styles.css`
- `src/ui/changeDetail.tsx`
- `src/ui/sessionPanel.tsx`
- `src/ui/sessions.tsx`
- `src/ui/helpContent.tsx`
- `src/ui/changelog/entries/2026-11-18-lifecycle-pr-checkpoint.json`
- `test/lifecycleTimeline.test.ts`
- `openspec/specs/change-detail/spec.md`
- `openspec/changes/lifecycle-pr-checkpoint/**`
