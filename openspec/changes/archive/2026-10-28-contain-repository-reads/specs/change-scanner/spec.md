## ADDED Requirements

### Requirement: Repository files are read bounded and inside their checkout
Every file the scanner reads from a tracked repository — `openspec/config.yaml` (also for its carried shared-config
profiles), each change's `.openspec.yaml`, its tasks file, `prompt.md`, `depends-on.yaml` and `issue.yaml`, its delta
`spec.md` files, the main `openspec/specs/<capability>/spec.md` files and a project-local `schema.yaml` — SHALL be read
through one bounded read. That read SHALL resolve every symbolic link on the path and refuse the file when its real
path is not inside the real path of the change directory (for a change's own files) or of the checkout being read (for
`config.yaml`, main specs and schemas); it SHALL open the file without blocking and without following a final link,
refuse anything the opened file is not a regular file — a named pipe, socket or device — before reading a byte, and
refuse a file larger than 1 MiB, except that `prompt.md` is truncated at its limit and `depends-on.yaml` and
`issue.yaml` keep their own limits. It MUST NOT read more bytes than the limit plus one. A refused or failed read SHALL
be reported as a warning on the change (for `config.yaml`, on the repository) naming the file, and SHALL NOT fail the
repository's scan, delay it beyond the time a read of a regular file of that size takes, or affect other changes. The
scanner MUST NOT read a repository file in any other way.

#### Scenario: Marker linked to an endless device
- **WHEN** `openspec/changes/lint-rules/.openspec.yaml` in `demo-ops` is a symbolic link to `/dev/zero`
- **THEN** the scan of `demo-ops` completes within its timeout with `ok: true`, `lint-rules` carries a warning about
  `.openspec.yaml`, its other facts are read with the project's schema, and the dashboard's memory use does not grow by
  more than that file's limit

#### Scenario: Tasks file is a named pipe
- **WHEN** a change's `tasks.md` is a named pipe that no process writes to
- **THEN** every poll of the repository completes, the change reports `tasks: null` with a warning that `tasks.md` is not
  a regular file, and no file descriptor stays open between polls

#### Scenario: Delta spec linked outside the repository
- **WHEN** `openspec/changes/rotate-keys/specs/auth/spec.md` is a symbolic link to `/w/acme/elsewhere/spec.md`
- **THEN** that file is not read, the change's spec sync is reported as not synced with a warning, and nothing of the
  target's content reaches the snapshot

#### Scenario: Oversized config
- **WHEN** `openspec/config.yaml` is a regular file of 3 MiB
- **THEN** it is not read, the repository carries a warning naming the file and the 1 MiB limit, and its changes are
  read with the default schema

#### Scenario: Link inside the change keeps working
- **WHEN** a change's `tasks.md` is a symbolic link to `notes/tasks.md` in the same change directory
- **THEN** its tasks are counted as before

### Requirement: The dashboard's own change files are read only in place
`prompt.md`, `depends-on.yaml` and `issue.yaml` SHALL be read only when the entry in the change directory is itself a
regular file — not a symbolic link, wherever it points. An entry of one of those names that is anything else SHALL be
ignored with a warning on the change, exactly as an unreadable file: `prompt.md` is reported absent, `depends-on.yaml`
holds the change back as unreadable, and `issue.yaml` gives no source issue.

#### Scenario: Prompt linked out of the repository
- **WHEN** `openspec/changes/lint-rules/prompt.md` is a symbolic link to `/w/acme/elsewhere/hosts`
- **THEN** the change has no prompt text, carries a warning about `prompt.md`, and neither the state endpoint nor
  `snapshot.json` contains any of the target's text

#### Scenario: Dependencies linked elsewhere
- **WHEN** a change's `depends-on.yaml` is a symbolic link to a file in another change
- **THEN** the change carries the warning that `depends-on.yaml` could not be read and is blocked, as for an unreadable
  file

### Requirement: Schema names and tracked task files stay inside the project
A schema name taken from a change's `.openspec.yaml` or from `openspec/config.yaml` SHALL be used only when it is a
single plain path segment: characters from `A-Z`, `a-z`, `0-9`, `.`, `_` and `-`, not starting with `.`, and not `.` or
`..`. Any other name SHALL be reported as a warning and treated as an unknown schema. A project-local schema SHALL be
read only from `openspec/schemas/<name>/schema.yaml` of the checkout, with the bounded read. The tasks file a schema
names with `apply.tracks` SHALL be read only when it resolves inside the change directory; otherwise the change SHALL
report `tasks: null` and a warning, and no file outside the change directory SHALL be opened for it.

#### Scenario: Schema name climbs out
- **WHEN** a change's `.openspec.yaml` says `schema: ..` or `schema: ../../shared`
- **THEN** the change carries a warning about its schema name, its artifacts are reported as for an unknown schema, and
  no `schema.yaml` outside `openspec/schemas/` is opened

#### Scenario: Tracked tasks outside the change
- **WHEN** a project-local schema declares `apply.tracks: ../../../outside.md`
- **THEN** the change reports `tasks: null` with a warning and the file is not read
