## MODIFIED Requirements

### Requirement: Activity is detected by comparing consecutive snapshots
After every scan the dashboard SHALL compare the new snapshot with the previous one and record what changed as events: a change created, a change moved from one column to another, task progress within a column, a change archived, a change removed, a repository tracked or no longer tracked, and a repository's scan starting to fail or recovering. Active changes SHALL be matched by repository and change name, and archived changes by repository, change name and archive date, so that an active change and an archive of the same name — a new change reusing the name of an archived one — are never compared with each other. An archive that the previous snapshot did not hold under that name and date SHALL be an archived event from the column of the previous snapshot's active change of that name when there was one and the new snapshot holds none; otherwise it SHALL be treated as an archive of a change not seen before ("First sight of a repository is a baseline, not activity"). An active change that is gone because its archive arrived SHALL NOT also yield a removed event. A change that moved and progressed in the same scan SHALL yield one moved event carrying the new progress. While a repository's scan is failing its changes MUST NOT be compared. Detection MUST be a function of the two snapshots only and MUST NOT read or write any repository.

#### Scenario: A change becomes ready
- **WHEN** the previous snapshot shows change `cache-api-calls` of `demo-ops` in `Drafts` and the new one shows it in `Ready`
- **THEN** one event is recorded: `cache-api-calls` in `demo-ops` moved from `Drafts` to `Ready`

#### Scenario: Task progress
- **WHEN** a change stays in `Implementing` and its tasks go from `3/12` to `7/12`
- **THEN** one task progress event from `3/12` to `7/12` is recorded

#### Scenario: Moved and progressed at once
- **WHEN** a change goes from `Ready` with `0/7` to `Implementing` with `2/7` between two scans
- **THEN** exactly one event is recorded, moved from `Ready` to `Implementing`, carrying `2/7`

#### Scenario: Created, archived, removed
- **WHEN** between two scans change `add-login` appears, change `bump-toolchain` becomes archived and change `old-idea` disappears
- **THEN** a created, an archived and a removed event are recorded for them respectively

#### Scenario: A failing scan is not mistaken for activity
- **WHEN** a repository's scan fails and the dashboard keeps showing its previous changes
- **THEN** one scan-failing event with the error is recorded and no change events for that repository; when it succeeds again a recovered event is recorded and comparison resumes

#### Scenario: An active change beside an old archive of its name
- **WHEN** repository `demo-ops` holds the archive `2026-09-01-rotate-keys` and an active change `rotate-keys` in `Drafts`, and two consecutive scans find both unchanged
- **THEN** no event is recorded for `rotate-keys`

#### Scenario: A reused name is archived again
- **WHEN** the previous snapshot shows active `rotate-keys` in `Done` and the archive `2026-09-01-rotate-keys`, and the new one shows the archives `2026-09-01-rotate-keys` and `2026-10-28-rotate-keys` and no active `rotate-keys`
- **THEN** exactly one archived event is recorded for `rotate-keys`, from `Done`, and no removed event

#### Scenario: A reused name is created
- **WHEN** the previous snapshot shows only the archive `2026-09-01-rotate-keys`, and the new one also shows an active `rotate-keys` in `Backlog`
- **THEN** one created event is recorded for `rotate-keys`, in `Backlog`

#### Scenario: Old entries keep their column names
- **WHEN** the log holds an event recorded before the columns were simplified, `bump-toolchain` moved from `Specs` to `Ready`
- **THEN** the feed shows it with the names it was recorded with

#### Scenario: Renamed columns are not recorded as moves
- **WHEN** the dashboard starts with a snapshot kept from a version that placed `cache-api-calls` in `Specs`, and the first scan finds the change unchanged
- **THEN** no moved event is recorded for it

## ADDED Requirements

### Requirement: A worktree left unread is not activity
A change whose leading copy in the previous snapshot was in a linked worktree that the new scan did not read ("Reading worktrees is bounded and isolated" of the `change-scanner` capability: left out by the limit, failed or timed out), or whose leading copy in the new snapshot is in a linked worktree that the previous scan did not read, SHALL NOT be compared in that comparison: it SHALL yield no created, moved, task progress, archived or removed event. Not reading a checkout says nothing about what happened in it, and the activity log is history that is never corrected afterwards. Such a change SHALL be compared again from the first comparison in which both snapshots read the worktree it leads from; what happened to it while that worktree was unread is not recorded. Snapshots cached by older versions, which carry no list of unread worktrees, SHALL be read as having left none unread.

#### Scenario: A worktree times out for one scan
- **WHEN** change `audit-trail` of `demo-ops` exists only in a worktree on `feat/audit-trail`, one scan's reading of that worktree times out and the next scan reads it again
- **THEN** no removed event and no created event are recorded for `audit-trail`

#### Scenario: A worktree falls behind the limit
- **WHEN** change `audit-trail` leads from a worktree in `Implementing`, its main checkout copy is in `Ready`, and a scan leaves that worktree out because 12 more recently changed worktrees were read
- **THEN** no moved event is recorded for `audit-trail` in that scan, nor when the worktree is read again with `audit-trail` still in `Implementing`

#### Scenario: A worktree that is gone is not unread
- **WHEN** the worktree that held `audit-trail` alone was removed with `git worktree remove` before a scan
- **THEN** a removed event is recorded for `audit-trail`
