## ADDED Requirements

### Requirement: Fix checks sends a repair prompt for an open pull request

The Fix checks action SHALL ask the agent to diagnose and fix the failing checks of the linked open pull request. The server SHALL verify the PR number and head branch before submitting the prompt or starting an agent. The UI SHALL open the target console and show errors or an unsent prompt when applicable.

#### Scenario: The console is already open

- **WHEN** the user activates Fix checks while a session runs on the pull request branch
- **THEN** the action sends the repair prompt into that session
