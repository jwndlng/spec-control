# Fix checks resumes the session that shipped the pull request

## Why

When a completed change's linked pull request has failing checks, its card offers **Fix checks**. Today that action only
navigates to the Console tab. If the agent session has ended, the console remains stopped until the user finds and clicks
**Resume**, so the action labelled **Fix checks** does not reopen the session the user needs.

## What Changes

- Activating **Fix checks** for a failing pull request resumes the ended, resumable session whose branch heads that pull
  request, then opens that session in the change's Console tab.
- If that session is already running, the action only opens its Console tab; it never starts a second process.
- When no matching resumable session exists, the action explains that the session cannot be resumed instead of silently
  opening an empty or unrelated console.
- Resuming uses the existing session-resume operation and its checks. The dashboard does not send a prompt or change
  repository contents; the user can direct the resumed agent in its terminal.

## Capabilities

### Modified Capabilities

- `kanban-board`: Fix checks reopens the matching session and selects it in the Console tab.

## Impact

- `src/ui/sessions.tsx`: make the Fix checks action resume its matching ended session before opening it, and handle a
  missing or non-resumable target clearly.
- `src/ui/sessionState.ts`: expose the action's matching target state if needed.
- `test/nextStep.test.ts`, session UI tests: cover target selection, resume, running-session navigation and unavailable
  targets.
- `openspec/specs/kanban-board/spec.md`: specify the resume behavior.
