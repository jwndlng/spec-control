## MODIFIED Requirements

### Requirement: Shared config endpoints

`GET /api/shared-config` SHALL return the stored profiles as `{ profiles: [...] }`, with an empty list when none has been saved. `PUT /api/shared-config` SHALL validate and persist them and return what was saved; invalid bodies MUST return `400` with a message and leave the stored profiles unchanged. `POST /api/shared-config/preview` with `{ "assignments": [{ "repoId", "profileIds": [...] }] }` SHALL return, per repository id, the profiles it carries now, the current file text, the text that apply would write, a `digest` of those two texts computed by the server (`shared-config`: "Apply writes exactly what was previewed"), and a refusal reason when apply would refuse it, without writing anything. `POST /api/shared-config/apply` with `{ "assignments": [{ "repoId", "profileIds": [...], "digest" }] }` SHALL apply to each repository independently, where `profileIds` is the complete set of profiles that repository is to carry and `digest` the one its preview returned, write a repository only when the digest of what it reads and would write now equals the one sent, return per repository `written`, `unchanged` or `refused` with a reason — a missing or different digest being refused as changed since the preview — and trigger a scan.

#### Scenario: Nothing saved yet
- **WHEN** `GET /api/shared-config` is called on a fresh install
- **THEN** the response is `{ profiles: [] }`

#### Scenario: Malformed assignments
- **WHEN** preview or apply is called without an `assignments` list of `{ repoId, profileIds }`
- **THEN** the response is `400` and nothing is written

#### Scenario: Partial success
- **WHEN** apply is requested for one healthy repository and one whose config is invalid YAML
- **THEN** the response is `200` with `written` for the first and `refused` with a reason for the second

#### Scenario: Apply with a stale digest
- **WHEN** apply is requested for `demo-ops` with the digest its preview returned, and `demo-ops`'s `openspec/config.yaml` changed in between
- **THEN** the response is `200` with `refused` for `demo-ops` and a reason saying it changed since the preview, and the file is not written

#### Scenario: Apply without a digest
- **WHEN** apply is requested with an assignment that carries no `digest`
- **THEN** that repository is `refused` and nothing is written to it
