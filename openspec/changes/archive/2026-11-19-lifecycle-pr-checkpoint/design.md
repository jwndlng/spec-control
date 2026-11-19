# Design: lifecycle PR checkpoint

The timeline remains derived from the scanned local change and cached pull-request/delivery data. It adds a small delivery node immediately after Done, separate from the larger local lifecycle phases. Its state is presentation only: merged and ready are green, check/mergeability computation and shipping are pulsing orange, conflicts and failing checks are red, and future or waiting states remain neutral.

Place the existing deterministic Ship control and the existing Resolve conflicts control in this checkpoint. Ship is shown only when no linked PR exists, the local change is Done or Archived, and the selected session worktree is shippable. Resolve conflicts retains the current `conflictAction` eligibility checks and server route. PR links use the already cached linked PR or the persisted delivery record; the detail view does not initiate new GitHub queries.

The pull-request list and its branch-policy evidence share one refresh timestamp so readiness freshness is stable at millisecond boundaries.

Phase actions continue to use `SessionControls`, preserving its action selection, warning dialogs, and handoff behavior. Draft, Implement, Validate, and Archive are positioned under the phase they advance. Validation is attached to Done because it is a Done sub-state.

When a running managed phase needs user confirmation because the agent did not report completion, place the existing confirm action in that phase's checkpoint. Keep its copy compact and retain the existing server verification; show a short status while the server checks the resulting snapshot.

Honor `prefers-reduced-motion` for both the active local phase and the orange in-progress delivery marker. Text labels accompany all colors for accessibility.
