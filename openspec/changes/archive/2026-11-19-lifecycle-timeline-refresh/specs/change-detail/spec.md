## MODIFIED Requirements

### Requirement: Detail presents a lifecycle timeline above the file tabs
Change detail SHALL show a modern, evenly spaced, centered timeline from Backlog through Drafts, Ready, Implementing, Done, and Archived above the file tabs. Every phase marker SHALL be centered on its connector line, and schema-derived draft artifact milestones SHALL be arranged horizontally beneath Drafts. The current phase, completed steps, available next action, and pending persistence SHALL be distinct in text and appearance. A phase marker SHALL pulse only while work in that phase is actively progressing; a phase that is ready or waiting SHALL remain still. Unknown or optional schema artifacts SHALL NOT fabricate completion.

#### Scenario: Centered phase markers
- **WHEN** the timeline is shown at a wide or narrow viewport
- **THEN** each phase marker is centered on the connector between adjacent checkpoints and labels and actions are centered beneath their marker

#### Scenario: Horizontal draft milestones
- **WHEN** schema-derived artifact milestones are shown under Drafts
- **THEN** their smaller markers and labels appear in a horizontal row that can wrap on narrow screens

#### Scenario: Ready phase does not pulse
- **WHEN** a change is Ready and no phase or delivery is actively progressing
- **THEN** Ready is emphasized as the next phase without animation

#### Scenario: Active phase pulses
- **WHEN** an agent is actively working on a phase
- **THEN** that phase's marker pulses, and a reduced-motion preference disables the animation

#### Scenario: Drafting progress
- **WHEN** proposal and specs exist but required tasks are missing
- **THEN** Drafts is current, completed artifact milestones are shown, and the missing milestone is labeled

#### Scenario: Archive pending delivery
- **WHEN** an archive exists locally but its PR is still open
- **THEN** Archived is locally complete and its persistence is labeled pending with a PR link

#### Scenario: Alternate schema and validation
- **WHEN** the framework has different artifact names or a validation milestone
- **THEN** milestones derive from that schema and validation state instead of a hardcoded proposal/design/specs sequence

### Requirement: The timeline carries the next lifecycle action
The timeline SHALL present the available Draft artifacts, Implement, or Archive action at its corresponding phase, using the existing server eligibility and session handoff rules. It SHALL expose one primary next action, explain unavailable actions, and route blocked delivery to its recovery action. The detail view SHALL NOT duplicate these lifecycle controls in its console toolbar. Pull-request checkpoints SHALL appear after Drafts, Implementing, and Archived for proposal, implementation, and archive delivery, respectively, with each checkpoint showing its own delivery state, linked pull request, checks/readiness, conflicts, and merged state when available. A merged pull request SHALL be shown as complete and SHALL NOT make the local Done phase appear actively working.

#### Scenario: Ready to implement
- **WHEN** the change is Ready and implementation is available
- **THEN** Implement is the timeline's primary action and launching it uses the existing agent selection and confirmed session handoff

#### Scenario: Three phase-specific pull-request checkpoints
- **WHEN** proposal, implementation, and archive deliveries each have a pull request
- **THEN** their pull-request checkpoints appear after Drafts, Implementing, and Archived in that order, each linked to its own pull request

#### Scenario: Delivery status and conflict
- **WHEN** a phase delivery is checking, has passing checks, has conflicts, or is merged
- **THEN** only its checkpoint shows the corresponding active, successful, conflict, or merged state, with text as well as color

#### Scenario: Agent sessions disabled
- **WHEN** agent sessions are disabled
- **THEN** the timeline remains readable without presenting an enabled launch action
