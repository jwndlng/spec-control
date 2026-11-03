# Spec Delta

## MODIFIED Requirements

### Requirement: A framework module only reads
A module SHALL only read: listing its changes, reading a change, resolving the files of a change's artifacts and
deciding its markers MUST read files inside the repository's checkouts and nothing else, and MUST NOT write, create,
rename or delete any file, start any process or run any git command beyond the read-only ones the scanner already runs.
Where a write in a tracked repository or a managed session worktree depends on a framework — creating a change,
dismissing a change, resolving change leftovers before a pull, copying an uncommitted change into a session worktree,
deciding which files a docs-only ship contains, recording a change's implementation or archive branch in its metadata,
and moving an active change directory to its dated archive path in an archive worktree — the module SHALL only supply
the paths and pure file-content transformations, and the write SHALL stay in the server under the rules the
`dashboard-api` "never writes" requirement enumerates for it. A module whose paths are not enumerated there SHALL NOT be
offered any of those writes; registering such a module requires amending that requirement first.

#### Scenario: Scanning through a module leaves the repository untouched
- **WHEN** every fixture repository is scanned, its changes' artifacts are listed and an artifact file is read
- **THEN** every fixture repository is byte-for-byte unchanged and no process other than the read-only git commands was started

#### Scenario: Create change writes only the enumerated paths
- **WHEN** the user creates a change in an OpenSpec repository
- **THEN** exactly `openspec/changes/<name>/` with `.openspec.yaml` and, when given, `prompt.md` and `depends-on.yaml` is written and staged, as before this change

#### Scenario: Branch recording supplies transformed text without writing
- **WHEN** the OpenSpec module's branch-recording helper is called with the text of `.openspec.yaml`, the key `branch` and the value `feat/rotate-keys`
- **THEN** it returns the updated `.openspec.yaml` text as a pure string result without touching the file system

### Requirement: OpenSpec changes record their pull request's branch in `.openspec.yaml`
The OpenSpec module SHALL read a change's record from its `.openspec.yaml`: the one top-level key `spec-control`, holding
a map whose entries are on the following lines, indented by spaces, each `key: value` with the value optionally in
single or double quotes and an optional trailing `# comment`; the map ends at the first line that is not indented. Of
its entries the module SHALL read exactly these, and ignore every other:

- `branch` — the head branch of the change's implementation or proposal pull request;
- `archive-branch` — the head branch of the pull request that archives the change.

A branch SHALL be kept only when it is 1 to 200 characters from letters, digits, `.`, `_`, `/` and `-`, does not start
with `-`, `/` or `.`, does not end with `/` or `.lock`, and contains neither `..` nor `//`. A value that is not kept SHALL be dropped
and reported as a warning on the change; it SHALL NOT fail the change or the scan. The record SHALL be read the same way
for an active change and for an archived one under `openspec/changes/archive/<date>-<name>/`. Reading it MUST NOT write
the file.

The module SHALL also supply a pure transformation that sets `branch` or `archive-branch` under `spec-control:` in a
change's `.openspec.yaml` text to a validated branch name while preserving every other top-level key, comment, and the
other `spec-control` key in the file, leaving the text byte-for-byte unchanged when that key already holds that branch
name, and SHALL supply the relative paths where a change's `.openspec.yaml` lives in a session worktree
(`openspec/changes/<name>/.openspec.yaml` or, once archived on the branch,
`openspec/changes/archive/<date>-<name>/.openspec.yaml`). Spec Control writes that updated file directly in the managed
session worktree before committing and pushing, instead of appending a prose branch-recording instruction to agent
prompts.

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
- **WHEN** `openspec/changes/rotate-keys/.openspec.yaml` holds `schema: spec-driven\ncreated: 2026-10-24\n` and the module's branch-recording helper sets `branch` to `feat/rotate-keys` and then sets `archive-branch` to `chore/archive-rotate-keys`
- **THEN** the resulting text holds `schema: spec-driven`, `created: 2026-10-24`, and a `spec-control:` map with both `branch: feat/rotate-keys` and `archive-branch: chore/archive-rotate-keys`, and calling it again with the same branch leaves the text unchanged
