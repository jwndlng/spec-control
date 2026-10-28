# Tasks

## 1. Pre-selection

- [x] 1.1 Make `endCleanupOffer` in `src/ui/staleState.ts` pre-select whenever it offers, and shorten `keptUntilStale` to one line; update `test/staleState.test.ts` so the outside-path cases expect `preselected: true`, and verify `bun test test/staleState.test.ts` passes
- [x] 1.2 Add a short one-line form of the outside-paths note (beside `acknowledgementText`) with a unit test naming at most three paths and "N more", and verify it passes

## 2. Dialog layout

- [~] 2.1 Replace the confirmation's headline with "End session · `<change>`" / "Clean up · `<change>`" and the three explanatory paragraphs with one line (and one line for an in-place session); verify in `bun run dev` for a running, an ended and an in-place session — **you:** in `bun run dev`, end a running session, clean up an ended one and end an in-place one; check the headline and the single line
- [~] 2.2 Turn each option into a short label (*Remove worktree*, *Clean up leftovers*, *Pull `<repo>`*) with its explanation as the label's `title` and a visually hidden description referenced by `aria-describedby`; verify the hover text and that a screen reader's accessible description is present in the DOM — **you:** hover each option for its description; in devtools, each checkbox's `aria-describedby` points at a hidden span with the same text
- [~] 2.3 Keep visible, one line each: the unshipped-work warning, the reason a worktree cannot be removed, the outside-paths note under Clean up leftovers; verify with a session holding an unpushed commit and with a stale change whose worktree has an edit outside the change — **you:** end a session with an unpushed commit (warning + "Worktree kept: …" line), and one whose stale worktree has an edit outside the change ("Also deletes … — outside the change, copied first", option ticked)
- [x] 2.4 Add a `compact` prop to `StaleLeftoverList` that drops its closing backup paragraph, pass it only from the end-session dialog, and verify the board's Clean up leftovers… dialog still shows the paragraph
- [~] 2.5 Trim the cleanup and pull reports to the outcome, the lists and "Session ended" (plus "worktree removed" when it was); verify by forcing a refused pull in a fixture repository — **you:** force a refused pull (e.g. a local edit the incoming commit overwrites) and check the report ends with "Session ended, worktree removed." and no longer explains where archives come from
- [~] 2.6 Adjust `src/ui/styles.css` spacing for the shorter dialog if needed, checking light and dark themes — no CSS change was needed; **you:** look at the dialog in light and dark themes

## 3. Wrap-up

- [x] 3.1 Run `bun run check` and verify lint, typecheck and tests pass
- [~] 3.2 Add a What's new entry at the top of `src/ui/changelog.ts` saying the end-session dialog is shorter and every option starts ticked, and verify it shows in the What's new view — **you:** open What's new and check the "A shorter dialog when you end a session" entry
