## ADDED Requirements

### Requirement: Lifecycle observation handles unavailable Git quietly
When Git cannot be resolved or a worktree cannot be inspected, lifecycle observation SHALL treat Git evidence as unavailable and wait for a later scan. It SHALL NOT repeatedly emit process-spawn errors for the missing executable.

#### Scenario: Git is not on the server PATH
- **WHEN** lifecycle observation runs without a resolvable Git executable
- **THEN** it produces no Git-backed evidence, leaves phase delivery unchanged, and emits no spawn error
