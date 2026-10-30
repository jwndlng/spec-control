# Spec Delta

## ADDED Requirements

### Requirement: Fix checks resumes the matching pull-request session
When a change in `Done` has a linked open pull request whose checks are failing, activating **Fix checks** SHALL refresh
the session list and resume the ended, resumable session whose branch heads that pull request, then open the change's Console tab with that session
selected. If the matching session is already running, it SHALL only open that session's Console tab and MUST NOT start a
second process. It MUST NOT send a prompt. If no matching session exists or it cannot be resumed, the control SHALL
explain that it is unavailable and MUST NOT open an unrelated session or an empty Console tab. The resume endpoint's
refusal SHALL be shown to the user, and the dashboard SHALL NOT navigate as though the session resumed.

#### Scenario: Fix checks resumes the session for the pull request
- **WHEN** `rotate-keys` is in `Done`, `#58`'s checks fail, and its ended, resumable Implement session's branch heads `#58`
- **THEN** activating **Fix checks** resumes that session and opens the change's Console tab with it selected

#### Scenario: Fix checks opens an already running session
- **WHEN** `rotate-keys` is in `Done`, `#58`'s checks fail, and the matching session is already running
- **THEN** activating **Fix checks** opens that session's Console tab without starting another process

#### Scenario: Fix checks has no resumable matching session
- **WHEN** `rotate-keys` is in `Done`, `#58`'s checks fail, and no resumable session has a branch matching `#58`
- **THEN** **Fix checks** explains that it is unavailable and does not open another session or an empty Console tab

#### Scenario: Resuming the session fails
- **WHEN** the matching session becomes non-resumable before the user activates **Fix checks** and the resume endpoint refuses
- **THEN** the refusal is shown on the current view and the dashboard does not navigate to the Console tab as if it resumed
