## ADDED Requirements

### Requirement: Stopping the dashboard waits until every agent has ended
When the dashboard is stopped while agent sessions run, it SHALL send every running agent the hang-up, wait for each agent's process to exit for at most a grace period of two seconds, send a forced kill (`SIGKILL`) to every agent still running after it, and wait for those to exit for at most one more second, before it records the sessions as ended because the dashboard was stopped and before the dashboard's own process exits. It MUST NOT exit while an agent it started could still be running without having sent that agent the forced kill. An agent that is still running after the forced kill and the second wait SHALL be reported on standard error with its process id. The whole wait SHALL be bounded so that the desktop app's stop, which waits ten seconds before it kills the server, is never reached because of it.

#### Scenario: An agent that ignores the hang-up
- **WHEN** a session for `rotate-keys` runs an agent that ignores `SIGHUP` and the dashboard receives `SIGTERM`
- **THEN** the agent is sent `SIGKILL` about two seconds later, its process no longer exists when the dashboard exits, and the session is recorded as ended because the dashboard was stopped

#### Scenario: Resume after a stop
- **WHEN** the dashboard was stopped while that session ran, is started again and the user presses Resume
- **THEN** exactly one agent runs in the session's worktree

#### Scenario: Agents that exit at once
- **WHEN** every running agent exits on the hang-up
- **THEN** the dashboard exits as soon as they have, without waiting out the grace period
