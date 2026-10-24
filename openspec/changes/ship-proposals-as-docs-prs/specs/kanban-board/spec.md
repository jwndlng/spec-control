## ADDED Requirements

### Requirement: A card names a proposal pull request as such
When a change's linked pull request is its proposal pull request (`pull-requests`: "A proposal pull request is linked to its change"), the change's card and its detail header SHALL label the pull-request badge as the proposal pull request — for example `Proposal #90` — together with the readiness every linked pull request shows, and any recommended step the card derives from that pull request SHALL name it the same way. Nothing else about the badge, the card's column, counts or available actions SHALL differ from any other linked pull request.

#### Scenario: Proposal checks running
- **WHEN** `rotate-keys` is `Ready` and its linked pull request `#90` from `docs/rotate-keys` is open with checks running
- **THEN** the card's badge reads as the proposal pull request `#90`, its state says the checks are running, and **Implement** is still available for the change

#### Scenario: Implementation pull request
- **WHEN** the linked pull request is `#94` from `feat/rotate-keys`
- **THEN** the badge shows `#94` without the proposal label
