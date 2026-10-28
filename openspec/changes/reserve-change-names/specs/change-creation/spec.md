## ADDED Requirements

### Requirement: Reserved and unusable change names are refused
A name SHALL be accepted for a new change only when it matches `^[A-Za-z0-9._-]+$`, is at most 128 characters long, does
not start with `.` or `-`, does not contain `..`, does not end in `.` or `.lock`, and is not `archive` in any letter case.
This rule SHALL be defined once, shared by the server and the UI, and used by the New change form in every mode, by the
Import from issues dialog and by `POST /api/repos/<id>/changes`, which SHALL refuse any other name with `400` and a
message naming the rule it breaks, without touching the disk — no directory, file, git command or `openspec`
invocation. The rule SHALL apply only to creating a change: a change directory that already exists under another name
matching `^[A-Za-z0-9._-]+$` SHALL still be scanned, shown and acted on as before.

#### Scenario: The archive root is not a change name
- **WHEN** `POST /api/repos/<id>/changes` is called with `{ "name": "archive" }` for `demo-ops`, which has no archived
  change and so no `openspec/changes/archive/` yet
- **THEN** the response is `400` with a message saying `archive` is reserved, `openspec/changes/archive/` does not exist
  afterwards, and the repository's index is unchanged

#### Scenario: Letter case does not matter
- **WHEN** the name is `Archive`
- **THEN** the response is `400` and nothing is written

#### Scenario: Names git cannot branch
- **WHEN** the name is `.git`, `-wip`, `a..b`, `notes.` or `notes.lock`
- **THEN** the response is `400` with the rule the name breaks, and nothing is written

#### Scenario: Existing directories keep working
- **WHEN** a repository already has `openspec/changes/.draft/` with a proposal
- **THEN** the board still shows `.draft` and it can still be dismissed

## MODIFIED Requirements

### Requirement: The form validates the change name live
The form SHALL validate the change name against the new-change-name rule of "Reserved and unusable change names are refused" — the same rule the server enforces — refuse an empty or whitespace-only value, and MUST NOT allow submission while the value is invalid. The refusal reason SHALL be presented as text, next to the field.

#### Scenario: Invalid character
- **WHEN** the user types `foo/bar` into the change name field
- **THEN** the submit action is disabled and a message names the allowed characters

#### Scenario: Empty name
- **WHEN** the user clears the change name field
- **THEN** the submit action is disabled and a message says the name is required

#### Scenario: Valid name
- **WHEN** the user types `add-audit-trail`
- **THEN** no error is shown and the submit action is enabled

#### Scenario: Reserved name
- **WHEN** the user types `archive` or `Archive` into the change name field
- **THEN** the submit action is disabled and a message says the name is reserved for archived changes

#### Scenario: Leading dot or dash
- **WHEN** the user types `.git` or `-wip`
- **THEN** the submit action is disabled and a message says a name must not start with `.` or `-`
