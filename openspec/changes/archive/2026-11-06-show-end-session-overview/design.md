# Design

## Context

See `proposal.md` - Why.

Currently, `cardSessionControls` in `src/ui/sessionState.ts` computes the session badges and starter actions for a card on the Kanban board. When any session is running (`shown.some(s => s.state === "running")`), it suppresses all starters (`starters: []`, `main: undefined`, `menu: []`) so that the running session badge stands in for the split button. Furthermore, for an archived change (`card.archived`), `availableActions` returns `[]` and `openPullRequest` ignores merged pull requests.

On the board, `cardShownInArchived` keeps an archived change in the `Archived` column while a session is running (`hasRunningSession`), even when **Hide merged** is active. If the session has not been automatically ended by the dashboard (e.g. `agentSessions.endMergedSessions` is switched off, the worktree had uncommitted changes, or a pull-request query has not run), the card displays the running session badge, but offers no action control. The user must open the change console to access the **End session** button.

## Goals / Non-Goals

**Goals:**
- Provide an **End session** button directly on the card for an archived change whose pull request is merged (or work status is `merged`) when a running session has not been automatically ended.
- Open the existing `EndSessionDialog` via `ui.requestEnd(session.id)` upon activation, preserving all existing confirmation, worktree safety, and pull checks.
- Keep card behavior strictly unchanged for active (non-archived) changes, unmerged pull requests, and sessions that have already been automatically ended.
- Maintain pure helper functions in `src/ui/sessionState.ts` so eligibility logic can be asserted without rendering.

**Non-Goals:**
- Ending sessions automatically (that remains the responsibility of the server-side auto-end query handling).
- Modifying the options, layout, or safeguards inside `EndSessionDialog`.
- Allowing running sessions of active (unarchived) changes to be terminated directly from cards.

## Decisions

### D1: Eligibility helper in `sessionState.ts`

Introduce a pure function, e.g. `canEndArchivedSession(card, session, pullRequest, worktree)`:
- `card.archived` is truthy;
- `session` exists, has `state === "running"`, and `session.autoEnded === undefined`;
- Either `pullRequest?.state === "merged"` or `worktree?.work.state === "merged"`.

*Alternatives considered:*
- Checking only `pullRequest?.state === "merged"`: would miss changes merged locally or whose PR metadata has not loaded yet even though local git detected `work.state === "merged"`. Admitting both aligns with how work status and pull requests are judged elsewhere (e.g. `auto-end-session`).
- Returning an `ActionItem` inside `cardSessionControls`: `cardSessionControls` produces `main` and `menu` for split starter buttons; **End session** is a termination action, not a prompt or pull-request next-step. A dedicated property or helper keeps starter semantics clean.

### D2: Placement and rendering in `SessionControls`

In `src/ui/sessions.tsx`, when `place === "card"`, `SessionControls` checks whether the running session is eligible for manual ending under D1. When eligible, it renders an **End session** button (`btn sm`) beside the running session badge:
```tsx
{canEnd && (
  <button
    type="button"
    class="btn sm"
    title={`End the running session of ${card.name}`}
    onClick={() => ui.requestEnd(runningSession.id)}
  >
    End session
  </button>
)}
```

*Alternatives considered:*
- Rendering the button inside `ActionMenu`: `ActionMenu` renders split buttons with keyboard dropdown menus for starters; putting a destructive/ending action in the split button dropdown is awkward and would require re-enabling `ActionMenu` while running. A dedicated button beside the badge matches the visual hierarchy in `sessionPanel.tsx` (`{session.state === "running" ? "End session" : "Clean up"}`).

### D3: Reusing `ui.requestEnd` and `EndSessionDialog`

Activating **End session** calls `ui.requestEnd(session.id)`. The existing `EndSessionDialog` component mounts over the board, grades warnings based on uncommitted/unpushed files, allows safe worktree removal, offers to pull the repository, and updates state upon completion. Once ended, if **Hide merged** is enabled, the card naturally disappears from the `Archived` column as `hasRunningSession` becomes false.

## Risks / Trade-offs

- **Accidental termination from board**: Clicking **End session** on the card does not immediately terminate the process; it opens `EndSessionDialog`, requiring explicit user confirmation.
- **Card layout space**: The card footer in the `Archived` column has ample room because starters (`Implement`, `Archive`, etc.) are never rendered for archived changes.
