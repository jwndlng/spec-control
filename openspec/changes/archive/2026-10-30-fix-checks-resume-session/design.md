# Design: Fix checks resumes the matching session

## Context

`recommendedAction` derives **Fix checks** from a completed change with a linked open pull request whose checks fail.
`SessionControls` finds the change session whose branch matches the pull request head, but its current `pullRequestItem`
callback only navigates to the change's Console tab. The console already has a Resume button backed by
`api.resumeSession(session.id)`.

## Decision

Use the matching session as the only resume target. For a stopped resumable target, activate the existing resume API,
refresh session state, and navigate to the Console tab with that session id selected. For a running target, navigate
without making an API request. Do not select the most recent session as a fallback: it may belong to another branch and
would not fix the checks for this pull request. If the matching session is missing or cannot be resumed, show an
explicit unavailable explanation and leave all sessions untouched.

This action sends no prompt. The resumed agent returns to its existing conversation in the pull request's worktree, and
the user can ask it to address the failing checks in the terminal.

## Risks

- The session may have ended between rendering and activation. The resume endpoint remains authoritative; surface its
  refusal and keep the user on the current view rather than navigating as if it resumed.
- A PR head may have moved since the session was recorded. The existing exact branch match is retained; the UI does not
  claim that the session's commit equals the latest PR head.
