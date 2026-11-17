# Design

## Context

See proposal.md - Why. The Lanes board is a flex child of `.main`; each column is a flex column and its `.cards` list is the intended internal scroll area. Keep sizing rules specific to Lanes, since Stack intentionally grows with content and scrolls the page.

## Goals / Non-Goals

**Goals:**

- Keep the Lanes board constrained to the available area below the header.
- Make populated columns fill that area and keep overflow scrolling inside each card list.
- Preserve current Stack behavior and responsive layout selection.

**Non-Goals:**

- Change card ordering, lane widths, filters, or the archived-card bound.
- Change the Stack layout's page-level scrolling.

## Decisions

- Fix the existing CSS flex sizing chain rather than introducing a new wrapper or measuring heights in JavaScript. The board already receives available space from `.main`; explicit minimum-size constraints on the flex children should let it shrink to that allocation instead of expanding around overflowing content.
- Keep `.cards` as the sole vertical overflow area in Lanes. Ensure it can shrink within the column (`min-height: 0`) so its `overflow-y: auto` takes effect; keep the column stretched to the board's height. This keeps headers visible while a user scrolls the card list.
- Scope any changes to the non-stacked board selectors. Stack uses `overflow: visible` and relies on document scrolling, and must remain content-sized.
- Verify with a regression test that checks the Lanes sizing/overflow rules and a browser check using a populated board at a constrained viewport; also confirm Stack remains page-scrollable.

## Risks / Trade-offs

- [A flex sizing rule could accidentally constrain Stack or hide cards] → Scope selectors to the non-stacked board and verify both layouts with populated content.
- [CSS-only assertions may pass without proving actual scroll behavior] → Pair source-level regression coverage with a browser check at a viewport where the card list overflows.
