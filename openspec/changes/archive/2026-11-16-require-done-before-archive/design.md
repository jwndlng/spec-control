# Design

## Context

`availableActions` is shared by the UI and the server-side action refusal path. It currently checks artifact readiness for Archive without checking lifecycle stage. The existing agent-sessions contract is being tightened to require `Done`.

## Goals / Non-Goals

**Goals:**
- Make Archive visibility and server eligibility require the Done stage.
- Preserve the rule that dependency blocking suppresses Implement only.

**Non-Goals:**
- Change deterministic archive execution or automatic archive eligibility.
- Change artifact readiness requirements for archiving.

## Decisions

- Add the `Done` stage condition to the existing Archive eligibility check in `availableActions`. This keeps the UI and server in agreement without adding a second gate.
- Keep the existing required-artifact readiness check and the existing `archived` early return.
- Keep the demo Ship gate on `isPlanned` so requiring Done for Archive does not make Ship unavailable for a Ready session.

## Risks / Trade-offs

- Users who previously archived a Ready change must finish implementation tasks first. This is the intended lifecycle and the new spec makes the constraint explicit.
