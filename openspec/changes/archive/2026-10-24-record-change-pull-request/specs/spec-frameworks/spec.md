## ADDED Requirements

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
