# spec-frameworks Specification

## Purpose
Defines how the dashboard supports spec-driven frameworks as interchangeable modules: how a repository is assigned the
framework that reads it, what every module must provide so the shared Kanban can show its changes, the read-only
boundary every module stays within, and OpenSpec as the module registered today with its behaviour unchanged.

## Requirements

### Requirement: Every repository is read by exactly one framework module
The dashboard SHALL keep a fixed, ordered list of registered framework modules, each with a stable identifier (a
lowercase kebab-case string) and a display name. OpenSpec, identifier `openspec`, display name `OpenSpec`, SHALL be the
only registered module and the first in the order. Every repository the dashboard discovers or scans SHALL be read by
exactly one module: the first module in the list that claims the folder. Discovery SHALL use each module's project
marker to decide whether a folder is a project of that module (for OpenSpec: `openspec/config.yaml` or
`openspec/config.yml`, as today). A scan SHALL use each module's presence check on a tracked folder (for OpenSpec: an
`openspec/` directory, as today); when no module claims a tracked folder, the repository SHALL be reported with
`ok: false` and an error naming what is missing, and the scan of the other repositories SHALL continue. A folder that
some module's marker claims SHALL NOT be offered for integration.

#### Scenario: An OpenSpec repository is read by the OpenSpec module
- **WHEN** a scan root contains a folder with `openspec/config.yaml`
- **THEN** discovery reports it as a candidate with framework `openspec`, and once tracked every scan reads it with the OpenSpec module

#### Scenario: A tracked folder no module claims
- **WHEN** a tracked repository's `openspec/` directory has been deleted
- **THEN** the scan reports that repository with `ok: false` and the error `repository path or its openspec/ directory does not exist`, keeps its last changes, and scans every other repository normally

#### Scenario: The first claiming module wins
- **WHEN** two modules are registered and a folder carries the markers of both
- **THEN** the folder is read only by the module that comes first in the registration order, and its changes appear once

### Requirement: Snapshots and discovery results name the framework
Each repository in `GET /api/state`'s snapshot SHALL carry `framework`, the identifier of the module that read it, and
each candidate in the `POST /api/discover` result SHALL carry the identifier of the module whose marker it has. A cached
snapshot written by an older version without the field SHALL be read as `openspec`. The field is informational: no
column, count, filter or action SHALL depend on its value while OpenSpec is the only module, and no other field of the
snapshot or of the discovery result SHALL change because of it.

#### Scenario: Framework in the state
- **WHEN** the UI requests `GET /api/state` after a scan of an OpenSpec repository
- **THEN** that repository's entry has `framework: "openspec"` and every other field is what the same scan reported before this change

#### Scenario: Snapshot cached by an older version
- **WHEN** the dashboard starts with a cached snapshot whose repositories have no `framework` field
- **THEN** those repositories are served and shown as OpenSpec repositories until the next scan sets the field

### Requirement: The Kanban is framework-neutral
Every module SHALL report each of its changes in the one shape the board uses: a name valid under the change-name rule,
whether and when it was archived, its artifacts in build order each with `done`, `ready` or `blocked` and whether it is
required before implementing, its task progress as done, awaiting-validation and total counts (or none), its schema
name, its created date when known, its prompt and dependencies when present, and, when the module can tell, whether its
spec deltas are already reflected in the repository's specs. The stage, column and sub-state of a change SHALL be
derived from that shape alone, by the same rules for every module, so that the columns, their order, the card badges and
the counts are the same whichever module read the change. A module MUST NOT define columns of its own.

#### Scenario: Stage derived from the neutral shape
- **WHEN** a module reports a change whose required artifacts are all `done` and whose task progress is `0/5`
- **THEN** the change is in `Ready`, exactly as an OpenSpec change in that state is

#### Scenario: No spec-sync state from a module that cannot tell
- **WHEN** a module that has no notion of spec deltas reports a change whose tasks are all ticked
- **THEN** the change is in `Done` and carries no `specsSynced` value

### Requirement: A framework module only reads
A module SHALL only read: listing its changes, reading a change, resolving the files of a change's artifacts and
deciding its markers MUST read files inside the repository's checkouts and nothing else, and MUST NOT write, create,
rename or delete any file, start any process or run any git command beyond the read-only ones the scanner already runs.
Where a write in a tracked repository depends on a framework — creating a change, dismissing a change, resolving change
leftovers before a pull, copying an uncommitted change into a session worktree, deciding which files a docs-only ship
contains — the module SHALL only supply the paths and file contents, and the write SHALL stay in the module and under
the rules the `dashboard-api` "never writes" requirement enumerates for it. A module whose paths are not enumerated
there SHALL NOT be offered any of those writes; registering such a module requires amending that requirement first.

#### Scenario: Scanning through a module leaves the repository untouched
- **WHEN** every fixture repository is scanned, its changes' artifacts are listed and an artifact file is read
- **THEN** every fixture repository is byte-for-byte unchanged and no process other than the read-only git commands was started

