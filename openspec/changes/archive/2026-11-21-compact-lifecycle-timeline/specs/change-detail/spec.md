# Spec Delta

## MODIFIED Requirements

### Requirement: Detail presents a lifecycle timeline above the file tabs
Change detail SHALL show an ordered timeline from Backlog through Drafts, Ready, Implementing, Done, and Archived above the file tabs. Phase nodes SHALL be larger than schema-derived artifact milestones. The current phase, completed steps, available next action, and pending persistence SHALL be distinct in text and appearance. When a lifecycle action has advanced beyond the snapshot stage, the timeline SHALL show that phase as current and preceding phases as complete; it SHALL animate only while that phase is actively running. The timeline SHALL describe change phases and delivery state; it SHALL NOT include whether an agent session has ended. Unknown or optional schema artifacts SHALL NOT fabricate completion. Draft artifact progress SHALL be shown under Drafts, and task progress SHALL be shown under Implementing. Progress controls and phase actions SHALL be centered within their checkpoints. Draft artifact milestones SHALL use compact one-line labels with full names available to assistive technology and in their tooltip.

#### Scenario: Drafting progress
- **WHEN** proposal and specs exist but required tasks are missing
- **THEN** Drafts is current, completed artifact milestones are shown, the missing milestone is labeled, and the artifact progress bar is under Drafts

#### Scenario: Implementation progress
- **WHEN** a change has tasks and is in `Implementing`
- **THEN** its task progress bar is under Implementing, not in the detail header

#### Scenario: Implementation advances the timeline
- **WHEN** the snapshot stage is Ready and an implementation session has started
- **THEN** Implementing is current and Ready is shown complete

#### Scenario: Only active work animates
- **WHEN** an implementation session has ended while the change still requires implementation
- **THEN** Implementing remains current without animation and Ready remains complete

#### Scenario: Ended session does not appear in phase progress
- **WHEN** implementation is still required and the latest implementation session has ended
- **THEN** the timeline shows the change's phase and implementation progress without an ended-session status

#### Scenario: Archive pending delivery
- **WHEN** an archive exists locally but its PR is still open
- **THEN** Archived is locally complete and its delivery status appears within Archived with a PR link

#### Scenario: Alternate schema and validation
- **WHEN** the framework has different artifact names or a validation milestone
- **THEN** milestones derive from that schema and validation state instead of a hardcoded proposal/design/specs sequence

#### Scenario: Compact draft artifact labels
- **WHEN** Drafts shows Proposal, Specs, Design, and Tasks in the progress bar
- **THEN** the visible labels are `Pro`, `Spe`, `Des`, and `Tas`, and each full name is available to assistive technology and in its tooltip

#### Scenario: Draft artifact labels stay on one line
- **WHEN** Drafts shows Proposal, Specs, Design, and Tasks in the progress bar
- **THEN** every milestone label is displayed on one line and its full name remains available to assistive technology and in its tooltip

### Requirement: The timeline carries the next lifecycle action
The timeline SHALL present the available Draft artifacts, Implement, or Archive action at its corresponding phase, using the existing server eligibility and session handoff rules. It SHALL expose one primary next action, explain unavailable actions, and route blocked delivery to its recovery action. The detail view SHALL NOT duplicate these lifecycle controls in its console toolbar. Pull-request delivery state and actions SHALL appear within the Drafts, Implementing, and Archived phase checkpoints for proposal, implementation, and archive delivery, respectively, with each phase showing its own delivery state, linked pull request, checks/readiness, conflicts, and merged state when available. A merged pull request SHALL be shown as complete and SHALL NOT make the local Done phase appear actively working.

#### Scenario: Ready to implement
- **WHEN** the change is Ready and implementation is available
- **THEN** Implement is the timeline's primary action and launching it uses the existing agent selection and confirmed session handoff

#### Scenario: Optional design remains to draft
- **WHEN** the change is Ready but still has an unfinished optional design artifact
- **THEN** Draft artifacts is placed in the Drafts checkpoint while Implement remains available under Implementing

