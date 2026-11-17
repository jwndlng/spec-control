# Tasks

## 1. Fix Lanes sizing

- [x] 1.1 Adjust non-stacked board and column flex sizing so Lanes use the available board height and card lists scroll internally; verify Stack-specific CSS remains content-sized and page-scrollable.
- [x] 1.2 Add a regression test for populated Lanes overflow and verify the test distinguishes internal card-list scrolling from page-level scrolling.

## 2. Verify user-visible behavior

- [x] 2.1 UI tests pass; headless Chrome at 1280×700 confirmed Lanes columns fill the board with no bottom gap, five populated card lists scroll internally with no document scrolling, and Stack scrolls the page.
- [x] 2.2 Add a What's new JSON entry for the visible board improvement and verify it passes the existing changelog validation.
