## ADDED Requirements

### Requirement: Events recorded while the dashboard stops reach the log
When the dashboard is stopped, every activity event recorded before its process exits — in particular the session-ended events of the sessions the stop ends — SHALL be written to `activity.jsonl`, or its write SHALL have failed and been reported, before the process exits. The stop SHALL wait for the log's queued writes after the sessions have ended and MUST NOT wait for anything else of the log; a failed write MUST NOT keep the dashboard from exiting.

#### Scenario: Stopped with a running session
- **WHEN** a session for `cache-api-calls` is running and the dashboard receives `SIGINT`
- **THEN** `activity.jsonl` holds a session-ended event for `cache-api-calls` when the process has exited

#### Scenario: The log cannot be written
- **WHEN** the dashboard is stopped and appending to `activity.jsonl` fails
- **THEN** the failure is reported once and the dashboard exits
