# Tasks

## 1. Argument fields

- [x] 1.1 Add `argLinesText(raw, list)` and an `ArgLinesField` component holding the raw text (design D1), and use it for the agent profile's Command, Launch arguments and Resume command and for the Editor command; verify with `test/agentSettingsUi.test.ts` (typing `open`, `-a`, `Visual Studio Code` keeps the spaces and stores three arguments; a trailing newline is kept in the text and not stored; a preset replacing the list replaces the text) and `test/editorUi.test.ts`

## 2. End-session dialog

- [x] 2.1 Ignore Escape and disable Cancel while the dialog is busy, and move its Escape listener to the document's capture phase with `stopPropagation` (design D2); verify with a unit test of `endDialogEscape` and a test that renders the busy dialog and finds Cancel disabled
- [x] 2.2 Drop every report, error and close of a confirmation whose session is no longer the dialog's (design D3); verify with a test of the guard that a confirmation started for one session does not report into a dialog opened for another

## 3. Session panel

- [x] 3.1 Give `act` an in-flight flag that disables the header actions and ignores a second call while one runs (design D4); verify with a session-panel test that the actions render disabled while one is in flight and that two calls run the request once

## 4. Blocked pull

- [x] 4.1 Keep the last result in `PullButton` while the repository's pull runs and pass `running` to `PullBlockedList` (design D5); verify with `test/pullUi.test.ts` that the Blocked pull modal stays rendered with Resolve and pull disabled during Resolve and pull and then shows the new outcome

## 5. Check

- [x] 5.1 Run `bun run check`; verify it passes
