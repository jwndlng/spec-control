## ADDED Requirements

### Requirement: A change's actions are one split button
Wherever the dashboard offers a change's session starters — a card's footer and the change's Console tab — it SHALL offer
them as **one split button**: a **main part** showing the **recommended action**, and an **arrow part** that opens a
menu of every **other** action available for the change. The available actions SHALL be exactly the starters the
change's stage, sub-state and dependencies allow (`agent-sessions`: "Session starters run a fixed prompt for a validated
change"), narrowed to those the repository's agent has a prompt for — Fast-forward where it is available — plus, while
the change links an open pull request, that pull request's action when it has one. The menu SHALL list them in a fixed
order (Draft artifacts, Fast-forward, Implement, Validate, Archive, then the pull request's action), without the one the
main part shows. When nothing else is available, the arrow part SHALL NOT be shown.

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

## MODIFIED Requirements

### Requirement: Cards offer session starters and show session state
When agent sessions are enabled and the card's repository is tracked and not excluded, a card SHALL offer the session starters available for its change in its footer as one split button ("A change's actions are one split button") — its recommended action in the main part and every other available action in its menu, none for archived changes — limited to the starters the repository's agent has a prompt for, and disabled with an explanation when that agent's executable is not found.

A card whose change is in `Ready` or `Implementing` and is **blocked** by its dependencies (change-dependencies) SHALL NOT offer **Implement**; in its place it SHALL show a "waits for" note naming the change's dependencies that are not `met` — the first by name and the number of others (e.g. `waits for add-billing-api +1`), or saying that its `depends-on.yaml` could not be read — whose tooltip and accessible name list every such dependency with its state. The note SHALL NOT be a control and SHALL NOT start anything; **Show details** stays beside it. The note SHALL be shown whether or not agent sessions are enabled, since it states an order rather than a session. A blocked change in any other column SHALL show no note on its card; its detail view says what it waits for. Blocking SHALL NOT move a card, change its progress bar or hide it from any filter.

While any session of the card's change is running, the card SHALL show that session's badge **in the place the starters occupy** and SHALL offer no starter at all. The badge SHALL read the running state the terminal can tell — that the agent is working, or that it may need the user with how long the terminal has been silent — and the starters SHALL stay hidden for every one of those states, so no button appears or vanishes as a terminal falls silent. Activating the badge SHALL open that change's detail view with its Console tab selected and that session shown.

A card whose latest session failed to start or ended with an error SHALL show that badge and SHALL still offer the starters its change's stage allows, so the next attempt stays one activation away. A card MUST NOT offer a control that ends a session. Status MUST be conveyed by text as well as colour. **Show details** remains available. When agent sessions are disabled or the repository is excluded, cards MUST look and behave exactly as before, apart from the "waits for" note.

#### Scenario: Done change offers Archive
- **WHEN** a change is in `Done` and agent sessions are enabled
- **THEN** the card offers **Archive** in its footer

#### Scenario: Ready change
- **WHEN** a change is in `Ready`, agent sessions are enabled and its repository is not excluded
- **THEN** the card offers **Implement** and still offers **Show details**

#### Scenario: Running session
- **WHEN** a change has a running session whose terminal is printing
- **THEN** its card shows the `working` badge where the **Implement** button was, offers no starter and no control that ends the session, and activating the badge opens that change's detail view on its Console tab

#### Scenario: Silent session shows the same badge and no starter
- **WHEN** that session's terminal has printed nothing for 45 seconds
- **THEN** the card's badge says the agent may need the user, and the card still offers no starter

#### Scenario: Failed session keeps its starter
- **WHEN** a change's latest session failed to start and no session of that change is running
- **THEN** its card shows the failure badge and the starter for its stage beside it

#### Scenario: Feature off
- **WHEN** agent sessions are disabled
- **THEN** no card shows a starter, a session badge or a console link

#### Scenario: Blocked card waits instead of offering Implement
- **WHEN** a change in `Ready` depends on `add-billing-api` (`waiting`) and `add-billing-scheme` (`missing`), and agent sessions are enabled
- **THEN** its footer shows `waits for add-billing-api +1` beside **Show details** and no **Implement**, and the note's tooltip lists `add-billing-api — waiting` and `add-billing-scheme — missing`

#### Scenario: Waiting is shown without agent sessions
- **WHEN** agent sessions are disabled and a change in `Ready` is blocked
- **THEN** its card shows the "waits for" note and no starter

#### Scenario: Drafting card is unchanged
- **WHEN** a blocked change is in `Drafts` and agent sessions are enabled
- **THEN** its card offers **Draft artifacts** as before and shows no "waits for" note

#### Scenario: Running session takes precedence
- **WHEN** a blocked change in `Implementing` has a running session
- **THEN** its card shows that session's badge, as for any running session, and no "waits for" note

#### Scenario: Ready change with an optional artifact missing
- **WHEN** a change is in `Ready`, its optional `design.md` is not written, and agent sessions are enabled
- **THEN** its card's split button shows **Implement**, with **Draft artifacts** in its menu

### Requirement: Cards offer Fast-forward
When a card offers its change's starters and **Fast-forward** is available for the change (agent-sessions: "Fast-forward
drafts, implements and ships in one session"), the card SHALL offer it as an item of the split button's menu ("A change's actions are one split button")
whose visible text is `Fast-forward`, whose accessible name and tooltip say what it does — write the artifacts,
implement and open a pull request — together with the agent's name, and which is disabled with the same explanation as
the other starters when the agent's executable is not found. It SHALL follow every rule the other starters follow: it is
hidden while a session of the change runs, offered again beside a failed session's badge, reports a refused or failed
start on the card, and leaves the user on the board. Activating it SHALL first ask for confirmation as that capability
requires; while the dialog is open the card's starters SHALL be disabled. The same item SHALL be offered in the split button of a
change's Console tab wherever Fast-forward is available there.

#### Scenario: Backlog card offers FF
- **WHEN** a change in `Backlog` is not blocked, agent sessions are enabled and the repository's agent has Draft and Implement prompts
- **THEN** its split button shows **Draft artifacts** and its menu offers **Fast-forward**

#### Scenario: FF stays on the board
- **WHEN** the user chooses **Fast-forward** from a card's menu and confirms
- **THEN** the session starts, the card shows its badge in place of its starters and the board stays open

#### Scenario: No FF on a planned card
- **WHEN** a change is in `Ready`
- **THEN** its card's split button shows **Implement** and its menu offers no **Fast-forward**

### Requirement: A card keeps its working state until its pull request is ready
A card whose change links an open pull request that is not ready (`pull-requests`: "A linked open pull request has a readiness") SHALL be shown in its **working state** — the same card tint a card with an agent at work has — whether or not an agent session is running, so that the board tells the user the change is not finished without a visit to GitHub. While that pull request is in progress (its checks are running or its mergeability is unknown) the card's name SHALL sweep as it does for a working agent; while it is only waiting (a draft, failing checks or a conflict) the card SHALL keep the tint without motion. When the pull request becomes ready, is merged or is closed, or the card no longer links it, the working state it caused SHALL end, and a card whose agent is working SHALL keep the working state the agent gives it. Users who prefer reduced motion SHALL see the tint without the sweep, as for a working agent.

The working state caused by a pull request MUST NOT add or remove an available action, change the session badge, the column, the progress bar or any count, and MUST NOT be recorded in the activity log. When pull requests are unavailable for the repository, or have never been fetched, no card SHALL be put in the working state by a pull request.

#### Scenario: Checks running after a ship
- **WHEN** the agent's session for `add-validate-phase` has ended and its open pull request `#125`'s checks are running
- **THEN** the card is tinted as working with its name sweeping, shows `PR #125` with `checks running`, its split button's main part says it waits for the checks, and its menu still offers the starters its stage allows

#### Scenario: Failing checks keep the tint without motion
- **WHEN** `#125`'s checks fail
- **THEN** the card stays tinted as working, its name does not sweep, and its badge says `checks failing`

#### Scenario: Ready releases the card
- **WHEN** a refresh finds `#125` with passing checks and mergeable, and no agent session of the change is running
- **THEN** the card is no longer tinted, and shows `PR #125` with `ready`

#### Scenario: A working agent keeps the tint
- **WHEN** `#125` is ready and an agent session of the change is working
- **THEN** the card stays tinted because of the agent, with its `working` session badge

#### Scenario: Merged pull request
- **WHEN** `#125` is merged
- **THEN** the pull request puts the card in no working state

#### Scenario: Nothing fetched
- **WHEN** the pull-request cache is empty or `gh` is not signed in
- **THEN** no card is tinted because of a pull request
