## MODIFIED Requirements

### Requirement: The lifecycle stepper guides local and remote progress
The change detail timeline SHALL place each phase action and its associated pull-request delivery state and actions within the phase it advances or creates, preserving all current eligibility and session handoff rules. Completed phases SHALL show green completion markers, the current actively running phase SHALL have a pulsing marker, and the available next phase SHALL be visually highlighted. A Done sub-state action such as Validate SHALL remain attached to Done. Backlog SHALL indicate the Fast-forward route to Implementing while retaining the existing Fast-forward action and confirmation. When a managed phase is awaiting completion confirmation and shipping, its matching phase SHALL show that confirmation as the sole primary ship action; the direct Ship button for that same phase SHALL be hidden until the confirmation is no longer active.

#### Scenario: Next local action
- **WHEN** a change is Ready and Implement is available
- **THEN** the Implement control appears beneath Implementing in the timeline and uses the existing session start behavior

#### Scenario: Validation within Done
- **WHEN** a Done change awaits task validation
- **THEN** Validate appears beneath Done and Archive remains governed by the existing available actions

#### Scenario: Reduced motion
- **WHEN** the user requests reduced motion
- **THEN** current and in-progress markers do not pulse

#### Scenario: Completion confirmation needed
- **WHEN** a running managed session has not reported completion for Draft, Implement, Fast-forward, or Archive
- **THEN** its phase checkpoint shows a compact Confirm complete action, and confirming retains the server's artifact, task, and stable-worktree verification

#### Scenario: One ship action while completion is confirmed
- **WHEN** a phase has an active completion confirmation and its pull request is also eligible for direct Ship
- **THEN** the phase shows Confirm & Ship without a second Ship button, while a different phase's Ship action remains available
