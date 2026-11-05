## ADDED Requirements

### Requirement: Continue pending archives

A pending archived card without a running session SHALL offer **Continue archive** when agent sessions are enabled, opening the change's console so its session can be resumed or its work shipped. An archive found in a linked worktree SHALL show its **Needs you** badge for awaiting tasks.

#### Scenario: Archive without a pull request
- **WHEN** an archive is pending in a linked worktree and its session has exited
- **THEN** its card offers **Continue archive**, which opens its console

#### Scenario: Archive has tasks awaiting the user
- **WHEN** an archive in a linked worktree contains tasks marked as needing the user
- **THEN** its card shows the **Needs you** badge with those tasks
