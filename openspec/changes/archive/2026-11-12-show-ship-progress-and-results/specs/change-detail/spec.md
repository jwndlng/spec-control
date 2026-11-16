## ADDED Requirements

### Requirement: Ship acknowledges work immediately
Activating Ship SHALL immediately show a visible Shipping state and prevent duplicate submissions for that operation. Task confirmation SHALL be presented as a separate preflight state. Progress SHALL use server-observed stages when available and otherwise a truthful busy label, without invented percentages or success claims.

#### Scenario: Slow push
- **WHEN** pushing takes several seconds
- **THEN** the user sees Shipping or Pushing and cannot accidentally submit another Ship operation

#### Scenario: Cancel preflight
- **WHEN** the user cancels an unfinished-task confirmation
- **THEN** no shipping success is announced and no remote operation is started

### Requirement: Ship leaves a useful result
Successful Ship SHALL show a persistent confirmation with the verified created or reused PR link. Failure SHALL identify the failed step, preserve verified partial outcomes, and offer safe recovery. Tab changes and session refreshes SHALL NOT silently erase progress or results. A network timeout SHALL NOT be represented as confirmed failure or success of an unknown remote operation.

#### Scenario: PR created
- **WHEN** Ship verifies an existing or newly created PR
- **THEN** the user sees success and Open PR without inspecting terminal output or manually refreshing the page

#### Scenario: PR creation fails after push
- **WHEN** the branch push succeeded but PR creation failed
- **THEN** the result says the branch was pushed, explains PR creation failed, and offers Retry that reuses remote evidence

#### Scenario: Lost response or reload
- **WHEN** the response is lost or the user reloads during shipping
- **THEN** the UI reconciles the known operation from server status before permitting a duplicate operation or announcing its result
