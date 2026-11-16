# Pull request summary

## Problem

Tasks marked `[~]` need a person to verify or do something, but change detail only displays them. The user must leave the dashboard and edit `tasks.md` to record confirmation.

## Intended outcome

Add an explicit **Mark confirmed** action for each human-review task in change detail. Keep the tri-state checklist itself read-only. A successful action changes only the selected `[~]` marker to `[x]`; stale, missing, or ambiguous task content is refused and the UI asks the user to refresh. The write is limited to the framework-provided task path and follows the dashboard's same-origin and tracked-repository write safeguards.

## Planned verification

- Focused server tests for valid confirmation, stale content, duplicate task text, and missing tasks.
- Verify path/symlink guards, atomic marker-only updates, preservation of unrelated bytes, and API same-origin protection.
- UI coverage for awaiting-task controls, read-only open/done checkboxes, pending state, and conflict refresh behavior.
- Run `openspec validate tick-off-tasks-ui` and the project's `bun run check`.

