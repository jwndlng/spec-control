# Design

## Context

`EndSessionDialog` (`src/ui/endSessionDialog.tsx`) renders three states: the confirmation, a cleanup-only report, and
a pull report. The confirmation chooses one of three explanatory `hint` paragraphs (in place, stale cleanup, plain
worktree), then shows up to three `label.check` rows whose visible text carries the explanation. Pre-selection is
decided in `removalPreselected` and `pullOffer` (both already "whenever offered") and `endCleanupOffer` in
`src/ui/staleState.ts`, which withholds pre-selection when `needsAcknowledgement` finds uncommitted paths outside the
change. The leftover list is `StaleLeftoverList` in `src/ui/staleCleanup.tsx`, shared with the board's **Clean up
leftovers…** dialog. The server's stale cleanup takes `acknowledged` in the request and the dialog already sends
`true` whenever the option is selected.

## Goals / Non-Goals

**Goals:**
- One headline, one line, short labeled checkboxes with `title` descriptions, everything ticked.
- Keep the information that changes a decision visible, in one line each.

**Non-Goals:**
- The board's Clean up leftovers…, repository cleanup, delete-branch and other dialogs: same treatment could follow
  in a later change, but their wording is untouched here.
- Any change to the API, the server's checks or the confirm sequence.

## Decisions

- **Hover description through `title` on the `<label>`, plus `aria-describedby`.** `title` is what the dialog already
  uses for the pull option and for buttons across the UI; it needs no tooltip component. Because `title` alone is not
  reliably announced, each option also gets a visually hidden description element referenced by `aria-describedby`
  on its checkbox. Alternative: an inline ⓘ toggle — more clicks and more visual noise, which is what this change
  removes.
- **Labels.** *Remove worktree*, *Clean up leftovers*, *Pull `<repo>`*. Headline: "End session · `<change>`" when
  running, "Clean up · `<change>`" when ended. One line: "Tidy up after the session — choose what to do:" (exact
  wording may be tuned in implementation; the spec fixes only its shape).
- **Clean up leftovers always pre-selected.** `endCleanupOffer` returns `preselected: offered`. The outside paths stay
  visible as one line under the option (reusing `acknowledgementText` shortened to "Also deletes `a`, `b` and 1 more —
  outside the change, copied first"), because those are the one consequence that a user could not guess. The request
  keeps sending `acknowledged: true` when selected, so the server's guard is unchanged.
- **`StaleLeftoverList` gets a `compact` prop.** In the end-session dialog it omits the closing backup paragraph (moved
  to the option's hover) and keeps the per-leftover lines and the kept list. The board's dialog passes nothing and
  keeps its current text.
- **In-place sessions.** The "whatever the agent changed stays in …" sentence is shortened to one line, since it is
  the only thing such a dialog says and it states something the user cannot see otherwise (no undo).
- **Reports.** Keep the outcome notice, `StaleCleanupOutcome`, `PullBlockedList` and "Session ended." — drop the
  sentence about where archives and specs now come from.

## Risks / Trade-offs

- [Pre-selecting a cleanup that deletes source files outside the change] → They are still named visibly, the server
  copies every uncommitted, non-ignored file under `~/.spec-control/branch-backups/` before removing anything, and
  re-checks that the worktree is what the dialog showed.
- [Hover text is invisible on touch and easy to miss] → The dashboard is a desktop, pointer-driven tool; the hidden
  description keeps it available to screen readers, and the help page still explains each option.
- [Tests asserting on wording] → Only `test/staleState.test.ts` asserts on the pre-selection; no test asserts the
  dialog's prose.
