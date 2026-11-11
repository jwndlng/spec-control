# Spec Delta

## ADDED Requirements

### Requirement: Explicit task confirmation write
The dashboard MAY update a tracked repository's task file only after the user explicitly confirms one task marked `- [~]` in change detail. The operation MUST be limited to that change's framework-provided task path, preserve all other file content, and refuse stale or ambiguous task content without writing.

#### Scenario: Confirm one awaiting task
- **WHEN** the user explicitly confirms a uniquely identified `- [~]` task and its current content still matches the displayed task
- **THEN** only that task marker changes to `[x]`, the file is written atomically, and a scan is triggered

#### Scenario: Stale task content
- **WHEN** the task file has changed since the user viewed it or the task cannot be uniquely identified
- **THEN** the request is refused, the task file is unchanged, and the user is told to refresh

#### Scenario: No implicit task writes
- **WHEN** a scan, refresh, page load, polling request, or click on an ordinary checklist checkbox occurs
- **THEN** no task file is written

