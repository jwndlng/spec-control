## MODIFIED Requirements

### Requirement: Create-change endpoint
`POST /api/repos/<id>/changes` SHALL create a new OpenSpec change in the repository identified by `<id>`. The request body SHALL be JSON `{ name, prompt?, dependsOn?, issue? }`, where `name` is a name the `change-creation` capability accepts for a new change ("Reserved and unusable change names are refused": `^[A-Za-z0-9._-]+$`, at most 128 characters, not starting with `.` or `-`, no `..`, not ending in `.` or `.lock`, and not `archive` in any letter case), `prompt` is an optional string and `dependsOn` is an optional list of at most 32 distinct valid change names, none of them equal to `name`, and `issue` is an optional `{ number, title? }` naming the GitHub issue the change is imported from, with `number` a positive integer and `title` a string of at most 256 characters; with `issue` the server writes `issue.yaml` as the `change-creation` capability specifies, deriving the GitHub repository from the repository's `origin` remote. The names in `dependsOn` need not exist: a name that does not is reported as a `missing` dependency once the change is scanned. On success the response is `201` with `{ name, staged }`, where `staged` says whether the new directory was staged in the repository's index, and the repository is rescanned. On failure the response is `400` (invalid body, invalid name, a `dependsOn` that is not such a list, or an invalid `issue`), `404` (unknown repository) or `409` (repository disabled, last scan failed, no `openspec/` parent, an active or archived change already uses that name, or an `issue` was given for a repository whose `origin` is not on `github.com`) with a JSON message. The endpoint MUST NOT write anything to the repository unless the request succeeds; a failed request MUST leave the repository byte-for-byte unchanged, its index and refs included. A failure to stage a successfully created change MUST NOT fail the request. The endpoint is mutating and MUST pass the same-origin protection.

#### Scenario: Successful create
- **WHEN** `POST /api/repos/<id>/changes` is called with `{ "name": "add-audit-trail" }` for an enabled, successfully scanned repository that has no `add-audit-trail` change
- **THEN** the response is `201` with `{ "name": "add-audit-trail", "staged": true }`, `openspec/changes/add-audit-trail/.openspec.yaml` exists in that repository and is staged in its index, and a following `GET /api/state` reflects the new change

#### Scenario: Staging failed
- **WHEN** the change is created but it could not be staged — the repository is not a git repository, or git failed
- **THEN** the response is still `201`, with `staged` false, and the change directory and its files are left in place

#### Scenario: Invalid name
- **WHEN** the request body is `{ "name": "foo/bar" }`
- **THEN** the response is `400` and nothing is written

#### Scenario: Duplicate name
- **WHEN** an active `add-audit-trail` change already exists
- **THEN** the response is `409` and nothing is written

#### Scenario: Cross-site
- **WHEN** a page on another origin posts to the endpoint
- **THEN** the response is `403` and nothing is written

#### Scenario: Create with dependencies
- **WHEN** `POST /api/repos/<id>/changes` is called with `{ "name": "add-billing-ui", "dependsOn": ["add-billing-api"] }`
- **THEN** the response is `201`, and `openspec/changes/add-billing-ui/` holds `.openspec.yaml` and a `depends-on.yaml` listing `add-billing-api`, both staged

#### Scenario: Invalid dependencies
- **WHEN** the request body's `dependsOn` contains `../etc`, contains a name twice, names the new change itself, or is not a list of strings
- **THEN** the response is `400` and nothing is written

#### Scenario: Create from an issue
- **WHEN** `POST /api/repos/<id>/changes` is called with `{ "name": "retry-webhooks", "prompt": "…", "issue": { "number": 42, "title": "Retry webhook delivery" } }` for a repository whose `origin` is `https://github.com/acme/alpha-infra.git`
- **THEN** the response is `201`, `openspec/changes/retry-webhooks/issue.yaml` records `acme/alpha-infra` and `42`, it is staged with the other files, and no `gh` process was started

#### Scenario: Invalid issue
- **WHEN** the request body's `issue` has a `number` that is not a positive integer, or a `title` longer than 256 characters
- **THEN** the response is `400` and nothing is written

#### Scenario: Reserved name
- **WHEN** the request body is `{ "name": "archive" }`
- **THEN** the response is `400` with a message saying the name is reserved, and nothing is written