#### Scenario: Agent sessions disabled
- **WHEN** agent sessions are disabled
- **THEN** the timeline remains readable without presenting an enabled launch action

#### Scenario: Do not repeat Archive after lifecycle progress advances
- **WHEN** the snapshot still says Done but lifecycle progress has already reached Archived
- **THEN** the Archived checkpoint is current and the timeline does not offer Archive there again

### Requirement: The lifecycle stepper guides local and remote progress
The change detail timeline SHALL place each phase action and its associated pull-request delivery state and actions within the phase it advances or creates, preserving all current eligibility and session handoff rules. Completed phases SHALL show green completion markers, the current actively running phase SHALL have a pulsing marker, and the available next phase SHALL be visually highlighted. A Done sub-state action such as Validate SHALL remain attached to Done. Backlog SHALL indicate the Fast-forward route to Implementing while retaining the existing Fast-forward action and confirmation.

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
The timeline SHALL show proposal delivery within Drafts, implementation delivery within Implementing, and archive delivery within Archived, without separate pull-request checkpoint nodes. When Ship is available, it SHALL appear within the matching phase and retain the existing shippability and confirmation behavior. Each phase SHALL link to a known pull request and distinguish its delivery status in both text and appearance: shipping or checks in progress SHALL pulse orange, a mergeable pull request with passing checks SHALL be green, and conflicts or failing checks SHALL be red. A merged pull request SHALL be green. When conflicts can be resolved under the existing eligibility rules, Resolve conflicts SHALL appear within the matching phase and use the existing recovery behavior. Each lifecycle delivery SHALL discover its pull request from its delivery record or that phase's exact recorded or managed head branch. The Implementation phase SHALL NOT match the proposal branch, even when `.openspec.yaml` records that branch in its generic branch field. Archive shipping controls and their in-progress status SHALL appear within Archived, not Implementing. When implementation has started and no Drafts pull request or delivery attempt exists, the Drafts phase SHALL be labeled “Skipped”.

#### Scenario: Ship a completed change
- **WHEN** a Done change has shippable work and no linked pull request
- **THEN** Ship appears within the implementation delivery status under Implementing and starts the existing deterministic Ship flow

#### Scenario: Checks are running
- **WHEN** the linked pull request's checks are pending or mergeability is still unknown
- **THEN** the matching phase says it is checking and shows an orange pulsing marker

#### Scenario: Pull request is ready
- **WHEN** the linked open pull request is mergeable and its checks pass or none are required
- **THEN** the matching phase says checks passed and shows a green delivery marker

#### Scenario: Pull request conflicts
- **WHEN** GitHub reports that the linked pull request conflicts with its base
- **THEN** the matching phase shows a red conflict marker and, when eligible, offers Resolve conflicts

#### Scenario: Archive shipping appears at its own checkpoint
- **WHEN** the user ships an archive PR
- **THEN** the shipping control and in-progress status appear within Archived, not Implementing

#### Scenario: Implementation and archive pull requests remain distinct
- **WHEN** the same change has pull requests on its implementation and archive branches
- **THEN** each pull request's checks and link appear within its matching phase

#### Scenario: Drafts delivery was skipped
- **WHEN** the lifecycle timeline has reached Implementing and no Drafts pull request or delivery attempt exists
- **THEN** Drafts shows “Skipped” within its phase checkpoint

#### Scenario: Drafts delivery attempt retains its status
- **WHEN** the lifecycle timeline has reached Implementing and a Drafts pull request or delivery attempt exists
- **THEN** Drafts shows that pull request or delivery attempt's actual status instead of “Skipped”

#### Scenario: Proposal PR stays in Drafts
- **WHEN** `.openspec.yaml` records `docs/rotate-keys` as the change's branch and a pull request has that head branch
- **THEN** Drafts links to that PR and Implementing does not show it as its own PR
