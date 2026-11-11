# Proposal

## Why

Tasks marked `[~]` require a person to verify or perform something, but the dashboard currently only explains them; the user must leave the UI and edit `tasks.md` to record completion. A clear, explicit control in change detail lets the person record that confirmation where the task is presented.

## What Changes

- Add a task completion control for tasks awaiting human review in change detail.
- Add a narrowly scoped API operation that changes only the selected task marker after an explicit user action, then refreshes the snapshot.
- Keep task text and task ordering intact, and reject stale or ambiguous task requests rather than guessing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: show human-review tasks as individually actionable controls and reflect successful completion.
- `dashboard-api`: enumerate this explicit task confirmation as a tracked-repository write, with bounded paths and stale-content protections.

## Impact

- UI: `src/ui/changeDetail.tsx` and task presentation/state.
- Server/API: route and task-write logic under `src/server/`, using the existing framework boundary for task paths.
- Shared task/API types and tests.
- The dashboard's tracked-repository write contract, specifically the explicit task confirmation operation for an existing change's `tasks.md`.

