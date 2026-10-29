# Proposal

## Why

The down-arrow for a change's actions in the board overview does not open its menu. The menu is the only way to reach
actions other than the recommended one, so the failure makes those actions unavailable from the card.

## What Changes

- Make the change card's actions arrow reliably open its menu and let the user choose an available action.
- Preserve the menu's keyboard behavior, accessible menu semantics, outside-click dismissal and positioning near the arrow.
- Add regression coverage for opening the menu with a pointer and activating an item.

## Capabilities

### Modified Capabilities

- `kanban-board`: specify the pointer interaction and successful selection from a card's actions menu.

## Impact

- `src/ui/actionMenu.tsx` and, if the cause is in card composition, `src/ui/kanban.tsx`.
- `src/ui/styles.css` for the card hover rule that affects fixed-position menu placement.
- Tests for the action menu and change card.
- `package.json` and `bun.lock` for the DOM test environment used to render the card.
- `openspec/specs/kanban-board/spec.md`.

The report does not identify a browser, input method, or reproducible sequence. Implementation should reproduce the failure
and confirm its cause before changing the menu; this proposal does not assume a specific event or positioning defect.
