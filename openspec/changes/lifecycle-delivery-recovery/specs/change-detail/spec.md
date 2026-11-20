# Spec Delta

## ADDED Requirements

### Requirement: A blocked phase can be confirmed again
When a delivery blocker offers phase-completion confirmation for the current running managed action, the corresponding phase checkpoint SHALL make that recovery action available again and show its updated verification state.

#### Scenario: Worktree changed after phase confirmation
- **WHEN** a running phase's delivery is blocked because the worktree changed after the prior confirmation
- **THEN** the phase checkpoint offers confirmation again, shows progress after activation, and exposes the resulting blocker or delivery state

### Requirement: Detail shows one current delivery status per phase
The detail view SHALL show at most one delivery status per phase and SHALL hide retry actions when that phase is already complete.

#### Scenario: Old retries and merged pull request
- **WHEN** several delivery records exist for one phase and its pull request or branch is merged
- **THEN** the detail view shows the merged checkpoint without historical blocked rows or retry actions
