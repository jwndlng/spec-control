# Design

## Context

See proposal.md for motivation. The current end-session dialog waits for the full confirmation, including worktree removal and cleanup of stale leftovers. The session lifecycle and cleanup checks must continue to enforce the repository's read-only and explicit-confirmation rules in `CLAUDE.md` and the agent-sessions spec.

## Goals / Non-Goals

**Goals:**

- Return the dashboard to an interactive state as soon as session ending is complete, even if confirmed cleanup is still running.
- Preserve cleanup checks and give the user a reliable completion or failure report.

**Non-Goals:**

- Moving session shutdown itself into the background; the UI must know that the agent has ended before closing the dialog.
- Changing which cleanup actions require confirmation or which paths may be removed.

## Decisions

- Treat ending the agent and its cleanup as separate lifecycle phases. The end request completes after the agent is ended and cleanup has been safely accepted for execution; cleanup continues in a tracked background operation.
- Associate the cleanup operation and its eventual result with the session identity, not whichever dialog happens to be open when it finishes. Surface completion through dashboard-level feedback that remains available after the dialog closes.
- Keep existing server-side rechecks immediately before destructive cleanup. The background operation must use the same checks, backup behavior and per-item reporting as the foreground flow; moving it off the request path does not weaken authorization or safety conditions.
- If session ending fails, do not start cleanup and keep the dialog open to report the failure. If cleanup fails after ending, report that the session ended but cleanup did not complete, including the existing reason or recovery guidance.

## Risks / Trade-offs

- A process restart could interrupt an in-memory background operation → retain enough operation state to report an interrupted cleanup on the next load, or otherwise ensure the user can discover and retry it.
- The user may navigate away before cleanup finishes → report completion through a dashboard-level surface rather than dialog-local state.
- Cleanup may take a long time or fail after session end → distinguish session end from cleanup completion in the result and retain the existing safe retry path.
