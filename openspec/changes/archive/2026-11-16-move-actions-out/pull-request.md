# Pull request summary

The change Console now shows available pull request, change, and session actions by default. Empty groups stay hidden, Ship remains prominent, and existing action availability and behavior are preserved.

## Checks run

- `bun run build:ui` — passed; loaded the new What's new entry.
- `bun test test/sessionPanelUi.test.ts` — 11 passed.
- `bun run check` — passed: lint and typecheck completed; 2,427 tests passed. Biome reported existing warnings.
