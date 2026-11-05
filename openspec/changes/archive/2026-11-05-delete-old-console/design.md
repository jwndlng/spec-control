# Design

## Context

See `proposal.md` — Why.

The change detail view presents its Console tab when agent sessions apply. When a change has multiple sessions (`sessions.length >= 2`), `ChangeDetail` (`src/ui/changeDetail.tsx`) renders `ConsoleSessionList` (`src/ui/sessionPanel.tsx`) in the left sidebar slot usually occupied by the artifact file list.

Each session entry in `ConsoleSessionList` currently displays the action step label (`STEP_LABEL`), the branch name in monospace, and a status badge (`SessionBadgeView`). The entire entry is a `<button>` that selects the session by setting the URL query parameter `session=<id>`.

Ended sessions are deleted via `api.deleteSession(sessionId)` (`DELETE /api/sessions/:id`), which removes the persisted session record and its stored terminal output from `~/.spec-control/sessions/`. This operation is already implemented on the server and used by the "Delete record" button in the session header (`ConsolePanel`).

## Goals / Non-Goals

**Goals:**
- Provide an "X" removal button on each ended session entry in `ConsoleSessionList`.
- Ensure running sessions never display the removal control.
- Prevent click events on the removal button from triggering session selection.
- Delete the session record via `api.deleteSession(s.id)` and refresh UI state.
- Gracefully fall back to the most recently active remaining session if the removed session was selected.

**Non-Goals:**
- Altering server-side session deletion, process shutdown, or storage pruning.
- Removing git worktrees or branches (worktree cleanup remains separate via git status and clean-up dialogs).
- Adding batch deletion or confirmation modal prompts for session record removal (aligning with the direct "Delete record" action in the header).

## Decisions

### 1. Element structure and click delegation
- In `ConsoleSessionList`, entries are currently rendered as a single `<button>` element. Placing a nested `<button>` inside an outer `<button>` violates HTML specifications and causes inconsistent browser event dispatching.
- **Approach**: Structure each session row as a container (e.g., `div.detail-file.console-session`) containing the main selection button (filling available space) and, for ended sessions (`s.state !== "running"`), a separate remove button (e.g., `.console-session-remove`).
- Clicking the remove button calls `event.stopPropagation()` to ensure session selection is not triggered, executes `api.deleteSession(s.id)`, and triggers a UI refresh (`ui.refresh()`).

### 2. Selection fallback upon removal
- When an ended session is deleted:
  - If the deleted session is the currently selected session (`s.id === selected`), update the detail view URL query by clearing `session` (e.g. `onSelect(undefined)` or removing `session` parameter), which allows `consoleSession` to naturally fall back to `sessions[0]` (the most recently active remaining session).
  - If the deleted session was not selected, preserve the existing selection.
  - If deleting reduces the session count to 1, `ConsoleSessionList` returns `null` as expected, leaving only the primary console panel.

### 3. Visual design and accessibility
- The removal control will be styled consistently with close controls in the application (`aria-label="Remove console"`, `title="Delete this session's record and stored output"`).
- Uses `&times;` (`×`) or an accessible icon, subdued by default with an active/hover highlight.

## Risks / Trade-offs

- **[Risk] Accidental deletion on misclick**: Clicking near the session item could inadvertently trigger the "X".
  - **Mitigation**: Place the removal button at the far right with defined margins and distinct hover styling so selection and deletion hitboxes do not overlap.
- **[Risk] Multiple rapid clicks while deletion request is in flight**:
  - **Mitigation**: Disable the button or guard deletion invocation while the request is pending.
