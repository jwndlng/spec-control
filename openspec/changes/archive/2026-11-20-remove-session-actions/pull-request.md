## Delivered

Resume, Clean up, Delete record and Open in editor now appear directly in the selected session's labeled Console action group. Existing eligibility and behavior remain in place. Removed the disclosure-only styles, updated the help text and UI assertions, and added a What's new entry.

## Checks

- `bun test test/sessionPanelUi.test.ts test/editorUi.test.ts test/whatsNew.test.ts` — passed (24 tests).
- `bun run check` — not clean: typechecking completed; the test suite reported 2,472 passed and 5 failures in unrelated Ship, issue-listing, fake-agent lifecycle and PR mergeability tests. Lint reported repository-wide diagnostics (217 warnings, 7 infos).
