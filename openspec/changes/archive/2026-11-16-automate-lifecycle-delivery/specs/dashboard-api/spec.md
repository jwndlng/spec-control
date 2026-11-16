## ADDED Requirements

### Requirement: Lifecycle delivery status and retry are exposed
The session/state API SHALL expose each managed phase's delivery identity, state, PR link, timestamps, blocker, and available recovery actions. POST `/api/repos/<id>/changes/<name>/delivery/retry` with a server-issued checkpoint identity SHALL re-evaluate that operation. It SHALL apply same-origin and project/session enablement checks and SHALL NOT accept client paths, head commits, commands, or merge eligibility as authority.

#### Scenario: Duplicate retry
- **WHEN** two requests retry the same pending checkpoint
- **THEN** both observe one serialized delivery operation and no duplicate PR or merge

#### Scenario: Stale checkpoint
- **WHEN** retry names an obsolete checkpoint identity
- **THEN** the server returns 409 with the current state instead of publishing unrelated work
