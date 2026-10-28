## MODIFIED Requirements

### Requirement: Scan endpoint

`POST /api/scan` SHALL trigger an immediate scan and return `{ started: true }`, or `{ started: false }` if a scan is already in flight. In the latter case the request SHALL queue the follow-up scan the `change-scanner` capability specifies, so that a scan starting after the request has arrived is guaranteed either way and a client needs no second request to get one.

#### Scenario: Trigger
- **WHEN** no scan is running and `POST /api/scan` is called
- **THEN** the response is `{ started: true }` and a new snapshot is available afterwards

#### Scenario: Trigger during a scan
- **WHEN** a scan is running, a change `lint-rules` is created in `demo-ops`, and `POST /api/scan` is called once
- **THEN** the response is `{ started: false }` and, without any further request, a later snapshot shows `lint-rules`

## ADDED Requirements

### Requirement: An interrupted home migration resumes on the next start
Once the rename of the home migration ("The home moves once from its old name") has succeeded, the dashboard SHALL record in `migration.json` in the new home, before it runs any later step, every step it is about to run — the link at the old path, each file whose stored paths it rewrites, dropping the cached snapshot and each worktree it repairs — as pending, and SHALL update that record after every step, removing a step that succeeded and keeping one that failed with its reason. A start that finds the new home with a record listing pending steps SHALL run exactly those steps, whether they failed or were never attempted, and every step MUST be safe to run again: it MUST NOT change a file, link or worktree record that an earlier attempt already brought to its final state. A start that is stopped at any point after the rename — by a signal before the dashboard handles signals, by the desktop app or by a crash — MUST therefore leave the migration to be finished by the next start, never treated as done.

#### Scenario: Stopped right after the rename
- **WHEN** `~/.openspec-dashboard/` holding two session worktrees of `demo-ops` has been renamed to `~/.spec-control/` and the process is killed before the link is made
- **THEN** the next start creates the link at `~/.openspec-dashboard`, rewrites the session records' worktree paths, runs `git worktree repair` for both worktrees, and leaves `migration.json` with no pending steps

#### Scenario: Stopped halfway through the steps
- **WHEN** the migration made the link and rewrote `config.json` and was then stopped before any worktree was repaired
- **THEN** the next start repairs both worktrees and leaves the link and `config.json` byte for byte as the first run left them

#### Scenario: Interrupted migration and repository cleanup
- **WHEN** a migration was interrupted before its worktree repairs and the dashboard has started again
- **THEN** the worktree records of `demo-ops` name the paths under `~/.spec-control/worktrees/` before any repository cleanup can run `git worktree prune`, so no record is pruned for a worktree that still exists
