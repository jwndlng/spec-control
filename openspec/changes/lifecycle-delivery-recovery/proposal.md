# Proposal

## Why

When a managed phase is confirmed again after its worktree changes, Spec Control can treat the confirmation as a duplicate and leave the previous blocked delivery untouched. The detail view can also show several stale delivery records, including a Retry action after the work is already merged. Both leave users without a clear, working next step.

## What Changes

- Give each explicit confirmation of the same managed phase a newer completion revision so updated stable evidence can be processed.
- Show the phase confirmation recovery action again when a delivery is blocked because the worktree changed after the prior confirmation.
- Show only the latest useful delivery status per phase, and treat already-merged work as complete without a Retry action.
- Keep each delivery status and its next action in the relevant pull request checkpoint instead of repeating a second status notice.
- Make phase confirmation state that it verifies work before shipping and show immediate feedback when confirmation is accepted.
- Resolve Archive Ship from the change's archive session, even when another session is selected in the Console tab.
- Keep artifact, task, and stable-worktree verification in place for every confirmation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `lifecycle-delivery`: repeated completion confirmations may authorize a new verified delivery revision for the same managed action; work already merged into the base is terminal success.
- `change-detail`: stale completion confirmation can be retried from the phase checkpoint, and users see one useful delivery status per phase.

## Impact

- `src/shared/types.ts` and `src/server/sessions/manager.ts` track explicit confirmation revisions.
- `src/server/lifecycleDelivery.ts` recognizes merged work as terminal and migrates stale blocked records.
- `src/ui/changeDetail.tsx` exposes reconfirmation when needed, keeps Archive Ship available from its own session, and avoids duplicate or stale delivery messages.
- Lifecycle delivery and detail view tests cover these recovery states.
