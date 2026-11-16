# Proposal

## Why

On the combined board, changes are grouped by project but the group heading does not provide a direct route to that project's board. Users must leave the change list and find the project through Projects to open its overview.

## What Changes

- Add a clearly named link in each repository group heading on the combined board that opens that project's board.
- Keep the group heading's existing expand and collapse control independent of the project link.

## Capabilities

### New Capabilities

### Modified Capabilities
- `kanban-board`: Repository group headings provide direct navigation to the grouped project's board.

## Impact

- `src/ui/kanban.tsx` and its styles for repository group headings.
- The `kanban-board` behavior specification and UI coverage for grouped navigation.
