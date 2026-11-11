# Spec Delta

## ADDED Requirements

### Requirement: Explicit task confirmation write
The dashboard MAY write task markers only after an explicit user action. It MUST use a framework-provided task path and compare the complete displayed file version, refusing stale content without writing. Writes MUST preserve unrelated content and atomically replace markers. Automatic shipping MUST NOT change task files.

#### Scenario: Confirm one awaiting task
- **WHEN** the user explicitly confirms a uniquely identified `- [~]` task and its current content still matches the displayed task
- **THEN** only that task marker changes to `[x]`, the file is written atomically, and a scan is triggered

#### Scenario: Stale task content
- **WHEN** the task file has changed since the user viewed it or the task cannot be uniquely identified
- **THEN** the request is refused, the task file is unchanged, and the user is told to refresh

#### Scenario: No implicit task writes
- **WHEN** a scan, refresh, page load, polling request, or click on an ordinary checklist checkbox occurs
- **THEN** no task file is written

### Requirement: Bulk task confirmation from Ship preflight
The **Mark all complete and Ship** action MUST be available only for a verified, untruncated summary. It SHALL mark remaining `[ ]` and `[~]` tasks in the session checkout and proceed only after the write succeeds.

#### Scenario: Confirm every remaining task from Ship preflight
- **WHEN** the user chooses **Mark all complete and Ship** with the current preflight token for a verified, untruncated task file
- **THEN** the server changes only remaining open and awaiting task markers in the session checkout, then continues Ship

#### Scenario: Stale Ship preflight
- **WHEN** the session task file changes after preflight and the user chooses **Mark all complete and Ship**
- **THEN** the file is unchanged and the refreshed preflight is shown again

