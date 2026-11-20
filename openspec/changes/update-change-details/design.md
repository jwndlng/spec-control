# Design

## Context

The detail view currently renders `ChangePermissionPicker` above the artifact and Console tabs. The Console panel already has change-specific controls, including the agent picker. See `proposal.md` for the motivation and `specs/change-detail/spec.md` for the behavior contract.

## Goals / Non-Goals

**Goals:**
- Keep permission selection with the Console controls and place it beside the agent picker.
- Preserve the existing selection API, inheritance rules, save feedback, and session profile notice.

**Non-Goals:**
- Change permission resolution, server persistence, or the permissions available.
- Show the control on artifact tabs or archived changes.

## Decisions

- Render the existing picker within the Console tab's control area, adjacent to the change agent picker. This reuses the current API and picker behavior without adding a second control or changing persisted state. Keeping it in the Console groups settings that affect future sessions with the agent choice. The alternative of retaining a detail-wide control would leave the two session choices separated and contradict the requested placement.
- Keep the picker mounted only when the Console tab is active and the change is eligible. Its saved value remains in shared configuration, so changing tabs does not lose the selection; transient save feedback may reset when leaving the tab.
- Update the built-in Help text to describe the Console placement and revise UI coverage to assert the control is absent on artifact tabs and present beside the agent picker in Console.

## Risks / Trade-offs

- Users can only see the change permission setting while Console is available and selected. The Console tab is offered for active changes when agent sessions are enabled, which matches the eligibility in the existing requirement.
