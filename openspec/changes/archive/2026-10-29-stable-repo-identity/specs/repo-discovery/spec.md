## MODIFIED Requirements

### Requirement: Dashboard configuration is persisted in the user's home directory

The dashboard SHALL store its configuration in `~/.spec-control/config.json` containing `scanRoots`, `ignorePaths`, `repos` (each with `id`, `path`, `name`, `enabled`), `pollIntervalSeconds` and `port`, and optionally `setup`, whose only value is `"pending"` and which, when present, means the setup wizard of the `setup-wizard` capability has not been finished or skipped yet. The dashboard MUST create the directory and a default config on first start and MUST write config atomically (temp file + rename). All stored paths (`scanRoots`, `ignorePaths`, `repos[].path`) MUST be canonical: `~` expanded, symlinks resolved and spelled with their on-disk casing; a path that does not exist is stored normalised as given. When loading a config written by an earlier version, the dashboard MUST default a missing `ignorePaths` to an empty list, canonicalise stored paths, and merge repositories that resolve to the same directory — keeping the enabled entry, otherwise the first, together with that entry's name and id — and MUST NOT reset the config because of such entries. Loading MUST keep every well-formed stored repository `id` as it is, also when the entry's path now canonicalises to a different spelling of the same directory, and SHALL assign an id only to an entry that has none. A configuration created because none existed, or because the stored one was invalid and was reset to defaults, SHALL carry `setup: "pending"`; a configuration loaded from disk without `setup` SHALL load without it and MUST NOT gain it, and any other value of `setup` SHALL be dropped.

#### Scenario: First start creates default config
- **WHEN** the dashboard starts and `~/.spec-control/config.json` does not exist
- **THEN** it creates the directory and a config with empty `scanRoots`, empty `ignorePaths`, empty `repos`, `pollIntervalSeconds: 60`, `port: 4711` and `setup: "pending"`

#### Scenario: Config survives restart
- **WHEN** a user enables a repo and restarts the dashboard
- **THEN** the repo is still listed as enabled after restart

#### Scenario: Config without ignorePaths loads
- **WHEN** the stored config has no `ignorePaths` key
- **THEN** it loads with `ignorePaths: []` and all other values unchanged

#### Scenario: Legacy duplicate entries are merged
- **WHEN** the stored config contains the same directory twice under different spellings, one disabled and one enabled and renamed to "Beta SOC"
- **THEN** after loading, the config contains that directory once, with its canonical path, `enabled: true` and name "Beta SOC"

#### Scenario: An earlier configuration is not set up again
- **WHEN** the stored config was written by an earlier version and has no `setup` key
- **THEN** it loads without `setup` and is not rewritten to add it

#### Scenario: A reset configuration asks for setup
- **WHEN** the stored config is invalid and is moved aside and reset to defaults
- **THEN** the new config carries `setup: "pending"`

#### Scenario: A folder renamed by case keeps its id across a restart
- **WHEN** `/w/acme/Acme` is tracked with id `f055f4484961`, the folder is renamed to `/w/acme/acme` on a case-insensitive file system and the dashboard is restarted
- **THEN** the loaded config holds the repository with path `/w/acme/acme` and id `f055f4484961`, and its session records and activity history still belong to it

### Requirement: Repository display names are editable

Each repository SHALL have a display `name` defaulting to its directory basename, editable in Settings. When a candidate is enabled and its default name is already used by another repository in the configuration being edited, its name SHALL default to `<basename> (<parent directory name>)` instead. The repository `id` SHALL be derived from the repository's canonical absolute path when the repository is added to the configuration — by Enable, a confirmed integration, a tracked clone or the setup wizard — and SHALL then be kept: neither renaming it, nor a later change in how its path is spelled on disk (a case-only rename, the folder replaced by a symbolic link to it), nor validating or loading the configuration SHALL change it. When the id derived from a new repository's path is already held by another configured repository, the next id SHALL be derived deterministically from the same path, and discovery SHALL report a candidate with the id it would be added with. One directory MUST never have two ids: the configuration MUST NOT hold two repositories whose paths resolve to the same directory, and every check whether a path is already configured MUST compare canonical paths.

#### Scenario: Default name from directory
- **WHEN** `/w/acme/beta-soc` is discovered
- **THEN** its default name is `beta-soc`

#### Scenario: Rename keeps identity
- **WHEN** the user renames a repo in Settings
- **THEN** its `id` is unchanged and the board shows the new name

#### Scenario: Colliding default name is disambiguated
- **WHEN** `acme/pkg-tools` is tracked as `pkg-tools` and the user enables the candidate `ops/repo-mirror/repos/pkg-tools`
- **THEN** the new entry's name defaults to `pkg-tools (repos)`

#### Scenario: Same directory has one id
- **WHEN** the same directory is addressed as `/w/acme/app` and, on a case-insensitive file system, as `/W/acme/app`
- **THEN** both yield the same `id`

#### Scenario: Enabling a folder tracked under its old spelling
- **WHEN** `/w/acme/Acme` is tracked, the folder has been renamed to `/w/acme/acme`, and `/w/acme/acme` is enabled from the projects overview
- **THEN** the existing entry is enabled with its id unchanged and no second entry is added

#### Scenario: A taken id is not reused
- **WHEN** a repository keeps the id derived from `/w/acme/Tools` after its folder was renamed, and on a case-sensitive file system a new folder `/w/acme/Tools` is discovered
- **THEN** the candidate is reported with a different id, and enabling it stores that id
