# Design

## Context

See proposal.md for motivation. The selected task artifact is currently rendered as a read-only checklist in `src/ui/changeDetail.tsx`; task paths are resolved by the framework adapter. Mutating API requests already pass the same-origin guard in `src/server/api.ts`. Repository writes must be limited to explicit user actions and enumerated paths.

## Goals / Non-Goals

**Goals:**

- Let a person record that a `[~]` task has been checked or performed.
- Let a person explicitly mark every remaining task complete from Ship preflight when they have verified the work.
- Preserve the exact task text, ordering, indentation, and all unrelated file bytes.
- Fail closed if the displayed task list no longer matches the file.

**Non-Goals:**

- Editing task text or toggling individual open/done tasks.
- Adding support for task writes to arbitrary frameworks or paths.
- Automatically confirming tasks during scanning, refresh, validation, or archive.

## Decisions

- Keep checkboxes as display-only tri-state controls. Add a separate per-task **Mark confirmed** button for `[~]` rows, so the write is distinguishable from reading or checking a box.
- Identify the request with the change name, displayed task-file content (or an equivalent content fingerprint), and task position. The server re-reads the framework-provided task path and accepts only when the expected file version and target marker still match. Duplicate task text is therefore safe to address by position within the verified version; stale versions are rejected.
- Use a same-origin mutating API route. Resolve repository and change from the current tracked snapshot, obtain the task path from the framework, and verify each path segment is an ordinary file/directory rather than a symlink before writing.
- Write a replacement preserving all non-target bytes through an exclusive temporary file in the task file's directory and atomic rename. Do not invoke git or the OpenSpec CLI. After success, trigger a scan and let existing refresh behavior update the detail view.
- Return a conflict response for missing, changed, unreadable, or ambiguous tasks; the UI explains that the task changed and offers refresh. Disable the action while a request is pending to prevent duplicate submissions.
- Ship preflight offers **Mark all complete and Ship** only for a verified, untruncated task summary. The request carries the preflight token; the server re-reads the session checkout, compares the complete version, atomically marks remaining open and awaiting checkboxes complete, then continues Ship. If the version changed, the dialog refreshes its preview and writes nothing.

## Risks / Trade-offs

- [Concurrent edits between verification and rename] → Re-read immediately before replacement and serialize writes per task path; keep the compare-and-write section within that lock.
- [Unexpected repository write scope] → Derive the path exclusively from framework metadata and the selected snapshot entry; reject archived changes and paths outside that repository's active change directory.
- [Formatting damage] → Replace only the marker span in the original text and test preservation of surrounding bytes.

## Migration Plan

No data migration is needed. The route and control are additive; rollback removes the route and UI while existing task files remain valid.


