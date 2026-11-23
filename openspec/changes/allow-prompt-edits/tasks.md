# Tasks

## 1. Eligibility and persistence

- [ ] 1.1 Resolve prompt eligibility from live schema output files across the active change's checkouts. Add fixture tests for metadata-only changes, skipped specs, partial drafts, custom glob outputs, archives, and artifacts in a linked worktree added since the last scan.
- [ ] 1.2 Add the same-origin prompt read and save routes with checkout-bound version checks, bounded reads, and atomic publication. Verify first save, replacement, stale and concurrent saves, symbolic-link paths, invalid requests, and that Save leaves Git state, other files, and other checkouts untouched. Update the repository write invariant in `CLAUDE.md` and verify it matches the API delta.

## 2. Prompt tab

- [ ] 2.1 Wire the HTTP and demo adapters to the Prompt tab and add the editor, conflict feedback, and post-save refresh. Test add, edit, cancel, deep links, draft recovery, and read-only behavior after an artifact appears.
- [ ] 2.2 Update built-in Help and exercise the complete add/edit/save flow in the demo. Confirm Help names the Prompt tab and the artifact cutoff.

## 3. Integration and release notes

- [ ] 3.1 Run `bun run check` and smoke-test the compiled dashboard. Confirm a local scaffold saves its revised prompt, a new Draft worktree that copies the scaffold receives the edit, and creating an artifact locks further saves.
- [ ] 3.2 Add an independent What's new JSON entry under `src/ui/changelog/entries/` and verify it with `bun test test/whatsNew.test.ts`.
