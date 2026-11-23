# Design

## Context

`StaleNotice` renders `StaleCleanupDialog` inside the inline warning notice in `changeDetail.tsx`. The CSS rule `.stale-notice p` gives every descendant paragraph `flex: 1 1 280px` so the inline notice text can share a row with its action. The dialog body uses a column flex layout, so the same rule gives its archive summary, backup guidance and result paragraphs a 280px vertical flex basis. Confirm the effect in the browser before editing the selector.

## Goals / Non-Goals

- Give dialog paragraphs their natural height and let the local layout set the spacing between sections.
- Keep cleanup state, API calls and shared modal behavior outside the layout change.

## Decisions

- Scope the inline notice paragraph styling to its direct children. Those are the paragraphs that share a row with the notice action. A reset inside the dialog would leave the broad selector applying to other nested content.
- Keep `Modal`, `StaleLeftoverList` and `StaleCleanupOutcome` in use. If browser review finds residual spacing or overflow, correct it under the standalone `.stale-cleanup` wrapper so the shared end-session and Console layouts retain their own spacing.

## Risks / Trade-offs

- The selector also affects how the inline notice wraps. Check its text and action at desktop and narrow widths after changing it.
- Long paths and commands can dominate compact dialogs. Verify their wrapping and the reachability of the action row in a short viewport.
