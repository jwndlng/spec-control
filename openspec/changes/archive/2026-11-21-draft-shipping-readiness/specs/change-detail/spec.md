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

### Requirement: Working phases describe the operation
Each actively working checkpoint SHALL display its current operation and suppress a duplicate starter for that operation.
#### Scenario: Work in progress
- **WHEN** drafting, implementation, fast-forward, validation or archival is running
- **THEN** its checkpoint describes the work in progress and pulses until the agent waits or exits
#### Scenario: Implementation and archive verification
- **WHEN** implementation tasks are verified complete, or an archive exists with completed or explicitly accepted unresolved tasks
- **THEN** offer manual shipping as an optional disclosure and keep explicit recovery visible
