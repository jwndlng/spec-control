# Proposal

## Why

The change-level permission profile currently sits above the artifact and Console tabs, separating it from the agent choice it configures. This makes the setting harder to discover and leaves the Console controls split across the detail view.

## What Changes

- Move the change permission profile control into the Console tab, beside the agent picker.
- Keep its inheritance, persistence, feedback, and next-session behavior unchanged.
- Remove the control from artifact tabs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: Place the eligible change permission profile control in the Console alongside the agent picker rather than across all detail tabs.

## Impact

- `src/ui/changeDetail.tsx` and `src/ui/changePermissionPicker.tsx` for placement and Console integration.
- `src/ui/helpContent.tsx` and `test/changePermissionPicker.test.tsx` for user guidance and coverage.
- No API or persistence changes are expected.
