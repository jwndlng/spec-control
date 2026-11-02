# Spec Delta

## MODIFIED Requirements

### Requirement: A change's actions are one split button
Wherever the dashboard offers a change's session starters — a card's footer and the change's Console tab — it SHALL offer
them as **one split button**: a **main part** showing the **recommended action**, and an **arrow part** that opens a
menu of every **other** action available for the change. The available actions SHALL be exactly the starters the
change's stage, sub-state and dependencies allow (`agent-sessions`: "Session starters run a fixed prompt for a validated
change"), narrowed to those the repository's agent has a prompt for — Fast-forward where it is available — plus
**Custom session** (`custom`) for any active change (`agent-sessions`: "A change offers a custom session without a
prompt") plus, while the change links an open pull request, that pull request's action when it has one. The menu SHALL
list them in a fixed order (Draft artifacts, Fast-forward, Implement, Validate, Archive, Custom session, then the pull
request's action), without the one the main part shows. When nothing else is available, the arrow part SHALL NOT be
shown.

The recommended action SHALL be, for a change with no linked **open** pull request, its stage's primary step: **Draft
artifacts** in `Unknown`, `Backlog` and `Drafts`; **Implement** in `Ready` and `Implementing`; **Validate** in `Done`
with the sub-state `validate`; **Archive** in `Done`. For a change that is not archived and links an open pull request
(`pull-requests`: "A pull request is linked to a change by its head branch") it SHALL follow that pull request's
readiness:

- `conflicts` → **Resolve conflicts**;
- `ready` → **Merge**;
- `checks failing` → **Implement**, so that an agent fixes what the checks report; in `Done`, where Implement is not
  available, **Fix checks**, which opens the Console tab of the session whose branch heads that pull request;
- `draft`, `checks running` or `mergeability unknown` → **no recommended action**: the main part SHALL be a
  non-actionable **waiting** label that says in words what the pull request waits for, and the arrow part SHALL still
  offer every available action.

When the stage's primary step is not available — Implement for a **blocked** change, or a step the agent has no prompt
for — the main part SHALL show the next available action in the menu order, or, when there is none, the split button
SHALL NOT be shown; a blocked change's "waits for" note is shown as before.

**Merge** and **Resolve conflicts** SHALL open the change's detail view on its Console tab with the session whose branch
heads that pull request selected, where those actions are offered, and SHALL NOT start, resume or send anything by
themselves; without a session record whose branch heads the pull request, **Merge** SHALL be a link that opens the pull
request on GitHub in a new browser tab and **Resolve conflicts** SHALL open the Console tab. Where a dedicated Resolve
conflicts action for pull requests is available (`resolve-pr-conflicts`), **Resolve conflicts** SHALL be that action.
Every starter SHALL behave exactly as it does today wherever it is chosen from — main part or menu: the same
confirmation for Fast-forward, the same refusal shown in place, the same "Starting…" state, and in the Console tab of a
running session the same sending into that session.

The arrow part SHALL open the menu when activated by pointer, Enter, Space or Arrow Down. Pointer activation SHALL NOT
activate the main part, navigate away from the board, or leave the menu hidden. The menu SHALL be positioned next to the
arrow within the viewport and its first enabled item SHALL be available for activation. Activating an enabled item
SHALL run only that action and close the menu. The existing keyboard navigation, accessible menu semantics, Escape and
Tab behavior, outside-click and scroll dismissal, focus return, action ordering and disabled-state behavior SHALL be
preserved.

The arrow part SHALL be a menu button: it SHALL carry an accessible name naming the change ("More actions for
<change>"), `aria-haspopup="menu"` and `aria-expanded`, and the menu SHALL use menu and menu-item semantics. The menu
SHALL open with Enter, Space or Arrow Down and move focus to its first item; Arrow Up and Arrow Down SHALL move between
items, Home and End to the first and last; Enter or Space SHALL activate an item; Escape SHALL close it and return focus
to the arrow part; Tab, a click outside or activating an item SHALL close it. Each item and the main part SHALL carry the
same accessible name and tooltip its starter has today, disabled with the same explanation when the agent is not found.
While a starter is starting or a confirmation dialog is open, both parts SHALL be disabled.

The recommended action SHALL be derived on display from the snapshot, the session list and the cached pull-request
lists, with the same link and readiness the pull-request badge shows. It MUST NOT be stored or logged and MUST NOT change
the change's available actions, column, sub-state, progress or any count. When pull requests are unavailable for the
repository or were never fetched, the recommended action is the stage's. A running session's badge SHALL stand in for
the split button on a card exactly as it does for the starters today.

#### Scenario: Open and use the menu with a pointer
- **WHEN** a card has a recommended action and at least one other available action, and the user clicks its arrow
- **THEN** the menu opens beside the arrow without activating the recommended action or leaving the board, and choosing
  an enabled menu item runs that item once and closes the menu

#### Scenario: Ready change with an optional design missing
- **WHEN** change `rotate-keys` is in `Ready`, its optional `design.md` is not written, and agent sessions are enabled
- **THEN** its card's main part is **Implement** and its menu offers **Draft artifacts**

#### Scenario: Done change awaiting validation
- **WHEN** a change is in `Done` with the sub-state `validate`
- **THEN** the main part is **Validate** and the menu offers **Archive**

#### Scenario: Done change without a design
- **WHEN** a change is in `Done` and its optional `design.md` is not written
- **THEN** the main part is **Archive** and nothing offers **Draft artifacts**

#### Scenario: Backlog card
- **WHEN** a change in `Backlog` is not blocked and the agent has Draft and Implement prompts
- **THEN** the main part is **Draft artifacts** and the menu offers **Fast-forward**

#### Scenario: Checks running
- **WHEN** change `rotate-keys` is in `Done`, no session runs, and its linked open pull request `#58`'s checks are running
- **THEN** the main part reads that the checks are running and starts nothing, and the menu offers **Archive**

#### Scenario: Checks failing
- **WHEN** `rotate-keys` is in `Implementing` and `#58`'s checks fail
- **THEN** the main part is **Implement**

#### Scenario: Checks failing on a finished change
- **WHEN** `rotate-keys` is in `Done`, `#58`'s checks fail, and its ended Implement session's branch heads `#58`
- **THEN** the main part is **Fix checks**, which opens the change's Console tab with that session selected, and the menu offers **Archive**

#### Scenario: Ready to merge
- **WHEN** `#58` is ready and the change's ended Implement session's branch `feat/rotate-keys` heads it
- **THEN** the main part is **Merge**, and activating it opens the change's Console tab with that session selected

#### Scenario: Ready to merge without a session
- **WHEN** `#58` is ready and the dashboard has no session record for `rotate-keys`
- **THEN** the main part **Merge** is a link that opens `#58` on GitHub

#### Scenario: Conflicting pull request
- **WHEN** `#58` conflicts with its base
- **THEN** the main part is **Resolve conflicts**

#### Scenario: Merged pull request gives the stage back
- **WHEN** `#58` is merged and `rotate-keys` is still in `Done`
- **THEN** the main part is **Archive**

#### Scenario: Keyboard
- **WHEN** the user focuses the arrow part, presses Enter, then Escape
- **THEN** the menu opens with focus on its first item, then closes with focus back on the arrow part

#### Scenario: Nothing else available
- **WHEN** a change in `Done` with the sub-state `complete` has no linked open pull request
- **THEN** the split button shows **Archive** and no arrow part

#### Scenario: Running session
- **WHEN** a session of `rotate-keys` is running and `#58` is ready
- **THEN** the card shows that session's badge and no split button

#### Scenario: Custom session offered in the menu
- **WHEN** a change is in `Backlog` and agent sessions are enabled
- **THEN** its card's split button shows **Draft artifacts** as the main part, and its menu includes **Custom session**
