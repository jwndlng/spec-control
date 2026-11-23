## ADDED Requirements

### Requirement: Phase guidance follows actionable evidence
The UI SHALL support the following user journeys.

#### Scenario: PR checks are unknown
- **WHEN** the phase PR is known but its latest check status is unavailable
- **THEN** show the last known status and PR link without claiming checks are running or offering another Ship

#### Scenario: Draft document on a narrow screen
- **WHEN** a keyboard or touch user selects Drafts
- **THEN** show full schema document names, statuses and available document links

#### Scenario: Archive pending delivery
- **WHEN** an archive exists locally and its PR awaits merge
- **THEN** identify the archive PR beneath Archived and show its verified state

#### Scenario: Completed delivery after a retry
- **WHEN** fresh evidence confirms the same phase PR merged
- **THEN** replace stale recovery controls with the merged result

#### Scenario: Return after an interrupted implementation
- **WHEN** the user reopens a change with incomplete tasks after its session ended
- **THEN** Implementing shows current task progress and the eligible continuation without an active pulse

#### Scenario: Resolve the implementation PR conflict
- **WHEN** fresh evidence confirms a conflict on the implementation PR
- **THEN** offer the eligible resolution beside that PR and retire it once the conflict clears

#### Scenario: Finish the change
- **WHEN** implementation has merged and the change is eligible for archive
- **THEN** offer Archive beneath Archived and distinguish local archival from the subsequent archive PR outcome

#### Scenario: Ship once
- **WHEN** phase verification is required before shipping
- **THEN** show one shipping action under that phase and replace it with progress after acceptance
