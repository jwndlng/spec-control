# Proposal

## Why

`ship-proposals-as-docs-prs` gave a Draft session in a docs auto-merge project its own branch, `docs/<name>`, and let one
other session of the change run beside it, because implementing must never continue on the proposal's branch. That
exception broke two things `one-next-action-per-stage` had just settled:

- **The proposal's console goes blank in `Ready`.** The Console tab offers only the steps its own session would receive,
  and a session on `docs/<name>` receives Draft alone. Once the proposal is written the change is in `Ready`, its only
  starter is Implement, and the tab shows no action at all — the split button that is supposed to always carry the next
  step disappears.
- **A change has two consoles.** Implement started from the card runs beside the proposal session, so the Console tab
  lists two running sessions with their own terminals, badges and next steps. Which one gets a prompt depends on a rule
  the user cannot see. One change, one console was the point of "Session lifecycle and control".

## What Changes

- **One running session per change again, without exception.** A Draft session on `docs/<name>` counts like any other.
  A request to open any action but Draft while it runs is refused with a reason naming its branch, unless the request
  explicitly asks to end it first. The card shows only that session's badge and no starter, as for every running
  session. Resume is refused while another session of the change runs.
- **The proposal session gives way to the next step.** Its Console tab offers Draft (sent into it) and every other
  starter the stage allows but Fast-forward, labelled as *ending the proposal session and starting* that action, in the
  same split button with the same recommendation. Activating **Implement** ends the proposal session, keeps its worktree
  and branch, starts Implement on `feat/<name>` (from `docs/<name>` while the proposal is not merged, as today) and shows
  the new session. It asks one confirmation only when the proposal worktree is uncommitted or unpushed; otherwise
  nothing is lost and it asks nothing.
- **The proposal pull request still merges on its own.** An ended proposal session that carries the auto-merge record
  hands its pull request to the change's running session: when the proposal pull request is ready under exactly the
  existing checks (made on the proposal's kept worktree), the Merge prompt — with one more sentence naming
  `docs/<name>` — is sent to the Implement session, recorded on the proposal session so it is sent once per head commit.
  Its panel offers the same Merge by hand. Once the pull request merges, the existing rule removes the proposal's clean
  worktree and keeps its branch.
- **The console's session list** keeps listing ended sessions; at most one of them runs.
- No new write to a tracked repository, no new git subcommand, no network access and no `gh` process: ending a session
  and starting one are existing operations, and the Merge prompt goes through `submit.ts` like every other.

## Non-goals

- Drafting on `feat/<name>` again: the proposal keeps its own branch and docs-only pull request.
- Ending the proposal session automatically when the proposal pull request opens: the user decides when to move on.
- Changing which branch Implement starts from, or Fast-forward.

## Capabilities

### New Capabilities

### Modified Capabilities

- `agent-sessions`: "Session lifecycle and control" drops the docs-branch exception and refuses Resume beside a running
  session; new "The proposal session gives way to the next step" and "An ended proposal session's pull request is merged
  through the change's running session"; "A ready docs-only pull request is handed to its agent to merge" and "Merge
  asks the agent to merge its ready pull request" point at the latter.
- `change-detail`: "The console tab offers the change's next step" offers the proposal session's next steps;
  "The console tab selects among the change's sessions" says at most one session runs.

## Impact

- `src/shared/sessionBranch.ts` (`receivingSession`), `src/ui/sessionState.ts` (`cardSessionControls`, `nextStepFor`, a
  pure helper for the console's steps), `src/ui/sessions.tsx` (`SessionControls`, `start`), `src/ui/sessionPanel.tsx`,
  `src/ui/api.ts`
- `src/server/sessions/manager.ts` (`open` with end-first, `resume`, `requestReadyMerges`, manual Merge),
  `src/server/sessions/agents.ts` (the proposal-handover sentence), `src/server/api.ts` (request field),
  `src/shared/types.ts`
- `src/ui/helpContent.tsx`, `src/ui/changelog.ts`
- Tests: `test/sessionState.test.ts`, session manager tests with `test/fixtures/fake-agent.ts`, auto-merge tests with
  `test/fixtures/fake-gh.ts`
