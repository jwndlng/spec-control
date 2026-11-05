# Proposal

## Why

When a change accumulates several sessions across its lifecycle (such as drafting artifacts, implementing, or running multiple attempts), each session remains listed in the Console tab's left-hand session menu. While ended sessions can be removed using the "Delete record" button inside each session's view, cleaning up multiple ended sessions requires switching into each one individually, adding friction and leaving the menu cluttered with obsolete console records.

## What Changes

- Add a removal control ("X" button) to each ended session in the Console tab's left-hand session menu (`ConsoleSessionList`).
- Omit the removal control for running sessions, ensuring active sessions cannot be accidentally removed while running.
- Clicking the removal control removes that session's record and stored output via the existing session deletion API.
- If the removed session was currently selected, the selection falls back to the most recently active remaining session.
- When session removal leaves only a single session, the session list is omitted as standard.

## Capabilities

### New Capabilities

### Modified Capabilities
- `change-detail`: Update the requirement "The console tab selects among the change's sessions" to specify the removal control ("X") on ended sessions in the session list, its omission on running sessions, and the selection fallback behavior upon removal.

## Impact

- Affected UI: `ConsoleSessionList` in `src/ui/sessionPanel.tsx` and related styles in `src/ui/styles.css`.
- Supporting files: `test/sessionPanelUi.test.ts`, `src/ui/changelog.ts`, and `src/ui/helpContent.tsx` (document the new Console list removal control).
- Affected APIs: None. Reuses the existing `DELETE /api/sessions/:id` endpoint.
