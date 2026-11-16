# Proposal

## Why

Archive is currently offered as soon as required artifacts are complete, including for a change that has not started implementation. A dependency can block Implement while leaving Archive available, making the board offer an action that skips the expected lifecycle.

## What Changes

- Offer Archive only for changes in the Done stage, while retaining the existing required artifact readiness check.
- Keep dependency blocking scoped to Implement; a Done change remains archivable even if a dependency is unresolved.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: Archive availability requires the change to be Done.

## Impact

- `src/shared/types.ts`: shared Archive action eligibility used by the UI and server.
- `src/ui/demo/demoSessions.ts`: keep simulated Ship eligibility based on artifact readiness, independently of Archive availability.
- `test/agents.test.ts`: action and starter regression coverage.
