# lifecycle-delivery Specification

## Purpose
Reliably persist completed change phases through GitHub without requiring users to supervise agent terminals or repeat shipping actions.

## Requirements

### Requirement: Completed phases are delivered automatically
For an enabled git project with agent sessions enabled, completing a dashboard-managed Draft, Implement, or Archive action SHALL queue delivery of that phase. Delivery SHALL commit scoped work, push its branch, and create or reuse its phase PR against the default branch. Completion SHALL be verified from files and git, including while an agent remains running; process exit alone SHALL NOT prove completion.

#### Scenario: Draft completes without exiting
- **WHEN** a managed Draft action produces every required planning artifact and the change reaches Ready while Codex remains running
- **THEN** proposal delivery is queued without requiring End session or Ship

#### Scenario: Implementation and archive checkpoints
- **WHEN** a managed implementation reaches Done with every task checked, or its Archive action produces the archive and removes the active directory
- **THEN** the corresponding implementation or archive PR is created or updated automatically after fresh eligibility checks

#### Scenario: Imported historical work
- **WHEN** the dashboard first scans an existing Done change with no managed completion event
- **THEN** it displays the change without automatically committing or publishing historical work

#### Scenario: Unsupported delivery
- **WHEN** a managed phase completes in a non-git folder or a repository without a usable GitHub origin or credentials
- **THEN** the phase remains complete and the UI explains why remote persistence is unavailable

### Requirement: Proposal persistence merges independently of docs auto-merge
A completed Draft proposal SHALL be committed on its proposal branch and automatically merged when GitHub protections permit, independently of optional documentation auto-merge. Only the change's planning artifacts and required metadata SHALL enter that proposal. Code, unrelated change files, and implementation task completion SHALL NOT be prerequisites for persisting a valid proposal.

#### Scenario: Optional auto-merge is disabled
- **WHEN** Draft reaches Ready and the project has docs auto-merge off
- **THEN** Spec Control creates the proposal PR and merges it when eligible

#### Scenario: Unrelated modifications
- **WHEN** drafting is complete but the same worktree contains modified application code or another change's files
- **THEN** automatic proposal delivery is blocked with the offending paths and a recovery action; no unrelated files are committed

#### Scenario: Proposal is blocked by GitHub
- **WHEN** required checks fail or branch protection requires approval
- **THEN** the Ready phase remains visible with a pending persistence status and a link to the blocker

### Requirement: Persistence and phase progress are distinct
The UI SHALL distinguish local phase completion from committing, pushing, PR open, waiting, and merged persistence. Implementation PRs containing code SHALL NOT be automatically merged by proposal persistence. Archive and documentation PRs SHALL follow the project's documentation merge policy. Starting implementation SHALL NOT silently stop a running drafting agent or discard its pending delivery.

#### Scenario: Code implementation completes
- **WHEN** verified implementation completes and its PR contains code
- **THEN** its PR opens automatically and remains available for human review and merge

#### Scenario: Continue before proposal merge
- **WHEN** a proposal PR is pending and the user explicitly advances to Implement
- **THEN** the existing confirmed session handoff is used and the new worktree includes the planning artifacts while proposal delivery remains tracked separately

### Requirement: Delivery resumes without duplicate remote operations
Checkpoint state SHALL survive restarts and retain phase identity, artifact evidence, branch, head, PR, progress, and blocker. Reconciliation SHALL verify current local and remote evidence before advancing or retrying. Repeated observations, concurrent requests, and a restart after an uncertain remote response SHALL reuse the same PR and SHALL NOT create duplicate commits, PRs, or merges.

#### Scenario: Restart after PR creation
- **WHEN** GitHub created a proposal PR but the dashboard restarted before saving success
- **THEN** reconciliation finds the PR for the recorded branch and resumes its merge checks

#### Scenario: Source changes during delivery
- **WHEN** the agent changes checkpoint files after delivery inspected them
- **THEN** delivery rechecks the snapshot before committing and reports or retries the newer revision without claiming it persisted the older evidence

### Requirement: Blockers are actionable and recoverable
Every failed or withheld automatic action SHALL expose its current reason and relevant Retry, Open PR, Resume agent, or Resolve conflicts action. Transient failures SHALL retry with bounded backoff; permission, conflicting content, and policy blockers SHALL wait for changed evidence or explicit retry. Resolved blockers SHALL resume the pending operation without requiring another lifecycle transition.

#### Scenario: Credentials restored
- **WHEN** push was blocked by missing credentials and the user restores credentials and chooses Retry
- **THEN** the same checkpoint continues without repeating Draft or creating another proposal

### Requirement: Automation respects active work and host permissions
Delivery SHALL use the existing scoped Ship and Merge execution boundaries and fresh head checks. It SHALL NOT force push, switch the main checkout, weaken agent permissions, silently end a running agent, or remove a worktree holding newer work. Manual Ship and automatic delivery SHALL serialize against the same checkpoint and worktree.

#### Scenario: New work after proposal merge
- **WHEN** the proposal merges while the agent has newer uncommitted work
- **THEN** delivery records the merge and preserves the agent and worktree

### Requirement: A running agent explicitly marks its completed phase
Automatic delivery while an agent runs SHALL require a fresh completion report bound to the current managed action and phase, followed by independent verification of required artifacts, tasks, and stable file/git evidence. File existence or terminal silence alone SHALL NOT authorize delivery. Exit with verified outputs remains a fallback. Missing reports SHALL expose a completion-confirmation recovery action.

#### Scenario: Agent pauses mid-draft
- **WHEN** required artifact files exist but the running agent has not reported completion of the current action
- **THEN** automatic delivery does not publish that intermediate snapshot

#### Scenario: Old completion report
- **WHEN** the report belongs to a prior action, phase, or session revision
- **THEN** it cannot authorize a new checkpoint

#### Scenario: Completion signal without valid outputs
- **WHEN** an agent reports phase completion but required files or task evidence are incomplete
- **THEN** the checkpoint remains blocked with the actual missing evidence
