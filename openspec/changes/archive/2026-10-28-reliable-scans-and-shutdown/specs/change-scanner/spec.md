## MODIFIED Requirements

### Requirement: Scanner polls enabled repositories on an interval
The scanner SHALL scan every enabled repository each `pollIntervalSeconds` (default 60) and on explicit trigger. Repositories MUST be scanned concurrently with a bounded concurrency (default 4) and a per-repository timeout. If a scan is already in flight, a trigger MUST NOT start a second concurrent full scan; instead it SHALL queue exactly one follow-up scan, which starts once the running scan has finished and reads the configuration and the repositories afresh, so that whatever was written before the trigger is in the snapshot it produces. Any number of triggers while a scan is in flight SHALL queue that one follow-up and no more, and at most one scan SHALL run at any time.

#### Scenario: Periodic scan
- **WHEN** the dashboard is running with `pollIntervalSeconds: 60`
- **THEN** every enabled repository is rescanned at least once per 60 seconds

#### Scenario: Trigger while in flight
- **WHEN** a scan is running and `POST /api/scan` is called
- **THEN** the response is `{ started: false }`, no second scan starts while the first runs, and one follow-up scan starts once it has finished

#### Scenario: A repository enabled during a scan
- **WHEN** a scan of `demo-ops` is in flight with `pollIntervalSeconds: 3600` and the user enables `beta-soc`
- **THEN** once the follow-up scan has finished the snapshot holds both `demo-ops` and `beta-soc`, without waiting for the next poll

#### Scenario: Many triggers, one follow-up
- **WHEN** three changes are created in `demo-ops` while one scan is in flight
- **THEN** exactly one follow-up scan runs after it and its snapshot holds all three changes
