## MODIFIED Requirements

### Requirement: Detail presents a lifecycle timeline above the file tabs
Change detail SHALL show an ordered timeline from Backlog through Drafts, Ready, Implementing, Done, and Archived above the file tabs. Phase nodes SHALL be larger than schema-derived artifact milestones. The current phase, completed steps, available next action, and pending persistence SHALL be distinct in text and appearance. When a lifecycle action has advanced beyond the snapshot stage, the timeline SHALL show that phase as current and preceding phases as complete; it SHALL animate only while that phase is actively running. The timeline SHALL describe change phases and delivery state; it SHALL NOT include whether an agent session has ended. Unknown or optional schema artifacts SHALL NOT fabricate completion. Draft artifact progress SHALL be shown under Drafts, and task progress SHALL be shown under Implementing. Progress controls and phase actions SHALL be centered within their checkpoints.

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
- **THEN** Archived is locally complete and its persistence is labeled pending with a PR link

#### Scenario: Alternate schema and validation
- **WHEN** the framework has different artifact names or a validation milestone
- **THEN** milestones derive from that schema and validation state instead of a hardcoded proposal/design/specs sequence

### Requirement: The timeline shows a pull-request delivery checkpoint
The timeline SHALL show a smaller pull-request checkpoint after Done. When Ship is available, it SHALL appear in that checkpoint and retain the existing shippability and confirmation behavior. The checkpoint SHALL link to a known pull request and distinguish its delivery status in both text and appearance: shipping or checks in progress SHALL pulse orange, a mergeable pull request with passing checks SHALL be green, and conflicts or failing checks SHALL be red. A merged pull request SHALL be green. When conflicts can be resolved under the existing eligibility rules, Resolve conflicts SHALL appear in the checkpoint and use the existing recovery behavior. Each lifecycle delivery checkpoint SHALL discover its pull request from its delivery record or that phase's exact recorded or managed head branch. Archive shipping controls and their in-progress status SHALL appear at the Archive PR checkpoint, not the Implementation PR checkpoint.

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

#### Scenario: Archive shipping appears at its own checkpoint
- **WHEN** the user ships an archive PR
- **THEN** the shipping control and in-progress status appear under Archive PR, not Implementation PR

#### Scenario: Implementation and archive pull requests remain distinct
- **WHEN** the same change has pull requests on its implementation and archive branches
- **THEN** each pull request's checks and link appear at its matching phase checkpoint
