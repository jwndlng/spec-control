# Proposal

## Why

Four controls in the UI lose what the user typed or did, or let one click do something twice:

- **Argument fields eat spaces and line breaks.** The agent profile's **Command**, **Launch arguments** and **Resume
  command** and the **Editor command** in Settings are controlled textareas whose value is the parsed list joined with
  newlines (`value={args.join("\n")}`), and every keystroke stores `parseArgLines(value)`, which trims each line and
  drops empty ones. Preact then puts the joined list back into the textarea, so a trailing space or a new line vanishes
  the moment it is typed: `Visual Studio Code` — the Editor command's own example — comes out as `VisualStudioCode`,
  and Enter after `claude` does nothing, so a second argument can only be added by pasting. The setup wizard keeps the
  raw text (`setupState.ts`) and is not affected.
- **The end-session dialog can be dismissed while it works.** Escape (`endSessionDialog.tsx`) has no busy check and
  **Cancel** is not disabled while the confirmation runs, yet `confirm` carries on after the dialog is gone: a
  "cancelled" end still removes the worktree, cleans up and pulls, out of sight, and its report — a blocked pull with
  **Resolve and pull**, kept leftovers — is lost. Worse, a confirmation still running for one session can call
  `setReport` or `close()` on the dialog now open for another session. Escape is also seen by the change detail view's
  own `closeOnEscape` listener (the dialog does not stop it, unlike `modal.tsx` and `endProposalDialog.tsx`), so one
  Escape closes both the dialog and the detail view behind it.
- **Ship and Resume can be pressed twice.** The session panel's header actions run through `act` with no in-flight
  guard. A double-click on an ended session's **Ship** sends two `POST /api/sessions/<id>/ship`; the server awaits
  before it changes the session's state, so both start an agent in the same worktree. Making the server refuse the
  second start is in-flight change `harden-session-lifecycle` (#347); the UI should not send it in the first place.
- **The blocked-pull dialog vanishes during Resolve and pull.** `PullButton` renders its **Blocked pull** modal only
  while it has a result, and the result is `undefined` while the pull is `running`. Pressing **Resolve and pull**
  therefore closes the modal at once — its "Resolving…" state is never seen — and the outcome appears later only as a
  badge. The end-session dialog's own report already keeps the last result while the pull runs.

## What Changes

- **Argument fields keep the text as typed.** Each one-argument-per-line field keeps its raw text while it is edited
  and stores the parsed list (trimmed lines, empty lines dropped) in the draft; the text is replaced from the saved list
  only when the field is not being edited — on blur or when another profile, a preset or a reset changes it. What is
  saved is unchanged.
- **The end-session dialog stays until its confirmation finishes.** While it is busy, Escape and Cancel do
  nothing and Cancel is disabled. Its Escape listener runs in the capture phase and stops propagation, so Escape closes
  only the dialog and never the view behind it. A confirmation whose session's dialog is no longer the open one drops
  its result instead of reporting into, or closing, another session's dialog.
- **Session panel actions run one at a time.** While one of the panel header's actions (Ship, Resolve conflicts, Merge,
  Resume, Delete record) is in flight, they are all disabled, so a double-click sends one request. This is the UI half;
  the server-side refusal stays with `harden-session-lifecycle`.
- **The blocked-pull dialog stays open while Resolve and pull runs**, showing the last result with Resolve and pull
  disabled ("Resolving…"), and then the new outcome.

## Impact

- `src/ui/agentSettings.tsx` — the Command, Launch arguments, Resume command and Editor command fields (a small field
  component holding the raw text); `src/ui/sessionState.ts` — `parseArgLines` unchanged, possibly a helper for when the
  raw text is replaced.
- `src/ui/endSessionDialog.tsx` — busy guard on Escape and Cancel; capture-phase Escape with
  `stopPropagation`; results dropped for a session that is no longer the dialog's.
- `src/ui/sessionPanel.tsx` — an in-flight flag in `act` and `disabled` on the header actions.
- `src/ui/pull.tsx` — `PullButton` keeps the last result while the repository's pull is running.
- Tests: `test/agentSettingsUi.test.ts`, `test/editorUi.test.ts`, `test/staleState.test.ts` (reads
  `endSessionDialog.tsx`), `test/pullUi.test.ts`, a session-panel test beside `test/mergeUi.test.ts`.
- Specs: `settings-page`, `agent-sessions`, `repository-pull` (ADDED requirements only).
- Overlaps: `harden-session-lifecycle` (#347, in flight) makes the server refuse a second concurrent Ship or Resume
  start; this change only guards the UI and touches none of its files. `add-validate-phase` (in flight) also changes
  `agentSettings.tsx` (a fourth starter prompt) — different fields, a textual merge at most. `agent-params`, so far only a
  prompt in the main checkout, is about agents' launch parameters and may touch the Launch arguments field. `simplify-popups`,
  archived in #376, last changed `endSessionDialog.tsx`'s layout; this change keeps that layout.
