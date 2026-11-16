# Tasks

## 1. Fix Lanes sizing

- [ ] 1.1 Adjust non-stacked board and column flex sizing so Lanes use the available board height and card lists scroll internally; verify Stack-specific CSS remains content-sized and page-scrollable.
- [ ] 1.2 Add a regression test for populated Lanes overflow and verify the test distinguishes internal card-list scrolling from page-level scrolling.

## 2. Verify user-visible behavior

- [ ] 2.1 Run the relevant UI tests and verify a populated Lanes board at a constrained viewport has full-height columns, internal card scrolling, and no gap beneath the lanes; verify Stack still scrolls the page.
- [ ] 2.2 Add a What's new JSON entry for the visible board improvement and verify it passes the existing changelog validation.
