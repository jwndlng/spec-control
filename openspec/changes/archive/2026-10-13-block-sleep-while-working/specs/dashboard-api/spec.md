# Spec Delta

## ADDED Requirements

### Requirement: The session list reports keep-awake

`GET /api/sessions` SHALL additionally return `keepAwake: { available, enabled, active, sessions }`: `available` whether
keep-awake can work on this machine (macOS with `/usr/bin/caffeinate`), `enabled` whether the setting is on, `active`
whether the server currently prevents idle system sleep, and `sessions` the number of sessions that count as busy at
the time of the request. Answering it SHALL evaluate keep-awake with the reports read for that same request, and MUST
NOT start any process other than the one the `keep-awake` capability allows. No other route SHALL be added for it; the
setting is saved with `PUT /api/config`.

#### Scenario: Status with a busy session
- **WHEN** `GET /api/sessions` is requested on macOS with keep-awake on and one session busy
- **THEN** the response holds `keepAwake: { available: true, enabled: true, active: true, sessions: 1 }`

#### Scenario: Status when switched off
- **WHEN** `GET /api/sessions` is requested with `keepAwake: false` in the configuration and one session busy
- **THEN** the response holds `enabled: false`, `active: false` and `sessions: 1`, and no keep-awake process runs
