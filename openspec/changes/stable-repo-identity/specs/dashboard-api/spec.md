## MODIFIED Requirements

### Requirement: Config endpoints

`GET /api/config` SHALL return the config. `PUT /api/config` SHALL validate the body (absolute paths for `scanRoots`, `ignorePaths` and `repos[].path`, `pollIntervalSeconds >= 10`, unique repo ids, no two repos resolving to the same directory), canonicalise all paths, check the repository ids against the configuration it replaces — an id the stored configuration holds MUST still name the same directory, that is the canonical forms of its stored and its new path are equal, and an id it does not hold MUST be the id the dashboard assigns to that path (`repo-discovery`: "Repository display names are editable") — persist it atomically, and return the saved config; invalid bodies MUST return `400` with a message and leave the config unchanged. A body without `ignorePaths` SHALL be accepted and saved with `ignorePaths: []`. If the set of enabled repos changed, a scan MUST be triggered. `PUT /api/config` SHALL keep the stored `setup` value whatever the body carries for it, so that a client holding an older copy of the configuration can neither end nor restart setup; only `POST /api/setup/done` clears it, and nothing sets it again. The same id check SHALL apply to every other write of the configuration (the single-repository endpoints, Enable, Ignore, a confirmed integration), inside the serialised write, so that no write fails because a tracked folder's spelling on disk changed while the dashboard runs, and none can re-point an id at another directory.

#### Scenario: Invalid interval
- **WHEN** `PUT /api/config` is called with `pollIntervalSeconds: 1`
- **THEN** the response is `400` and the stored config is unchanged

#### Scenario: Relative ignore path is rejected
- **WHEN** `PUT /api/config` is called with `ignorePaths: ["relative/dir"]`
- **THEN** the response is `400` naming `ignorePaths.0` and the stored config is unchanged

#### Scenario: Paths are stored canonically
- **WHEN** `PUT /api/config` is called with a scan root given as `~/Workspace/alpha/` or through a symlink
- **THEN** the returned and stored config contain the canonical absolute path without a trailing separator

#### Scenario: Duplicate directory is rejected
- **WHEN** `PUT /api/config` is called with two repos whose paths resolve to the same directory
- **THEN** the response is `400` reporting that the same directory is listed twice

#### Scenario: Saving Settings does not change setup
- **WHEN** the stored config has `setup: "pending"` and `PUT /api/config` is called with a body without `setup`
- **THEN** the saved config still has `setup: "pending"`

#### Scenario: An old copy cannot restart setup
- **WHEN** setup was marked done and a client sends `PUT /api/config` with `setup: "pending"`
- **THEN** the saved config has no `setup` key

#### Scenario: Saving after a case-only rename
- **WHEN** `/w/acme/Acme` is tracked with id `f055f4484961`, the folder is renamed to `/w/acme/acme` on a case-insensitive file system while the dashboard runs, and `PUT /api/config` is called with the repository still at `/w/acme/Acme`
- **THEN** the response is `200` and the saved config holds the repository with path `/w/acme/acme` and id `f055f4484961`

#### Scenario: Writes after the folder became a link
- **WHEN** a tracked folder `/w/acme/alpha-infra` is moved to `/w/acme/repos/alpha-infra` and a symbolic link to it is left at `/w/acme/alpha-infra` while the dashboard runs
- **THEN** `POST /api/repos/<id>/enabled`, `POST /api/repos/<id>/labels` and `POST /api/ignore-paths` succeed, and the repository's path becomes `/w/acme/repos/alpha-infra` with its id unchanged

#### Scenario: An id cannot be re-pointed
- **WHEN** `demo-ops` and `alpha-infra` are tracked and `PUT /api/config` is called with `demo-ops`'s id and `alpha-infra`'s path
- **THEN** the response is `400` naming that repository's `id`, and the stored config is unchanged
