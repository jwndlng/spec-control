# Tasks

## 1. Correct the cleanup dialog layout

- [x] 1.1 Open **Clean up leftovers** from change detail in a local synthetic repository with an archived, merged change and a stale branch or worktree. Inspect the dialog paragraphs' computed flex basis, then restrict the inline notice paragraph selector in `src/ui/styles.css` to direct children. Verify that dialog paragraphs size to their content and that the inline notice still wraps with its action.
- [x] 1.2 Check a branch-only preview and a preview with kept items and an outside-change file. Confirm that file details and warnings stay grouped, that the acknowledgement gates **Clean up**, and that **Cancel** returns focus to the opener. Use the synthetic fixture for confirmation and verify that the result, backup path, restore command, copy controls and **Close** remain readable and reachable at desktop and narrow widths. Scope any remaining layout fixes to the standalone dialog.
- [ ] 1.3 Run `bun test test/staleState.test.ts test/endSessionDialogUi.test.ts test/staleCleanupApi.test.ts` and `bun run check` to verify that the shared end-session flow and cleanup contract still pass. The focused tests passed (23 tests). The latest full check on macOS with Bun 1.4.2 reported 20 failures and 2 errors, including scanner and config API timeouts and an opening prompt submitted into a simulated terminal dialog.

## 2. Record the visible fix

- [x] 2.1 Add an independent What's new JSON entry for the dialog layout fix under `src/ui/changelog/entries/` and verify it with `bun test test/whatsNew.test.ts`.
