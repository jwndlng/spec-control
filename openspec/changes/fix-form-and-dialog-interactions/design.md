# Design

## Context

The UI is Preact with controlled inputs, and its tests render components as plain functions and walk the vnode tree
(`test/vnode.ts`) — there is no DOM. Every fix below therefore puts its decision in a pure function the tests can call,
and keeps the component wiring thin.

## Decisions

### D1. Raw text per argument field, parsed into the draft on every keystroke

Each one-argument-per-line field becomes a small component (`ArgLinesField`) holding the raw text in local state. On
input it sets the raw text and stores `parseArgLines(raw)` (or `undefined` when empty, as today) in the draft, so Save
and the dirty check see the parsed list exactly as now. The raw text is re-derived from the list only when the list
changes from outside — a preset, a reset, a different profile — which the component detects by comparing the incoming
list with `parseArgLines(raw)`: if they are equal the user's text stands, otherwise the list is shown joined. A pure
`argLinesText(raw, list)` returns which text to show and is what the tests call.

Rejected: parsing only on blur or Save. Then the draft would not reflect what is typed, Save would need to flush
focused fields first, and the dirty indicator would lag.

### D2. The end-session dialog is not dismissable while busy, and Escape stays inside it

Escape and Cancel do nothing while `busy` and Cancel is `disabled`, as `cleanup.tsx` already does. The Escape listener
moves to `document` in the capture phase and calls `stopPropagation`, as `modal.tsx` and `endProposalDialog.tsx` do, so
the change detail view's `closeOnEscape` never sees it. Escape is decided by a pure `endDialogEscape(busy)`.

The report states (leftovers, blocked pull) are not busy: they can be closed as now, because the work has finished;
a Resolve and pull started from the report belongs to the pull store and keeps its outcome beside the Pull control.

### D3. A confirmation reports only into its own session's dialog

`confirm` remembers the session id it started for and, after each await, checks it against the id currently open (a
ref kept in step with `id`). When they differ it stops reporting: no `setReport`, `setBusy`, `setError` or `close()`.
The work already requested on the server is not undone — it was confirmed — and its pull outcome still shows beside the
repository's Pull control. With D2 the dialog cannot be closed while busy, so this only matters when another session's
dialog is opened by other means (for example **End session** in a second panel).

### D4. One action at a time in the session panel

`act` sets a `busy` flag for its duration, and the header actions it runs — Ship, Resolve conflicts, Merge, Resume,
Delete record, and the console steps of `SessionControls` — are disabled while it is set, and `act` returns without
calling while it is set (a second click arriving before the re-render). The server-side guarantee that two concurrent
starts never put two agents in one worktree is `harden-session-lifecycle`'s; this is the UI half and does not depend
on it.

### D5. The blocked-pull dialog shows the last result while running

`PullButton` remembers the last finished result for its repository and, while the repository's state is `running`,
passes that result and `running: true` to `PullBlockedList`, which already shows "Resolving…" and disables its button.
The badge keeps showing "Pulling…" on the button as today. A pure `shownPullResult(state, last)` decides it.
