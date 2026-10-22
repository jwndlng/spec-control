## MODIFIED Requirements

### Requirement: Carried profiles are visible per repository
Once a profile exists, the projects overview SHALL show in each repository's row which profiles it carries, and the repository board SHALL show them for that repository in the Shared config section of its project details overlay (project-overview: "Repository board header"). The repository board header's quick view SHALL show only an attention marker, in text, when one of those profiles is not `in-sync` or the repository's `openspec/config.yaml` is unreadable. `outdated`, `orphaned` and `unreadable` SHALL be conveyed with text, not colour alone, and SHALL be visually distinguished from `in-sync`. The Settings page SHALL show all enabled repositories against all profiles.

#### Scenario: Overview
- **WHEN** `demo-ops` carries `base` outdated and `security` in sync, while `alpha-infra` carries only `base` in sync
- **THEN** the row for `demo-ops` names both profiles and marks `base` as outdated, and the row for `alpha-infra` names `base` without a warning

#### Scenario: Repository board
- **WHEN** the board of `demo-ops` is shown, which carries `base` outdated and `security` in sync
- **THEN** its quick view shows an attention marker for shared config, and its details overlay names both profiles and marks `base` as outdated

#### Scenario: All in sync
- **WHEN** the board of `alpha-infra` is shown, which carries only `base` in sync
- **THEN** its header shows no shared-config marker, and its details overlay names `base` without a warning
