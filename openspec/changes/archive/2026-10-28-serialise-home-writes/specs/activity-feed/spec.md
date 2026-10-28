## ADDED Requirements

### Requirement: Each recorded event is written to the log once

Every event the dashboard records SHALL appear in `activity.jsonl` exactly once, also when events are recorded in quick succession and a compaction falls between them. A compaction SHALL write only the entries recorded up to the write that triggered it; events recorded after it SHALL be appended once, after the compacted file is in place. The feed SHALL show every recorded event as soon as it is recorded, before its write has finished.

#### Scenario: Compaction between two recordings
- **WHEN** the log holds 5 000 lines and two events are recorded one right after the other, so that writing the first one triggers a compaction
- **THEN** the file holds the 2 000 newest entries up to the first new event, followed by the second one — 2 001 lines, each id once, both new events among them

#### Scenario: After a restart
- **WHEN** the dashboard is restarted after such a compaction
- **THEN** the feed shows each of the two events once
