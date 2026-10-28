# Spec Delta

## MODIFIED Requirements

### Requirement: Agent session events are part of the activity
When agent sessions are enabled, the dashboard SHALL record a session being started (with its action and agent name), a session ending (with its exit code, or that it failed and why), a session ended by the dashboard because its pull request merged — its auto-merge pull request, or any session's own pull request under the `agent-sessions` capability's "A merged pull request ends its session when nothing would be lost" — (with the pull request's number and whether its worktree was removed, or why it was kept), Ship being used (with whether the prompt was submitted), Resolve conflicts being used (with whether the prompt was submitted) and Merge being sent (with the pull request's number, whether the dashboard sent it on its own because a docs-only pull request was ready or the user sent it, and whether the prompt was submitted). With agent sessions disabled no session events exist. A Resolve conflicts event records only that the prompt was handed to the agent; whether the conflict was actually resolved is not recorded, because the dashboard never learns it from the agent — it is re-derived from git like every other work status. Likewise a Merge event records only that the prompt was handed to the agent; whether the pull request merged is learned from a later pull-request query, never from the agent.

#### Scenario: A session crashes
- **WHEN** the agent of a session for `cache-api-calls` exits with code 1
- **THEN** a session-ended event for that change with exit code 1 is recorded

#### Scenario: Conflicts handed to the agent
- **WHEN** Resolve conflicts is used for the session of `cache-api-calls` and the prompt is submitted
- **THEN** an event for that change is recorded in the sessions group, stating that the prompt was submitted

#### Scenario: Typed but not confirmed
- **WHEN** Resolve conflicts types the prompt but the agent never shows it, so Enter is not pressed
- **THEN** the recorded event states that the prompt was not submitted

#### Scenario: Ended because its pull request merged
- **WHEN** the dashboard ends the archive session of `cache-api-calls` because its auto-merge pull request `#88` merged, and removes its worktree
- **THEN** one event for that change is recorded in the sessions group, naming `#88` and stating that the worktree was removed, and no separate session-ended event is recorded for the same end

#### Scenario: Ended because its pull request merged without auto-merge
- **WHEN** the dashboard ends the Implement session of `cache-api-calls` because its pull request `#91`, opened without docs auto-merge, merged, and removes its worktree
- **THEN** one event of the same kind is recorded, naming `#91` and stating that the worktree was removed, and no separate session-ended event is recorded for the same end

#### Scenario: Merge sent on its own
- **WHEN** the dashboard sends Merge for pull request `#88` into the running archive session of `cache-api-calls` because it is a ready docs-only pull request, and the prompt is submitted
- **THEN** one event for that change is recorded in the sessions group, naming `#88`, stating that the dashboard sent it and that it was submitted
