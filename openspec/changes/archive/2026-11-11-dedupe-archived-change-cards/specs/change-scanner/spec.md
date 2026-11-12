## ADDED Requirements

### Requirement: Archived changes are merged with active copies
When multiple archive directories have the same change name, the scanner SHALL report only the newest archive directory for that name. An older archive SHALL NOT produce another board card. Any leftover active copy SHALL be folded into the newest archive, as before.

#### Scenario: Two archives with the same name
- **WHEN** a repository contains archives `2026-11-09-agent-permission-sets` and `2026-11-10-agent-permission-sets`
- **THEN** the scanner reports one archived card dated `2026-11-10`

#### Scenario: Leftover belongs to newest archive
- **WHEN** a main checkout has an active copy older than both archives
- **THEN** it is folded into the newest archive, and the older archive does not appear as a separate card
