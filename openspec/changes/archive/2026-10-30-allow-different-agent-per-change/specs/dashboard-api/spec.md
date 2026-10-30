# Spec Delta

## ADDED Requirements

### Requirement: A change's agent override is set through the API
`POST /api/repos/<id>/changes/<name>/agent` with `{ agentId }` SHALL set or clear the agent override of one change
(`agent-sessions`: "A change may use an agent other than its project's"), persist the configuration atomically and
return the saved config, under the same validation and canonicalisation as `PUT /api/config` and applied one at a time
with every other configuration write against the configuration as the previous write left it. A string `agentId` SHALL
set the override to that profile; `agentId: null` SHALL remove it, and a repository whose last override was removed
SHALL carry no override key, so a configuration never gains an empty map. Setting an override SHALL also remove the
repository's overrides for names that are not active changes in its latest scan.

An unknown repository id MUST be refused with `404`. A `<name>` that fails change-name validation MUST be refused with
`400`, and a valid name that is not an active change of the repository in its latest scan with `404`. A body without
`agentId`, an `agentId` that is neither `null` nor a string, and an `agentId` naming no configured profile MUST be
refused with `400`. While agent sessions are disabled, or the repository is excluded from them, the request MUST be
refused with `403`. A refused request MUST leave the configuration unchanged. The endpoint is a mutating request under
the same-origin protection; it triggers no scan, starts and ends no process, and reads or writes nothing inside a
repository.

#### Scenario: Setting and clearing a change's agent
- **WHEN** `POST /api/repos/<id>/changes/rotate-keys/agent` is sent with `{ "agentId": "codex" }` and later with `{ "agentId": null }`
- **THEN** after the first the saved config carries the override `codex` for `rotate-keys` with the repository's other agent settings unchanged, and after the second it carries no override for the repository; no scan was triggered either time

#### Scenario: Unknown profile
- **WHEN** the endpoint is sent `{ "agentId": "nope" }` and no profile has that id
- **THEN** the response is `400` and the config is unchanged

#### Scenario: Not an active change
- **WHEN** the endpoint is sent for `<name>` `old-change`, which is archived, or for `../etc`
- **THEN** the response is `404` for `old-change` and `400` for `../etc`, and the config is unchanged

#### Scenario: Stale overrides are pruned
- **WHEN** the repository carries an override for `gone-change`, which is no longer an active change, and an override is set for `rotate-keys`
- **THEN** the saved config carries the override for `rotate-keys` and none for `gone-change`

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/repos/<id>/changes/rotate-keys/agent`
- **THEN** the response is `403` and the config is unchanged
