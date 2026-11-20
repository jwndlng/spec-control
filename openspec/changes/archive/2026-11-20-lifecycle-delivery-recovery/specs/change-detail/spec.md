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

#### Scenario: Delivery is waiting for a pull request to merge
- **WHEN** a delivery is waiting on its pull request
- **THEN** its status and pull request number appear once at the matching checkpoint, without a duplicate delivery notice

### Requirement: Confirmation explains the next action
The phase confirmation action SHALL explain that verification runs before shipping and SHALL immediately show that verification has started after the server accepts it.

#### Scenario: Confirming a phase before shipping
- **WHEN** the user confirms phase completion
- **THEN** the action says it will verify and ship, and accepted confirmation immediately shows verification in progress

### Requirement: Archive Ship follows the archive session
The Archive checkpoint SHALL use the change's archive session regardless of which session is selected in the Console tab.

#### Scenario: Ship an archive while another console session is selected
- **WHEN** an archive pull request is unshipped and the change has a shippable archive worktree
- **THEN** the Archive checkpoint offers Ship from that archive session even if another session is selected
