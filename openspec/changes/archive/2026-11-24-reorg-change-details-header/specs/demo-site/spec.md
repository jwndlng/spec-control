# Spec Delta

## MODIFIED Requirements

### Requirement: Linked pull requests are simulated in the demo
The demo's synthetic data SHALL give at least one change a pull request whose head branch equals that change's `branchMatch`, and at least one change a branch with no pull request, so that both the card link and the matching timeline checkpoint are reachable, and so that the absence case is visible too. At least one simulated pull request SHALL be merged or closed and one a draft, so the states render. The demo MUST NOT start a process or make a network request for any of this, and opening a demo board MUST NOT attempt a refresh.

#### Scenario: A card links to a simulated pull request
- **WHEN** the demo board is opened
- **THEN** at least one card shows `PR #<number>` and at least one card with a branch shows none

#### Scenario: The detail header in the demo
- **WHEN** the visitor opens the detail view of a change with a simulated pull request
- **THEN** the matching delivery checkpoint links to the simulated PR and the header omits its details

#### Scenario: The demo stays offline
- **WHEN** the visitor opens a demo board
- **THEN** no refresh is attempted and no network request is made
