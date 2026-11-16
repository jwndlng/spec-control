## ADDED Requirements

### Requirement: Ship operation status can be reconciled
Ship SHALL expose a server-issued operation identity, observed stage, running/finished state, verified partial outcomes, final PR identity/URL when known, and actionable error. A read-only authenticated-local status route or session payload SHALL let clients recover status after transport loss or reload. Mutating requests SHALL retain same-origin and session/project eligibility checks and reuse existing Ship serialization.

#### Scenario: Duplicate request
- **WHEN** two Ship requests target the same session while one is active
- **THEN** they expose the same active operation rather than duplicate commits, pushes, or PR creation

#### Scenario: Unknown session
- **WHEN** a status query names an unknown session or operation
- **THEN** the server returns a clear 404 without running git or GitHub operations

#### Scenario: Failure is not a completed PR
- **WHEN** the push succeeds but PR lookup/creation cannot be verified
- **THEN** status reports verified push progress and an unresolved PR result without fabricating a PR URL
