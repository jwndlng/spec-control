# Proposal

## Why

An agent can ship and merge implementation while leaving a check task open, so the change remains in Implementing and Archive is unavailable even when CI passed. Tasks marked as needing a person can also be left without an obvious path to completion.

## What Changes

- Ask implementing and shipping agents to finish and verify every task they can, and to report exact blockers rather than silently leave boxes open or mark automatable work as needing a person.
- Before Ship, show unresolved tasks and direct the agent to finish them; make truly human-only work visible for confirmation. Preserve an explicit path to open a PR when a check requires that PR or its CI.
- Offer a way to finish remaining checks after a linked PR merges, using the existing session and fresh evidence, then prepare the resulting task update for review and archiving.
- Keep task edits with the agent under its own permissions; gate the existing deterministic Ship operations before any write, and never automatically mark a task complete or assert success from a merged PR alone.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: Completion instructions, Ship preflight and follow-up for unresolved tasks.
- `kanban-board`: A discoverable action for a merged implementation whose tasks remain unresolved.

## Impact

Agent prompts and session actions, session and pull-request state, Ship API and UI, board and console, tests, demo, built-in Help and What's new. The existing prompt customization, opt-in sessions, read-only repository boundary and GitHub query rules remain in force.

## Integration with current main

Main now performs Ship and docs merging deterministically. This change preserves those operations and inserts task preflight before their writes, including automatic Ship and Merge. It preserves phase models, per-change agents and zero-token archive behavior when tasks are verified complete.
