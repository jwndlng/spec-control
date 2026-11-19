## ADDED Requirements

### Requirement: The lifecycle stepper guides local and remote progress
The change detail timeline SHALL place the existing phase action under the phase it advances, preserving all current eligibility and session handoff rules. Completed phases SHALL show green completion markers, the current phase SHALL have a pulsing marker, and the available next phase SHALL be visually highlighted. A Done sub-state action such as Validate SHALL remain attached to Done. Backlog SHALL indicate the Fast-forward route to Implementing while retaining the existing Fast-forward action and confirmation.

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

### Requirement: The timeline shows a pull-request delivery checkpoint
The timeline SHALL show a smaller pull-request checkpoint after Done. When Ship is available, it SHALL appear in that checkpoint and retain the existing shippability and confirmation behavior. The checkpoint SHALL link to a known pull request and distinguish its delivery status in both text and appearance: shipping or checks in progress SHALL pulse orange, a mergeable pull request with passing checks SHALL be green, and conflicts or failing checks SHALL be red. A merged pull request SHALL be green. When conflicts can be resolved under the existing eligibility rules, Resolve conflicts SHALL appear in the checkpoint and use the existing recovery behavior.

#### Scenario: Ship a completed change
- **WHEN** a Done change has shippable work and no linked pull request
- **THEN** Ship appears beneath the pull-request checkpoint and starts the existing deterministic Ship flow

#### Scenario: Checks are running
- **WHEN** the linked pull request's checks are pending or mergeability is still unknown
- **THEN** the checkpoint says it is checking and shows an orange pulsing marker

#### Scenario: Pull request is ready
- **WHEN** the linked open pull request is mergeable and its checks pass or none are required
- **THEN** the checkpoint says checks passed and shows a green marker

#### Scenario: Pull request conflicts
- **WHEN** GitHub reports that the linked pull request conflicts with its base
- **THEN** the checkpoint shows a red conflict marker and, when eligible, offers Resolve conflicts
