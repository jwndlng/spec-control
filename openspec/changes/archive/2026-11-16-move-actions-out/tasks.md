# Tasks

## 1. Show the organized action groups

- [x] 1.1 Update the change Console panel markup and styles to show available Pull request, Change, and Session groups by default while keeping Ship prominent; verify unavailable controls and empty groups remain absent.
- [x] 1.2 Update `test/sessionPanelUi.test.ts` to cover the visible groups, omitted empty groups, and prominent Ship placement; verify the focused UI tests pass.

## 2. Document the user-visible change

- [x] 2.1 Add a What's new JSON entry under `src/ui/changelog/entries/` describing where users can find the now-visible change actions; verify the entry follows the documented schema and appears in the changelog loader.

## 3. Verify the integrated change

- [x] 3.1 Run `bun run check` and confirm lint, typecheck, and the full test suite pass.