#### Scenario: Create change writes only the enumerated paths
- **WHEN** the user creates a change in an OpenSpec repository
- **THEN** exactly `openspec/changes/<name>/` with `.openspec.yaml` and, when given, `prompt.md` and `depends-on.yaml` is written and staged, as before this change

### Requirement: OpenSpec behaves as before
For every repository the OpenSpec module reads, the dashboard SHALL report the same changes, artifact statuses, task
progress, columns, sub-states, warnings, dates, spec-sync state, dependencies, artifact file lists and artifact file
contents as before modules existed, and SHALL write, stage, delete and run git exactly as before; the only addition is
the `framework` field. Project-local schemas under `openspec/schemas/<name>/schema.yaml` SHALL still win over the
bundled `spec-driven` schema, and the bundled schema SHALL still work in the compiled binary.

#### Scenario: Fixture snapshots unchanged
- **WHEN** the existing scanner, discovery, artifact, create-change, dismissal and pull tests run against the unchanged fixtures
- **THEN** they pass without changing their expectations, apart from asserting `framework: "openspec"` where a whole repository snapshot or discovery result is compared, and static checks of source text that name a path the module now supplies

#### Scenario: Compiled binary reads a change
- **WHEN** `dist/spec-control` scans an OpenSpec repository whose changes use the bundled `spec-driven` schema
- **THEN** their artifact statuses are reported as under `bun run`, with no "could not read artifacts" warning

### Requirement: OpenSpec changes record their pull request's branch in `.openspec.yaml`
The OpenSpec module SHALL read a change's record from its `.openspec.yaml`: the one top-level key `spec-control`, holding
a map whose entries are on the following lines, indented by spaces, each `key: value` with the value optionally in
single or double quotes and an optional trailing `# comment`; the map ends at the first line that is not indented. Of
its entries the module SHALL read exactly these, and ignore every other:

- `branch` — the head branch of the change's implementation pull request;
- `archive-branch` — the head branch of the pull request that archives the change.

A branch SHALL be kept only when it is 1 to 200 characters from letters, digits, `.`, `_`, `/` and `-`, does not start
with `-`, `/` or `.`, does not end with `/` or `.lock`, and contains neither `..` nor `//`. A value that is not kept SHALL be dropped
and reported as a warning on the change; it SHALL NOT fail the change or the scan. The record SHALL be read the same way
for an active change and for an archived one under `openspec/changes/archive/<date>-<name>/`. Reading it MUST NOT write
the file, and the module MUST NOT supply a write of the record: only the agent writes it, in its own worktree.

The module SHALL also supply the **record instruction** for a change, asked for either the implementation branch or the
archive branch: a fixed, agent-neutral text that asks the agent to set that key in the change's `.openspec.yaml` under
`spec-control:` to the branch it is about to push, to include that edit in the same commit as its work before pushing,
to leave the other key and every other key of the file unchanged, and to leave a record that already names this branch
as it is. It MUST NOT ask for a pull request number or for any commit after the pull request is opened. It SHALL name the file in both places it may be — `openspec/changes/<name>/.openspec.yaml` and, once archived
in this branch, `openspec/changes/archive/<date>-<name>/.openspec.yaml` — and show the shape of the map. A module that
supplies no record instruction SHALL lead to none being sent.

#### Scenario: A full record
- **WHEN** `openspec/changes/rotate-keys/.openspec.yaml` holds `schema: spec-driven`, `created: 2026-10-24` and a `spec-control:` map with `branch: fix/rotate-keys`
- **THEN** the change's record has the implementation branch `fix/rotate-keys`, and its schema and creation date are read as before

#### Scenario: An archived change's record
- **WHEN** `openspec/changes/archive/2026-10-20-rotate-keys/.openspec.yaml` records `branch: feat/rotate-keys` and `archive-branch: chore/archive-rotate-keys`
- **THEN** the archived change's record has both

#### Scenario: Malformed values
- **WHEN** the map holds `branch: -x` and `archive-branch: chore//archive`
- **THEN** the change has no recorded branch, carries a warning, and is otherwise read as before

#### Scenario: Unknown keys
- **WHEN** the map also holds `pr: 142` and `reviewer: someone`, and the file holds a top-level `goal:` key
- **THEN** all three are ignored and the record is read

#### Scenario: OpenSpec still reads the file
- **WHEN** the bundled OpenSpec library reads the metadata of a change whose `.openspec.yaml` carries a `spec-control:` map
- **THEN** it accepts the file and reports the same schema as without the map

#### Scenario: The record instruction for an archive
- **WHEN** the module is asked for the archive record instruction of `rotate-keys`
- **THEN** the text names `archive-branch`, both possible paths of `rotate-keys`'s `.openspec.yaml`, asks for the edit to go into the commit with the work, and asks for no pull request number and nothing else to be changed in it
