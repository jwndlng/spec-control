## MODIFIED Requirements

### Requirement: The lifecycle stepper guides local and remote progress
The change detail timeline SHALL place the existing phase action under the phase it advances, preserving all current eligibility and session handoff rules. Completed phases SHALL show green completion markers, the current actively running phase SHALL have a pulsing marker, and the available next phase SHALL be visually highlighted. A Done sub-state action such as Validate SHALL remain attached to Done. Backlog SHALL indicate the Fast-forward route to Implementing while retaining the existing Fast-forward action and confirmation. For an already archived change, any available lifecycle action SHALL remain within the Archived checkpoint rather than appearing in a separate centered row.

#### Scenario: Archived change action stays in its phase
- **WHEN** the detail view shows an archived change with an available lifecycle action
- **THEN** the action appears beneath Archived within the timeline

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
