# Proposal

## Why

Ending a session can trigger slow worktree cleanup, leaving the end-session dialog blocking the screen until that work finishes. Letting the user continue while cleanup runs in the background makes session lifecycle actions less disruptive.

## What Changes

- Allow the end-session flow to return control after the session has ended, while requested worktree cleanup continues asynchronously.
- Report the cleanup outcome after the dialog closes without showing it in a dialog opened for another session.

## Capabilities

### New Capabilities

### Modified Capabilities
- `agent-sessions`: Change how end-session confirmations behave while cleanup is running and where their eventual outcomes are reported.

## Impact

- End-session UI state and reporting.
- Session lifecycle and worktree cleanup coordination in the agent-session service.
