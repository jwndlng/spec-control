## MODIFIED Requirements

### Requirement: The lifecycle stepper guides local and remote progress
The change detail timeline SHALL place each phase action and its associated pull-request delivery state and actions within the phase it advances or creates, preserving all current eligibility and session handoff rules. Completed phases SHALL show green completion markers, the current actively running phase SHALL have a pulsing marker, and the available next phase SHALL be visually highlighted. A Done sub-state action such as Validate SHALL remain attached to Done. The existing Fast-forward action and confirmation SHALL remain available through the action menu; the timeline SHALL NOT display a separate informational banner about the Fast-forward route.

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

#### Scenario: Fast-forward stays in the action menu
- **WHEN** a change is in Backlog
- **THEN** the action menu retains Fast-forward and its confirmation, and the timeline displays no separate Backlog-to-Implementing banner
