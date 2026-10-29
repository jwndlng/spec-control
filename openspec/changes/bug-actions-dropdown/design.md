# Design

## Context

Change cards expose their recommended action as the main part of a split button. The down-arrow opens the remaining
available actions through `ActionMenu` in `src/ui/actionMenu.tsx`. The board specification already defines its keyboard,
accessibility, dismissal and action-order behavior. The report says the arrow does not work but gives no reproduction
details, so the implementation first needs to isolate whether pointer activation, menu rendering/positioning, or event
handling in the card context is failing.

## Decisions

### D1. Diagnose the existing interaction before changing its implementation

Reproduce the arrow failure on the board overview and trace the interaction from the button through `ActionMenu` and the
card. Fix the smallest cause in that path. Keep action availability and ordering derived from the existing card state;
do not change which actions are offered.

### D2. Keep the menu usable after pointer activation

Clicking the arrow opens the menu beside that arrow, makes its first available item usable, and does not activate the
recommended action or navigate away from the board. Choosing an enabled menu item runs only that action and closes the
menu. Existing keyboard handling, focus return, outside-click and scroll dismissal, and viewport-aware placement remain
in force.

### D3. Cover the user-reported path with regression tests

Add focused coverage that renders a card with more than one available action, opens the arrow menu through its pointer
handler, and selects an enabled item. Assert that the menu opens and the selected action runs once while the recommended
action does not run. Retain the existing pure keyboard and menu logic coverage.

## Risks

The report may refer to a different arrow control than the split-action menu on a change card. Confirm the affected
screen while reproducing; if it is not this control, revise the scope before implementation.
