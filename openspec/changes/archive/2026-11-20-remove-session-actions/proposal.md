# Proposal

## Why

The session controls in the Console are hidden behind a collapsed “Session actions” disclosure, so users can miss the actions available for the selected session. Showing them directly makes the Console’s session controls visible at a glance.

## What Changes

- Remove the collapsed Session actions disclosure and show its eligible actions directly in the Console’s session action group.
- Preserve each action’s existing eligibility, label, confirmation, and behavior.

## Capabilities

### Modified Capabilities
- `change-detail`: Session actions are directly visible in the Console without expanding a menu.

## Impact

- `src/ui/sessionPanel.tsx` and related styles/tests for the Console session action group.
