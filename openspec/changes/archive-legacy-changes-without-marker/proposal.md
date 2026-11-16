# Proposal

## Why

Some existing OpenSpec changes have no `.openspec.yaml` marker. The deterministic Archive action currently moves such a change into its archive and then fails while trying to record the archive branch, leaving the user unable to complete the action.

## What Changes

- Allow session branch recording to create a missing marker inside the session worktree when the change directory exists.
- Keep the existing marker content and symlink protections for changes that already have metadata.
- Cover deterministic archival of a markerless change with a regression test.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: branch recording during Archive and Ship supports legacy changes without a metadata marker.

## Impact

- `src/server/frameworks/worktreeMetadata.ts`
- `test/specFrameworks.test.ts` and `test/agentSessions.test.ts`
- `openspec/specs/agent-sessions/spec.md`
