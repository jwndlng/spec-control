# Design

## Context

See `proposal.md` for the problem and `specs/change-detail/spec.md` for the behavior contract.
`changeDetail.tsx` renders a picker above its artifact tabs, while its embedded `ConsolePanel` in
`sessionPanel.tsx` renders another. Both call `api.setChangePermissionProfile` and update shared config
through `ui.saveConfig`. Their pending and error state is separate; the Console also shares its error
state with the unrelated agent picker. The existing API accepts a profile or `null`, and sessions
already carry an optional launch-time `permissionProfile`.

## Goals / Non-Goals

**Goals:** Give the detail view sole ownership of the control and its request feedback; derive the
saved choice, inherited value and running-session notice from existing configuration and session data.

**Non-Goals:** Change permission policy, adapters, API routes, persisted config shape, project/global
settings or session lifecycle. The Console's Agent picker remains independent. No repository writes,
terminal-output interpretation or new network activity are introduced.

## Decisions

### Keep the picker above the detail tabs

Retain one control in the common detail area, using the label "Permission profile for this change".
Remove the embedded Console's permission selector and its save handler/state. Keep the common control
mounted while switching tabs so pending/error/success feedback survives a tab switch. Guard it with
an active snapshot change, repository config and enabled agent sessions, including the legacy detail
route for a missing change with a surviving worktree.

A shared component may encapsulate the picker within `src/ui/`, with derivation helpers in
`sessionState.ts` if useful for testing. Two synchronized selectors were considered, but would retain
the misleading duplicate scope and duplicate interaction state. Moving the only selector into Console
would hide it from artifact readers and changes with no session.

The proposal notes layout ownership by `add-change-lifecycle-timeline`; that change is not present
in this checkout. Keep this work confined to the permission control and coordinate the common placement
if that layout work lands first. Its resulting layout must still show exactly one picker.

### Represent inheritance separately from an explicit value

Bind the selection to the stored override or an empty inheritance sentinel. Display "Inherit from
project (<profile label>)", resolving repository, global and built-in Minimum in order. Use existing
profile ids for requests and readable labels for display. An explicit Minimum remains explicit even
if the inherited profile is Minimum. Use the existing scoped API with `null` to clear the override;
preserve any other override fields. Add adjacent text explaining change scope and next-start timing.

Inferring inheritance from equality of profile values was rejected because it would silently discard
an intentional override when the project default later changes.

### Use acknowledged configuration and feedback scoped to the change

Keep the saved selection derived from shared config. During a request disable the control and announce
"Saving…"; update config with the successful response and announce "Saved" through a status region.
On failure retain the acknowledged value and expose the server's error through an alert, then allow
retry. Clear stale feedback before a new request. Scope local state and response handling to the
repository/change identity so a late completion cannot display feedback for another change.

Optimistic selection with rollback was considered; using acknowledged config makes failure handling
and the relationship between saved and running profiles easier to reason about.

### Compare the effective choice with the running session record

Use the change's currently running session from the existing session list, independent of an ended
session selected for terminal history. Compare its recorded `permissionProfile` to the effective
saved profile. When they differ, show both names and explain that the saved choice applies on the
next session start. Recompute from shared config/session updates, including inherited default changes.
Do not guess the active profile for legacy sessions lacking that field. Never send terminal input,
restart a session or change an active process as a result of this control.

Comparing against the currently selected historical terminal was rejected because its launch profile
does not describe the process still running for the change.

## Risks / Trade-offs

- A response arrives after navigation → Scope pending state and feedback to repository/change identity;
  verify navigation during an outstanding save.
- The selected Console history differs from the running session → Derive the notice from the running
  session, and cover this explicitly in UI tests.
- Existing tests assert that both selectors exist → Replace those expectations with rendered behavior
  tests for a single selector, scoped writes, feedback and inheritance; retain project-picker coverage.
- Demo behavior drifts → Exercise its existing `setChangePermissionProfile` implementation and add
  synthetic cases for an override and a running profile mismatch where needed.
- Profile names suggest immediate effect → Keep next-start wording beside the control, plus the explicit
  differing-profile notice while a session runs.

## Migration Plan

No data migration is needed: existing overrides and session records keep their meaning. Implement the
single control, verify UI and demo behavior, and update Help and an independent What's new entry.
Rollback restores the previous UI without changing saved configuration or session records.
