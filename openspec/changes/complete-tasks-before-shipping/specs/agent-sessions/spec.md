## ADDED Requirements

### Requirement: Implementation prompts request complete verified tasks
The preset Implement and Fast-forward prompts SHALL ask the agent to complete and verify every task it can, tick only verified tasks, and report unresolved work with the precise blocker. They SHALL reserve `- [~]` for work that truly requires the user and ask the agent to do all automatable parts first.

#### Scenario: An automated check is left open
- **WHEN** an implementation agent can run a task's check itself
- **THEN** its prompt asks it to run and verify the check and tick the task only after it passes, rather than leave it open or mark it as needing a person

#### Scenario: A human-only task remains
- **WHEN** a task requires a person's action or confirmation
- **THEN** the prompt asks the agent to complete the parts it can, mark the task `- [~]`, and state exactly what the person must do

### Requirement: Ship preflight exposes unfinished tasks
Before Ship commits, pushes or opens a pull request, the dashboard SHALL read task state from the session's own checkout and show unresolved tasks. When any remain, it SHALL offer to ask the agent to finish them and SHALL require explicit confirmation to ship with unresolved tasks. It MUST NOT change task files itself.

#### Scenario: Open tasks before shipping
- **WHEN** Ship is activated and the session checkout has an open task
- **THEN** the preflight names it, offers to ask the agent to complete it, and does not ship without an explicit choice to ship anyway

#### Scenario: Person needed before shipping
- **WHEN** Ship is activated and a task is marked `- [~]`
- **THEN** the preflight shows that task and asks the user to review it; the dashboard does not mark it complete

#### Scenario: A check requires a pull request
- **WHEN** a task can only be verified after a PR is opened
- **THEN** the user can explicitly ship despite that unfinished task, and the agent is asked to report the pending check and revisit it after evidence is available

#### Scenario: All tasks are complete
- **WHEN** the session checkout has readable tasks and every task is checked
- **THEN** deterministic Ship proceeds without an unfinished-task confirmation

#### Scenario: Task state is unavailable
- **WHEN** tasks cannot be read or their state is unknown
- **THEN** the preflight says it cannot verify completion and requires explicit confirmation before Ship

### Requirement: Finish tasks after a merged implementation
For a change with unresolved tasks and a linked merged implementation PR, the dashboard SHALL offer **Finish checks** to ask an agent to verify and finish remaining tasks. It SHALL use the relevant session or a safe session worktree, and SHALL ask the agent to prepare a reviewable task update after verification.

#### Scenario: CI passed on a merged PR
- **WHEN** an implementation PR merged and a task still says to verify its checks
- **THEN** Finish checks asks the agent to inspect the actual check result and tick the task only if the evidence satisfies it, then prepare the update for review

#### Scenario: Evidence is missing or a person is needed
- **WHEN** the agent cannot verify a task or a task needs a person
- **THEN** its instruction says to leave the appropriate task unresolved and report what remains; merge status alone is not evidence of completion

#### Scenario: No session record remains
- **WHEN** a merged implementation has unresolved tasks but no usable session or worktree
- **THEN** Finish checks offers a safe new session based on the change's current checkout, or explains why one cannot be started


### Requirement: Automatic shipping and merging respect task completion
Automatic implementation and archive Ship and docs-only Merge SHALL require a fresh bounded task summary proving every task checked. Awaiting, open, missing, malformed and truncated tasks SHALL withhold automation. Automatic proposal shipping and merging MAY precede task completion because proposals precede implementation. Fast-forward SHALL carry the completion instruction and SHALL use the same server gate rather than infer completion from the agent's exit alone.

#### Scenario: Fast-forward ends with a human check
- **WHEN** a Fast-forward agent exits cleanly with a task marked `- [~]`
- **THEN** the dashboard does not ship automatically, and interactive Ship still offers the unresolved-task choices

#### Scenario: Docs-only work has an old auto-merge record
- **WHEN** a previously shipped implementation or archive has a ready docs-only PR but unresolved tasks in its checkout
- **THEN** the dashboard withholds automatic Merge
