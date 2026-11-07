# Spec Delta

## ADDED Requirements

### Requirement: The detail view shows a change's implementation model choice
When a change has a recorded implementation model choice, its detail view SHALL show that model as the choice for Implement.

#### Scenario: Recorded choice is shown
- **WHEN** change `cache-api-calls` records `reasoning-model` as its implementation model
- **THEN** its detail view identifies `reasoning-model` as the model selected for Implement

