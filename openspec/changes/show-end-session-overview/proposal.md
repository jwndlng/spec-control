# Proposal

## Why

When an archived change's pull request is merged, its session has nothing left to do. While the dashboard automatically ends sessions whose pull request merged when safe, sessions may remain running — because automatic session ending is disabled in Settings, the worktree held uncommitted changes or an untracked file at the time of the query, or the agent moved on.

Today, a card on the Kanban board never offers a control to end a session. For an archived and merged change that has not been automatically ended, the user has to notice the running session, open the console overlay or navigate to the Console tab in the change detail view, and click **End session** there. Exposing the **End session** button directly on the card for an archived, merged change with a running session lets the user end the session and clean up the worktree straight from the board.

## What Changes

- When an archived change has a running session that has not been automatically ended, and its pull request is listed merged (or its work status is `merged`), its card on the Kanban board offers **End session** in its footer beside the session badge.
- Activating **End session** opens the existing end-session confirmation dialog for that session (`ui.requestEnd(session.id)`), allowing the user to confirm ending the agent, optionally remove the worktree when safe, and pull.
- The **End session** button is not offered for active (non-archived) changes, changes whose pull request is not merged, sessions that have already been automatically ended (`session.autoEnded !== undefined`), or where agent sessions are disabled.
- The exception to the rule that cards do not offer session termination is formalized: only archived, merged changes whose session has not ended automatically offer **End session** on the card.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `kanban-board`: The card session control requirements and the end-session dialog requirement are updated to permit and specify the **End session** button on the card for an archived, merged change whose session has not been automatically ended.

## Impact

- `src/ui/sessionState.ts`: Update `cardSessionControls` (or a helper used by `SessionControls`) to detect eligible archived, merged changes with running sessions and offer the **End session** action.
- `src/ui/sessions.tsx`: Update `SessionControls` to render the **End session** button on the card when offered, wired to `ui.requestEnd(session.id)`.
- Tests: Add unit tests in `test/sessionControls.test.ts` (or `test/kanban.test.ts` / `test/sessionState.test.ts`) covering card controls for archived merged changes with running sessions, auto-ended sessions, unmerged sessions, and active changes.
