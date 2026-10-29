# Spec Delta

## MODIFIED Requirements

### Requirement: A change's actions are one split button

Wherever the dashboard offers a change's session starters — a card's footer and the change's Console tab — it SHALL offer
them as one split button: a main part showing the recommended action, and an arrow part that opens a menu of every other
action available for the change. The available actions SHALL be exactly the starters the change's stage, sub-state and
dependencies allow (`agent-sessions`: "Session starters run a fixed prompt for a validated change"), narrowed to those
the repository's agent has a prompt for — Fast-forward where it is available — plus, while the change links an open pull
request, that pull request's action when it has one. The menu SHALL list them in a fixed order (Draft artifacts,
Fast-forward, Implement, Validate, Archive, then the pull request's action), without the one the main part shows. When
nothing else is available, the arrow part SHALL NOT be shown.

The arrow part SHALL open the menu when activated by pointer, Enter, Space or Arrow Down. Pointer activation SHALL NOT
activate the main part, navigate away from the board, or leave the menu hidden. The menu SHALL be positioned next to the
arrow within the viewport and its first enabled item SHALL be available for activation. Activating an enabled item
SHALL run only that action and close the menu. The existing keyboard navigation, accessible menu semantics, Escape and
Tab behavior, outside-click and scroll dismissal, focus return, action ordering and disabled-state behavior SHALL be
preserved.

The recommended action SHALL be derived on display from the snapshot, the session list and the cached pull-request
lists, with the same link and readiness the pull-request badge shows. It MUST NOT be stored or logged and MUST NOT change
the change's available actions, column, sub-state, progress or any count. When pull requests are unavailable for the
repository or were never fetched, the recommended action is the stage's. A running session's badge SHALL stand in for
the split button on a card exactly as it does for the starters today.

#### Scenario: Open and use the menu with a pointer

- **WHEN** a card has a recommended action and at least one other available action, and the user clicks its arrow
- **THEN** the menu opens beside the arrow without activating the recommended action or leaving the board, and choosing
  an enabled menu item runs that item once and closes the menu
