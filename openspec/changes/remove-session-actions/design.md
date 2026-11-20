# Design

## Context

The Console already groups controls by pull request, change, and session. The session group currently uses a `<details>` disclosure while the other populated groups render directly. The existing session controls have distinct eligibility and confirmation behavior that this change must preserve. See proposal.md for motivation and specs/change-detail/spec.md for the behavior contract.

## Goals / Non-Goals

**Goals:**
- Render the session action heading and eligible controls directly in the Console group.
- Retain existing action ordering, eligibility, labels, callbacks, disabled states, and confirmations.
- Remove styling that only supports the disclosure affordance.

**Non-Goals:**
- Changing the actions available for any session state.
- Changing lifecycle controls elsewhere in the Console or session actions in other views.

## Decisions

- Keep the existing `console-action-group` and `console-secondary-actions` structure and replace the `<details>/<summary>` wrapper with a normal labeled section. This makes session actions consistent with the adjacent action groups while minimizing changes to their behavior and layout.
- Keep the “Session actions” text as a visible category heading. Removing the menu should not remove the group’s accessible name or visual grouping.
- Update focused UI assertions to verify the controls render without a disclosure and preserve their existing conditional rendering. Remove the disclosure-only CSS rules.

## Risks / Trade-offs

- **More controls are visible at once and may wrap on narrow screens** → Reuse the existing wrapping action-row styles and retain responsive keyboard/focus checks.
