# Tasks

## 1. UI Implementation

- [x] 1.1 Update `ConsoleSessionList` in `src/ui/sessionPanel.tsx` to separate the session row into a selectable element and an "X" removal button for ended sessions (`s.state !== "running"`), omitting the removal control when running. Verify with unit tests that ended sessions render the removal button with `aria-label="Remove console"` and running sessions do not.
- [x] 1.2 Wire the removal button to delete the session via `api.deleteSession`, stop event propagation, refresh session state, and fall back to the most recent remaining session if the active session was deleted. Verify with unit tests in `test/sessionPanelUi.test.ts`.
- [x] 1.3 Add CSS styles in `src/ui/styles.css` for `.console-session` container layout and `.console-session-remove`. Verify that the remove button aligns to the right and is clearly separated from the selection hit target with `bun run check`.

## 2. Verification and Documentation

- [x] 2.1 Add test coverage in `test/sessionPanelUi.test.ts` covering removal button presence, omission on running sessions, and deletion interaction. Verify with `bun test test/sessionPanelUi.test.ts`.
- [x] 2.2 Add a What's new entry at the top of `src/ui/changelog.ts` for removing ended consoles directly from the session list. Verify with `bun test test/whatsNew.test.ts` and `bun run check`.
