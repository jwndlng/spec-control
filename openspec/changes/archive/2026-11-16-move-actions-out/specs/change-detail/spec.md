# Spec Delta

## ADDED Requirements

### Requirement: Console actions are visible and organized
The Console tab SHALL show its available pull request, change, and session actions without requiring the user to expand a disclosure. Actions SHALL remain grouped by category, and empty groups SHALL NOT be shown. Existing action availability, labels, and behavior SHALL remain unchanged.

#### Scenario: All available action groups are visible
- **WHEN** the Console tab has available actions in its pull request, change, and session groups
- **THEN** all three groups and their actions are visible without user interaction, and Ship remains in its prominent position

#### Scenario: An empty group is omitted
- **WHEN** the Console tab has no action available in one category
- **THEN** that category is not shown, while the groups with available actions remain visible
