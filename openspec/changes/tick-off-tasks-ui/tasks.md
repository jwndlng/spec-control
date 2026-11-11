# Tasks

## 1. Server task confirmation

- [ ] 1.1 Add a task-confirmation operation that resolves the active change's framework task path, validates the displayed file version and target `[~]` marker, and rejects stale requests; verify with focused server tests for valid, stale, duplicate-text, and missing-task cases
- [ ] 1.2 Enforce repository-local non-symlink path checks and atomic compare-and-write of only the marker; verify unrelated bytes and file mode remain unchanged in focused tests
- [ ] 1.3 Add a same-origin API route that returns clear conflict errors and triggers a scan only after a successful write; verify route guards, response codes, and scan behavior

## 2. Change detail control

- [ ] 2.1 Add an explicit **Mark confirmed** action only to `[~]` tasks while keeping checkboxes display-only; verify open and done tasks cannot be changed and awaiting tasks expose the action
- [ ] 2.2 Wire pending, success, and stale-conflict states to the API and refresh behavior; verify duplicate activation is prevented and stale content prompts refresh

## 3. Integration and documentation

- [ ] 3.1 Update dashboard write-scope documentation and relevant API/detail tests to cover the explicit task-write exception; verify `openspec validate tick-off-tasks-ui` passes
- [ ] 3.2 Add an independent What's new JSON entry under `src/ui/changelog/entries/`; verify its schema and that the entry is included by the existing changelog loader

