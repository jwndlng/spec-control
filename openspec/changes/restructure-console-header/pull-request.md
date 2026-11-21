# Reviewer summary

- The Console header keeps session and work context at the top left and session actions at the top right. Agent and permission controls are behind a collapsed, accessible settings gear; the header is capped at 20% of panel height.
- Ship and its progress/recovery status are in the lifecycle timeline. Dismiss change and Delete change files have persistent borders.
- Help and What's new describe the updated Console.

## Checks

- `bun test test/sessionPanelUi.test.ts test/changeDetail.test.ts test/consoleLayout.test.ts test/editorUi.test.ts test/helpContent.test.ts test/whatsNew.test.ts` — passed (78 tests).
- `bun run typecheck` — passed.
- `bun run check` — passed: lint, typecheck and all 2,492 tests. Lint reported 224 warnings.
- `bun run build:ui`, `bun run build:demo` and `git diff --check` — passed.

## Viewport review

The local demo was inspected at a wide viewport and at 375px. At 375px, the detail title wrapped vertically and extended below the viewport, preventing visual confirmation of the Console header placements and terminal height at that width. Please review those Console details at wide and 375px widths.
