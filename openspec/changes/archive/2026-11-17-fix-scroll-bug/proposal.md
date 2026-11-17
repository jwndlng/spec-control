# Proposal

## Why

On the Kanban board, repositories with many changes can leave an unused gap beneath the lanes instead of keeping the columns sized to the available board area. This makes the board feel disconnected from its viewport and can make scrolling behavior unclear.

## What Changes

- Keep Lanes columns stretched to the available board height when their cards overflow, with the cards scrolling inside their own lane.
- Preserve the existing page-level vertical scrolling behavior of Stack layout.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: Specify that Lanes fill the available board height and overflow stays within each lane's card list.

## Impact

- `src/ui/styles.css`: board and lane flex sizing and overflow.
- `test/`: regression coverage for a populated Lanes board and its internal scrolling.
- `openspec/specs/kanban-board/spec.md`: clarify the Lanes layout behavior.
