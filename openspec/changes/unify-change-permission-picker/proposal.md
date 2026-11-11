# Proposal

## Why

Change detail and its embedded Console both render a selector bound to the same per-change permission override. Their different labels imply different scopes even though neither changes the project setting.

## What Changes

- Present one Permission profile control for a change across artifact and Console tabs.
- Default to Inherit from project with the resolved profile shown; selecting a concrete profile writes only a change override and choosing inheritance clears it.
- Show save feedback and explain when the selected profile differs from the currently running session.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: One inherited-or-overridden change permission control.

## Impact

- `src/ui/changeDetail.tsx`
- `src/ui/sessionPanel.tsx`
- `src/ui/sessionState.ts or a shared permission picker component`
- `test/sessionPanelUi.test.ts and change detail UI tests`
- `src/ui/demo/`
- `src/ui/helpContent.tsx`
- `src/ui/changelog/entries/`

## Dependencies and ownership

No implementation prerequisite. Preserve add-change-lifecycle-timeline's layout ownership; it must retain one picker when reorganizing detail. No permission-policy or project-setting changes.
