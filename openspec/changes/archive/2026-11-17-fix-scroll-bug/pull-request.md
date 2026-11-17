# Pull request summary

Lanes columns fill the available board height, with overflowing cards scrolling inside their columns and no document-level scrolling. Stack remains content-sized and scrolls with the page. Added a What's new entry for the board improvement.

## Checks

- Passed: `bun run check` (2,429 tests; lint and typecheck included).
- Passed: `bun test test/boardScrollLayout.test.ts test/whatsNew.test.ts` (10 tests); `bun run build:demo`.
- Passed: headless Chrome at a 1280×700 viewport; Lanes showed internal card scrolling, no page scrolling, and no bottom gap; Stack scrolled the page.
- `bun run screenshots` was attempted but could not force dark mode in local Chrome.
