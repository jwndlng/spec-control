## MODIFIED Requirements

### Requirement: Ship preflight exposes unfinished tasks

Before Ship, the dashboard SHALL inspect task state in the session's own checkout and preserve an accurate summary of
unfinished or unknown tasks for the user. When the change's required artifacts are ready, unresolved tasks SHALL NOT
prevent an explicit Ship action from committing, pushing or opening its pull request. Ship SHALL NOT edit task files,
mark tasks complete, or claim that unresolved checks passed. If tasks cannot be read, Ship SHALL report that their
state is unknown and SHALL still allow the explicit action when the required artifacts are ready. The dashboard SHALL
continue to gate Implement and automatic implementation on task completion under their existing requirements.

#### Scenario: Open tasks before shipping

- **WHEN** Ship is activated for an artifact-ready change with an open task
- **THEN** Ship proceeds and reports the task as unresolved without requiring a task-specific override

#### Scenario: Person needed before shipping

- **WHEN** Ship is activated for an artifact-ready change with a task marked as needing a person
- **THEN** Ship proceeds and reports that task for review without changing its state

#### Scenario: Task state is unavailable

- **WHEN** task files are missing, malformed, unreadable or truncated
- **THEN** Ship reports that task state could not be verified and proceeds if the required artifacts are ready

#### Scenario: Required artifacts are not ready

- **WHEN** Ship is activated before the required artifacts are ready
- **THEN** the existing artifact-readiness refusal remains in force

#### Scenario: A check requires a pull request

- **WHEN** a remaining check requires a pull request or its CI
- **THEN** explicit Ship opens the pull request and reports the unresolved check without changing its marker

#### Scenario: All tasks are complete

- **WHEN** every task is marked complete and required artifacts are ready
- **THEN** Ship proceeds without task confirmation and reports the task summary

## ADDED Requirements

### Requirement: Ship returns an actionable pull request result

When Ship finds or creates a pull request, its result SHALL include the pull request URL and whether it was newly
created or already existed. The UI SHALL present a direct link to that pull request and report any unresolved or
unknown task state alongside the result. It SHALL offer the applicable existing agent action for reviewing PR
feedback or resolving conflicts, without starting an agent automatically. A successful Ship SHALL NOT imply that the
pull request is merged, that checks passed, or that unresolved tasks were completed.

#### Scenario: Ship creates a pull request

- **WHEN** Ship successfully creates a pull request
- **THEN** its result gives the user a direct link and identifies the pull request as newly created

#### Scenario: Ship finds an existing pull request

- **WHEN** Ship finds a pull request for the session branch
- **THEN** its result gives the user a direct link and identifies the existing pull request without changing its body

#### Scenario: User follows up on pull request feedback

- **WHEN** Ship has returned a pull request and the session can run the relevant agent action
- **THEN** the UI lets the user open the pull request and explicitly ask the agent to review feedback or resolve
  conflicts

#### Scenario: Pull request URL is unavailable

- **WHEN** Ship cannot obtain a valid pull request URL
- **THEN** it does not report a complete successful Ship result without a review destination

### Requirement: Explicit Archive is not blocked by unfinished tasks

For a change whose required artifacts are ready for Archive, unresolved or unknown task state SHALL NOT prevent an
explicit Archive action. Archive SHALL preserve task state and SHALL NOT imply that outstanding work was completed.
Automatic Archive SHALL continue to follow its separate eligibility requirements, including its task completion gate.

#### Scenario: Ready change has unresolved tasks

- **WHEN** Archive is explicitly activated for a change with required artifacts ready and one or more unresolved tasks
- **THEN** Archive proceeds while preserving those task states
