# Spec Delta

## MODIFIED Requirements

### Requirement: Maintenance actions are progressively disclosed
Resume, Clean up, Delete record, and Open in editor SHALL be directly visible in a labeled session actions group for the selected session when applicable, without expanding a menu. Their eligibility and confirmations SHALL be retained. The visible worktree path SHALL have an adjacent keyboard-accessible copy icon with success/failure feedback; detail SHALL NOT show a separate Copy cd text button.

#### Scenario: Ended session
- **WHEN** a resumable ended session is selected
- **THEN** Resume is directly available in its actions group without competing with the lifecycle action

#### Scenario: Copy path
- **WHEN** the user activates the icon beside a worktree path
- **THEN** exactly the absolute path is copied, success is announced only after a successful clipboard write, and no command runs

#### Scenario: Small screen and keyboard
- **WHEN** detail is viewed at narrow width or navigated by keyboard
- **THEN** timeline labels, artifact tabs, the always-visible session actions, and copy controls remain reachable with visible focus and no page-wide horizontal overflow
