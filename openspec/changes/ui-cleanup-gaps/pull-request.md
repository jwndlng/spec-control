## Summary

- **Clean up leftovers** in change detail sizes paragraphs to their content, removing the blank bands between sections. Long filenames, paths, and restore commands wrap within the dialog.
- Added a What's new entry for the spacing fix.

## Verification

- Headless Chrome with a synthetic Git repository at 1280×800 and 360×420. Verified inline notice wrapping, branch-only and mixed previews, acknowledgement gating, Cancel focus restoration, backup contents, and reachability of Copy and Close.
- `bun test test/staleState.test.ts test/endSessionDialogUi.test.ts test/staleCleanupApi.test.ts` passed (23 tests).
- `bun test test/whatsNew.test.ts` passed (8 tests).
- `openspec validate ui-cleanup-gaps --strict` and `bun run build` passed. The compiled binary reported `dev`.
- `bun run check` on macOS with Bun 1.4.2 passed lint and typecheck. The latest test run reported 2,486 passes, 20 failures, and 2 errors, including repeated scanner and config API timeouts and a terminal prompt assertion.
