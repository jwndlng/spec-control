# whats-new Specification

## MODIFIED Requirements

### Requirement: The changelog is embedded in the UI
The dashboard SHALL carry a curated list of user-visible features as part of its UI build, each entry with a unique id,
a calendar date, a short title and a summary that MAY use Markdown. Each entry SHALL be authored in an independent
source file named by its id, so adding an entry does not require editing a shared entry list or another entry's file.
The build SHALL assemble and validate all entry files into the stable changelog list consumed by the UI. The list
SHALL be available identically under `bun run dev`, in the compiled binary and on the demo site. Reading it MUST NOT
make any request, neither to the dashboard's own server nor to any other host, and MUST NOT read or write any tracked
repository.

#### Scenario: Offline binary
- **WHEN** the compiled binary runs on a machine without network access and the user opens What's new
- **THEN** every entry is shown and the page has made no request for it

#### Scenario: Demo site
- **WHEN** a visitor opens What's new on the demo site
- **THEN** the same entries as in the binary built from the same commit are shown

#### Scenario: Independent entry additions
- **WHEN** two feature branches add entries with different ids
- **THEN** each branch adds its own entry file without editing a shared changelog array, and the merged build includes both

#### Scenario: Deterministic ordering for entries on the same date
- **WHEN** multiple entry files have the same date
- **THEN** the assembled list uses a stable tie-break order regardless of filesystem enumeration order

#### Scenario: Invalid entry source
- **WHEN** an entry file has a filename that disagrees with its id, duplicate id, invalid date, empty title or empty summary
- **THEN** validation fails and identifies the offending entry

### Requirement: The changelog stays well-formed and current
The test suite SHALL fail when two entries share an id, an id is not of the form `<YYYY-MM-DD>-<kebab-case-slug>` with
the entry's own date, a date is not a valid calendar date, the list is not ordered newest first, or a title or summary
is empty. `CONTRIBUTING.md` SHALL tell contributors to add an entry file for every `feat` pull request whose change
users can see, and this repository's OpenSpec configuration SHALL tell agents planning such a change to include a
task to add that file.

#### Scenario: Duplicate id
- **WHEN** a contributor adds an entry whose id is already in the list
- **THEN** `bun run check` fails naming that id

#### Scenario: Out of order
- **WHEN** the assembled list orders an entry dated 2026-09-01 above one dated 2026-10-01
- **THEN** `bun run check` fails

#### Scenario: Planning a feature
- **WHEN** an agent creates `tasks.md` for a change in this repository that adds a user-visible feature
- **THEN** the OpenSpec instructions it receives ask for a task to add an independent What's new entry file
