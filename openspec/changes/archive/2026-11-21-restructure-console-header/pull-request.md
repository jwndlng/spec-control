# Reviewer summary

- The Console header keeps session context at the top left and actions at the top right. Agent and permission controls are behind a collapsed settings gear.
- The change window uses more of the viewport, and the opened settings menu can extend beyond the compact header.
- Ship and its progress/recovery status are in the lifecycle timeline. Dismiss change and Delete change files have persistent borders.

## Checks

- `bun run check` — passed: lint (224 warnings, 8 infos), typecheck, and all 2,497 tests.
- `bun run build` — passed (UI bundle and executable).
- `bun test test/consoleLayout.test.ts` — passed (4 tests); `openspec validate restructure-console-header` and `git diff --check` — passed.
- Manual review remains: open the Console at wide and 375px widths, open Settings, and confirm the entire menu is visible alongside the header and terminal.
