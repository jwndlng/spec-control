## ADDED Requirements

### Requirement: Merged changes can finish unresolved tasks
When a change has unresolved tasks and a linked merged implementation pull request, its card and Console tab SHALL make **Finish checks** discoverable when agent sessions are enabled. The action SHALL lead to the agent workflow for finishing the tasks and SHALL NOT itself tick tasks, merge, push or contact GitHub.

#### Scenario: Merged implementation has an open task
- **WHEN** a change has a linked merged implementation PR and an unchecked task
- **THEN** its card offers Finish checks, even though the change remains in Implementing and Archive is unavailable

#### Scenario: Pull request information is unavailable
- **WHEN** a change has unresolved tasks but no known merged implementation PR
- **THEN** no merged-PR-specific action is inferred, and the ordinary console remains available

#### Scenario: A running session exists
- **WHEN** Finish checks is offered for a change with a running session
- **THEN** it leads to that session's console and does not start a second agent
