## ADDED Requirements

### Requirement: Overview automation messages explain user-relevant progress
The overview SHALL NOT render internal agent instructions such as "The agent must verify current evidence" or raw ISO timestamps as routine card content. PR freshness SHALL be available on demand with a relative label and precise timestamp. A failed refresh SHALL remain visible when it affects an action. Agent-side evidence verification SHALL be preserved.

#### Scenario: Finish checks is available
- **WHEN** a card offers Finish checks for a cached merged PR
- **THEN** it presents the action without the internal evidence sentence while the follow-up agent still receives its verification instruction

#### Scenario: Failed refresh
- **WHEN** a PR refresh failed and current evidence affects the offered action
- **THEN** the user sees a concise refresh failure with a useful recovery route

#### Scenario: Freshness on demand
- **WHEN** the user inspects the action's freshness label
- **THEN** relative freshness and the exact fetched timestamp are accessible without expanding routine card content
