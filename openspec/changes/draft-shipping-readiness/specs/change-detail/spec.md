## ADDED Requirements
### Requirement: Draft progress distinguishes writing from manual shipping
The Drafts checkpoint SHALL keep manual shipping out of the normal writing flow.
#### Scenario: Planning is incomplete
- **WHEN** the agent is drafting and the change has yet to reach Ready
- **THEN** show progress without offering manual completion or shipping
#### Scenario: Planning files are ready
- **WHEN** a running managed draft has reached Ready and automatic delivery has yet to start
- **THEN** make manual verification and shipping available through a collapsed disclosure
#### Scenario: Verification needs attention
- **WHEN** the current draft requires explicit reconfirmation or confirmation has been accepted
- **THEN** show its recovery control or verification status directly
