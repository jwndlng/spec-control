# Spec Delta

## MODIFIED Requirements

### Requirement: The timeline shows a pull-request delivery checkpoint
The timeline SHALL show smaller pull-request checkpoints after Drafts, Implementing, and Archived for proposal, implementation, and archive delivery, respectively. When Ship is available, it SHALL appear in the matching checkpoint and retain the existing shippability and confirmation behavior. Each checkpoint SHALL link to a known pull request and distinguish its delivery status in both text and appearance: shipping or checks in progress SHALL pulse orange, a mergeable pull request with passing checks SHALL be green, and conflicts or failing checks SHALL be red. A merged pull request SHALL be green. When conflicts can be resolved under the existing eligibility rules, Resolve conflicts SHALL appear in the matching checkpoint and use the existing recovery behavior. Each lifecycle delivery checkpoint SHALL discover its pull request from its delivery record or that phase's exact recorded or managed head branch. Archive shipping controls and their in-progress status SHALL appear at the Archive PR checkpoint, not the Implementation PR checkpoint. When implementation has started and no Drafts pull request or delivery attempt exists, the Drafts checkpoint SHALL be labeled “Skipped”.

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

#### Scenario: Drafts delivery was skipped
- **WHEN** the lifecycle timeline has reached Implementing and no Drafts pull request or delivery attempt exists
- **THEN** the Drafts pull request checkpoint is labeled “Skipped”

#### Scenario: Drafts delivery attempt retains its status
- **WHEN** the lifecycle timeline has reached Implementing and a Drafts pull request or delivery attempt exists
- **THEN** the Drafts checkpoint shows that pull request or delivery attempt's actual status instead of “Skipped”

### Requirement: The timeline carries the next lifecycle action
The timeline SHALL present the available Draft artifacts, Implement, or Archive action at its corresponding phase, using the existing server eligibility and session handoff rules. It SHALL expose one primary next action, explain unavailable actions, and route blocked delivery to its recovery action. The detail view SHALL NOT duplicate these lifecycle controls in its console toolbar. Pull-request checkpoints SHALL appear after Drafts, Implementing, and Archived for proposal, implementation, and archive delivery, respectively, with each checkpoint showing its own delivery state, linked pull request, checks/readiness, conflicts, and merged state when available. A merged pull request SHALL be shown as complete and SHALL NOT make the local Done phase appear actively working.

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
