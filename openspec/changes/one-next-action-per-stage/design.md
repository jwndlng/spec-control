# Design

## Context

`availableActions(change)` in `src/shared/types.ts` is the one rule for what a change may start. The server refuses
anything outside it (`SessionManager.open`, `send`), the card shows all of it as equal buttons (`startersFor` →
`cardSessionControls` → `SessionControls`, with `FF` as a separate small button), and the Console tab shows it as
openings or as prompts into the running session. Draft is decided by artifacts alone
(`artifacts.some(a => a.status !== "done")`), every other action by stage. Since `Ready` counts only the artifacts the
schema's `apply.requires` names, an unwritten optional `design.md` keeps Draft alive through every later stage.

The linked pull request (`linkedPullRequest`, `pullRequestReadiness`) is derived on display and is today forbidden from
changing what a card offers (`pull-requests`, `kanban-board` working state).

## Goals / Non-Goals

**Goals:** Draft never available once implementation started; one control per change that says which action is next
and still reaches every other one; the pull request's state deciding that recommendation while it is open.

**Non-Goals:** Merge for an ended session from the card (follow-up; Merge stays a prompt into a running session); no new
prompt or action (Resolve conflicts for pull requests is `resolve-pr-conflicts`); no change to which pull request is
linked (`record-change-pull-request`); no stored state; no change to columns, sub-states or counts; server refusals stay
stage-only.

## Decisions

### D1 Draft is decided by stage, with one exception in `Ready`

`availableActions` offers `draft` in `unknown`, `backlog` and `drafts` (as `fastForward` already is), and in `ready` only
when an artifact is not done — which in `Ready` can only be an optional one. `implementing`, `done` and archived never
get it; the manager refuses with "past drafting".

Alternatives: drop Draft from `Ready` entirely — rejected, the changelog promised a design can still be drafted once
tasks exist; hide Draft in later stages on the card only — rejected, the server would still accept it for a `Done`
change, which is the bug.

### D2 One split button, everywhere starters are offered

A new `ActionMenu` component (`src/ui/actionMenu.tsx`) renders a main button and an arrow button with a popup menu. It is
used by `SessionControls`, so the card and the Console tab can never disagree. Its inputs are pure:
`recommendedAction(...)` (D3) and `menuActions(available, recommended)` — the available actions in the fixed order
Draft artifacts, Fast-forward, Implement, Validate, Archive, then the pull request's action, without the recommended one.

`FF` stops being a separate button and becomes the **Fast-forward** menu item; it keeps its confirmation dialog. Archive
beside Validate and Draft in `Ready` become menu items. When the menu would be empty the arrow part is not rendered, so
the common case (`Done` → Archive) is one plain button.

Keyboard and accessibility follow the WAI-ARIA menu button pattern: the arrow is a `button` with
`aria-haspopup="menu"`, `aria-expanded`, `aria-controls` and the name "More actions for <change>"; the popup is
`role="menu"` with `role="menuitem"` items and roving `tabindex`. Enter, Space and Arrow Down open it on the first item,
Arrow Up/Down, Home and End move, Enter/Space activate, Escape closes and returns focus to the arrow, Tab and an outside
click close it. The keyboard handling is a pure reducer (`menuKey(state, key)`) so it can be tested without a renderer,
matching how `cardSessionControls` is kept testable.

Alternatives: a separate "More…" button — two controls whose relation must be read; a native `<select>` — cannot hold
disabled items with explanations or a link item (Merge without a session).

### D3 The recommended action

`recommendedAction` (new `src/shared/nextStep.ts`, pure) returns one of: a starter, `resolveConflicts`, `merge`,
`fixChecks`, or `{ waiting: reason }`.

Without a linked open pull request (or for an archived change): the stage's primary step — `draft` in
`unknown`/`backlog`/`drafts`, `implement` in `ready`/`implementing`, `validate` in `done · validate`, `archive` in
`done` — or, if that is not available (blocked, no prompt), the first available action in menu order.

With a linked open pull request, by readiness:

- `conflicts` → `resolveConflicts`;
- `ready` → `merge`;
- `checks failing` → `implement` where available. A failing check is work for the agent, and Implement on its branch
  is how the agent gets that work in `Ready`/`Implementing`. In `Done` Implement is not available (it would reopen
  finished tasks), so the step is `fixChecks`, which opens the Console tab of the session whose branch heads the pull
  request — the user resumes it there and the agent sees the failure in context.
- `draft`, `checks running`, `mergeability unknown` → `waiting`. The main part becomes a non-actionable label ("Waiting:
  checks running", "Waiting: draft pull request", "Waiting: mergeability unknown"). **Why not recommend a starter:** in
  all three the honest next step is to wait — for CI, for GitHub, or for the author to mark it ready — and putting
  Implement or Archive in the main part would invite exactly the wrong click (archiving before the implementation
  merged, re-implementing during CI). The arrow part still offers every available action, so nothing is taken away; the
  label is still the first focusable stop so screen-reader users hear the state where the action would be.

`merge` and `resolveConflicts` open the Console tab with the session whose branch heads the pull request — Merge may not
start an agent (`agent-sessions`), and Resolve conflicts lives there until `resolve-pr-conflicts` gives it a direct
action. Without such a session, Merge is a link to the pull request on GitHub.

The server never sees any of this: `availableActions` ignores the pull request, so a stale or unavailable cache can never
refuse a start, and every starter stays reachable through the menu.

### D4 Spec text that forbade this

`pull-requests` ("the only things the link may change are the badge and the working state") and `kanban-board` ("MUST NOT
add or remove a starter") are modified to allow exactly D3: which action is recommended, plus the pull request's own
action in the menu. Available actions, columns, counts and the activity log stay out of the link's reach.

## Risks / Trade-offs

- [Draft for an optional artifact and Fast-forward are one click further away] → they are in the menu, labelled for what
  they do; the recommended action is what most users want.
- [A waiting label in the main part looks like a disabled button] → it is styled as a status, not a button, and carries
  the reason in words.
- [Menus on a dense board] → one arrow per card, opened on demand; the popup is positioned within the board and closes on
  scroll.
- [Pull-request list stale] → the recommendation follows what the list says, with its age in the badge tooltip as today;
  the menu is unaffected.

## Migration

None: nothing is stored. A `Done` change that offered Draft stops offering it on the next render.
