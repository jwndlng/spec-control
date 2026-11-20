# Spec Delta

## ADDED Requirements

### Requirement: Already merged work is terminal success
When a lifecycle retry determines that the phase branch's contents are already in the base, the delivery checkpoint SHALL show completion and SHALL NOT offer another retry.

#### Scenario: Retry finds work already merged
- **WHEN** a retry reports that there is nothing to ship because the branch is merged
- **THEN** the delivery is recorded as merged and no further retry is offered

## MODIFIED Requirements

### Requirement: A running agent explicitly marks its completed phase
Automatic delivery while an agent runs SHALL require a fresh completion report bound to the current managed action and phase, followed by independent verification of required artifacts, tasks, and stable file/git evidence. File existence or terminal silence alone SHALL NOT authorize delivery. Exit with verified outputs remains a fallback. Missing reports SHALL expose a completion-confirmation recovery action. A user's repeated completion confirmation for the same current managed action SHALL advance its completion revision so changed worktree evidence can be re-observed, while retaining every verification gate.

#### Scenario: Agent pauses mid-draft
- **WHEN** required artifact files exist but the running agent has not reported completion of the current action
- **THEN** automatic delivery does not publish that intermediate snapshot

#### Scenario: Old completion report
- **WHEN** the report belongs to a prior action, phase, or session revision
- **THEN** it cannot authorize a new checkpoint

#### Scenario: Completion signal without valid outputs
- **WHEN** an agent reports phase completion but required files or task evidence are incomplete
- **THEN** the checkpoint remains blocked with the actual missing evidence

#### Scenario: Reconfirm after worktree changes
- **WHEN** delivery for a running managed action was blocked because its worktree changed after confirmation, and the user confirms that phase again
- **THEN** the new confirmation has a higher revision and independently verifies the updated stable evidence before delivery
