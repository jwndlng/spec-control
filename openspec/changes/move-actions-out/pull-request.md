# Pull request summary

## Problem

Important change actions in the Console tab are hidden behind a collapsed “More actions” section.

## Intended outcome

Show available pull request, change, and session actions by default, keep them grouped by category, omit empty groups, and retain Ship's prominent placement. Action availability and behavior stay the same.

## Planned verification

- Update `test/sessionPanelUi.test.ts` to cover visible groups, omitted empty groups, and Ship placement.
- Run focused UI tests and `bun run check` for lint, typecheck, and the full test suite.
- Confirm the What's new entry follows the documented schema and appears in the changelog loader.
