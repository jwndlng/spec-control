# Proposal

## Why

A card should say what comes next for its change. Today it can say two contradictory things at once, and sometimes the
wrong one:

- **Draft artifacts on a finished change.** `availableActions` (`src/shared/types.ts`) offers **Draft artifacts**
  whenever any artifact is not written, whatever the stage. A change whose optional `design.md` was never written keeps
  **Draft artifacts** in `Ready`, `Implementing` and even `Done` — beside **Archive**, as if the change still needed
  planning. Starting it sends an agent to write a design for code that already exists.
- **The stage's starter while a pull request decides.** Once the agent shipped, the next step is the pull request's:
  wait for checks, fix them, resolve a conflict, merge. The card still offers the stage's starter — **Implement** on a
  change whose pull request is waiting for checks, **Archive** on a change whose implementation pull request is not
  merged yet — and shows the pull request's state only as a badge next to it.
- **A row of equal buttons.** `Draft artifacts` + `FF`, or `Validate` + `Archive`, sit side by side with nothing saying
  which one is the next step.

## What Changes

- **Draft artifacts only before a change is planned.** **Draft artifacts** (and Fast-forward) are available in
  `Unknown`, `Backlog` and `Drafts`; in `Ready` only while an artifact the schema does not require (a design) is
  missing; in `Implementing` and `Done` never — a request for it is refused as past drafting.
- **One split button per change.** A card's footer and the Console tab offer a change's actions as one split button:
  the **main part** shows the recommended action, the **arrow part** opens a menu with every other available action
  (Draft artifacts in `Ready`, Archive beside Validate, Fast-forward beside Draft). `FF` stops being a separate button.
  The menu is a proper menu button: arrow keys, Escape closes and returns focus.
- **The recommended action** is the stage's primary step — Draft artifacts, Implement, Validate, Archive — unless the
  change links an open pull request, which then decides it:

  | Pull request | Main part |
  |---|---|
  | conflicts | **Resolve conflicts** |
  | ready | **Merge** |
  | checks failing | **Implement** (the agent fixes the checks); in `Done` **Fix checks**, opening the session's Console |
  | draft, checks running, mergeability unknown | a **waiting** label, no action — the menu still has everything |

  A merged or closed pull request gives the stage's step back. Everything is derived on display; the server's available
  actions and refusals never look at the pull request, so a stale pull-request cache can never block a start.

## Non-goals

- Merge on the card for an **ended** session — resuming the agent and sending Merge in one activation — is a follow-up.
  Merge keeps today's behaviour: a prompt into a running session from its Console tab; the card's Merge opens that tab.
- No new prompt or session action: Resolve conflicts for pull requests is `resolve-pr-conflicts`, Merge exists.
- No change to which pull request is linked (`record-change-pull-request`).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `agent-sessions`: Draft artifacts is available only before a change is planned, and in `Ready` only for an optional
  artifact; a refused Draft names the reason; what is recommended is display only.
- `kanban-board`: a change's actions are one split button with a recommended action and a menu; Fast-forward moves into
  the menu; the pull-request working state no longer forbids changing which action is recommended.
- `change-detail`: the Console tab offers its starters as the same split button.
- `pull-requests`: the link may decide the recommended action; it never changes the available actions.

## Impact

- `src/shared/types.ts`: `availableActions` (Draft by stage).
- `src/shared/nextStep.ts` (new): `recommendedAction(change, actions, linkedPullRequest, readiness, sessions)` and the
  menu order.
- `src/ui/actionMenu.tsx` (new): the split button with menu-button keyboard handling.
- `src/ui/sessionState.ts` (`startersFor`, `cardSessionControls`), `src/ui/sessions.tsx` (`SessionControls`, labels,
  Fast-forward confirmation), `src/ui/kanban.tsx`, `src/ui/changeDetail.tsx`, `src/ui/styles.css`.
- `src/server/sessions/manager.ts`: refusal reason for Draft outside its stages.
- `src/ui/demo/demoSessions.ts`, `src/ui/helpContent.tsx`, `src/ui/changelog.ts`.
- Tests: the `availableActions` tests, `test/sessionState.test.ts`, new `test/nextStep.test.ts` and
  `test/actionMenu.test.ts`, the session manager's refusal test.

**Overlap with changes in flight.** `record-change-pull-request` changes how `linkedPullRequest` finds a change's pull
request (from the branches recorded under `spec-control.branch` / `spec-control.archive-branch` in `.openspec.yaml`) and
modifies the same `pull-requests` requirement ("A pull request is linked to a change by its head branch"); whichever
lands second carries the other's text forward. This change only consumes `linkedPullRequest`. `resolve-pr-conflicts`
provides the Resolve conflicts action the split button recommends for a conflicting pull request, and may touch
`src/shared/types.ts` and `src/ui/sessionState.ts`. This change depends on neither.
