# Proposal

## Why

Docs auto-ship is tied to a Draft agent exiting successfully, so ending a completed proposal session to move on can leave its proposal unshipped and its automatic merge path unavailable. A completed docs-only proposal should still be shipped when the user explicitly ends the session.

## What Changes

- Allow a user-ended Draft session to run the existing docs proposal auto-ship flow when all required artifacts are present and the worktree contains only OpenSpec files.
- Keep auto-shipping disabled for incomplete proposals, non-docs work, projects without docs auto-merge, and sessions ended because the application is shutting down.
- Report whether the end action shipped the proposal or why it was not eligible.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: Extend proposal auto-ship eligibility to an explicit user end of a completed Draft session.

## Impact

Session end handling, deterministic Ship and PR creation, session UI/API result reporting, and agent-session tests. No new API operation or repository write is introduced; the existing opt-in docs auto-merge setting and docs-only safety checks continue to govern shipping.
