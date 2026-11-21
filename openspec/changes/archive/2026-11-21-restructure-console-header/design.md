# Design

## Context

The Console panel currently stacks agent and permission pickers, session identity and status, Ship, and session controls above the terminal. The change-detail lifecycle timeline already owns phase delivery actions. See `proposal.md` and `specs/change-detail/spec.md` for the behavior contract.

## Goals / Non-Goals

**Goals:**

- Keep the terminal at least 80% of the Console panel height.
- Preserve visible session context while moving infrequently used configuration behind a settings gear disclosure.
- Give the change window more of the available viewport and prevent the settings disclosure from being clipped by the compact header.
- Put End session and Open in editor at the top right of the Console panel without a visible action heading.
- Keep Ship at the lifecycle timeline delivery checkpoint and retain persistent borders on the two destructive detail controls.

**Non-Goals:**

- Change session, agent, permission, Ship, dismiss or delete behavior or APIs.
- Change the overall detail-window header or move the lifecycle timeline.

## Decisions

- Restructure the existing Console panel header in place. Keep identity and status in a compact top-left cluster, and panel-level actions in a top-right cluster. This preserves the current panel and session data flow; a separate toolbar component would add structure without changing ownership.
- Use a collapsed-by-default disclosure with a gear button for the existing agent and permission pickers. Keep their current save behavior and values; this avoids adding new settings state or changing session launch behavior.
- Reduce the change window's outer gutters, remove its fixed maximum height, and allow it to grow wider on large viewports. When Settings is open, let the menu extend past the compact header while keeping its own height bounded and scrollable.
- Remove the panel's Ship control and its explanatory copy. The timeline's matching pull-request checkpoint already presents Ship and its operation state, so a second control would duplicate the same action.
- Use persistent border styling on Dismiss change and Delete change files in their existing detail-header positions. Preserve their labels, disabled states, confirmations and action behavior.

## Risks / Trade-offs

- [Risk] The 20% header limit can be tight at narrow widths or when status notices wrap → Keep identity/status and actions in flexible groups, allow wrapping within the header, and verify narrow and wide layouts.
- [Risk] Removing Ship from the Console panel could make it harder to find → Keep the existing lifecycle timeline checkpoint and confirm its Ship control remains available for the same eligible change.
- [Risk] A gear-only visual cue may be unclear → Give the button an accessible name and tooltip that say it opens console settings.
- [Risk] A larger window has little effect on narrow devices → Keep the overlay gutters small and the settings menu bounded to the viewport.

## Migration Plan

No data or configuration migration is needed. Existing saved agent and permission selections remain unchanged.
