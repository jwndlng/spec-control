# Proposal

## Why

The Console tab's header consumes close to half of the available panel height, leaving too little room for the terminal. Agent and permission settings are useful when changing them, but do not need to stay expanded during console work; Ship is already represented in the change lifecycle timeline.

## What Changes

- Reduce the Console panel header to at most 20% of the panel height so the terminal can use at least 80%.
- Keep session identity and status visible, place End session and Open in editor at the panel header's top right, and move agent and permission configuration behind a disclosure.
- Expand the change window to use more of the viewport and keep the opened settings menu visible beyond the compact Console header.
- Remove Ship from the Console panel and rely on the lifecycle timeline's delivery checkpoint for shipping.
- Keep a visible border on the Dismiss change and Delete change files controls at rest so both actions remain easy to identify.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: Define the compact Console panel header, its progressive disclosure and top-right session controls, place Ship in the lifecycle timeline rather than the Console panel, and keep persistent borders on Dismiss change and Delete change files controls.

## Impact

The Console tab and change-detail UI in `src/ui/sessionPanel.tsx` and `src/ui/changeDetail.tsx`, their styles in `src/ui/styles.css`, change-detail UI tests, the `change-detail` OpenSpec capability, and a What's new entry. No API or data model changes are expected.
