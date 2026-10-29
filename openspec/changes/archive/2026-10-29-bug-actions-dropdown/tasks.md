# Tasks

## 1. Reproduce and repair the card menu

- [x] 1.1 Reproduce the arrow failure on the board overview and identify whether the fault is in pointer handling, menu rendering/placement or the card context. A Chrome probe identified the card hover transform; the user confirmed the corrected board.
- [x] 1.2 Fix the cause in the smallest relevant UI surface while preserving existing action availability and order.
- [x] 1.3 Add regression coverage that pointer activation opens the menu, an enabled item runs exactly once, the main
  action does not run, and the board remains open.
- [x] 1.4 Keep the existing keyboard, focus, dismissal and accessibility behavior covered.

## 2. Check

- [x] 2.1 Run `bun run check` and verify it passes.
