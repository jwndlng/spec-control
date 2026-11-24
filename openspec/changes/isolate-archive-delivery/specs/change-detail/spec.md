## ADDED Requirements

### Requirement: Archive delivery has its own pull request

The archive checkpoint SHALL show only archive delivery. While an implementation pull request is open, the dashboard SHALL ask the user to merge it before starting Archive.

#### Scenario: Archive attempted during implementation review

- **WHEN** the implementation pull request is open and the local implementation is complete
- **THEN** the implementation checkpoint retains its pull request and the archive checkpoint explains that it can start after merge

#### Scenario: Historical archive delivery reused an implementation pull request

- **WHEN** an earlier archive attempt recorded the implementation pull request
- **THEN** the timeline shows that pull request only under Implementing

#### Scenario: Implementation session remains open after merge

- **WHEN** the implementation pull request has merged and the implementation session is still running
- **THEN** the archive checkpoint offers to end that session so Archive can start on its own branch
