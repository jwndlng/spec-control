# Spec Delta

## ADDED Requirements

### Requirement: Change scans read an optional implementation model choice
For an OpenSpec change, a scan SHALL read an optional model string from `spec-control.implement-model` in its `.openspec.yaml` metadata and expose a valid value with the change. A missing or invalid value SHALL be treated as no choice and SHALL NOT make the change unreadable.

#### Scenario: Valid choice is read
- **WHEN** a change's `.openspec.yaml` contains `spec-control.implement-model: reasoning-model`
- **THEN** the scan exposes `reasoning-model` as the change's implementation model choice

#### Scenario: Missing choice
- **WHEN** a change's `.openspec.yaml` has no `implement-model` value under `spec-control`
- **THEN** the scan exposes no implementation model choice

#### Scenario: Invalid choice is ignored
- **WHEN** a change's `.openspec.yaml` contains an empty, multiline, control-character, or permission-bypass model value
- **THEN** the scan exposes no implementation model choice and continues reading the change
