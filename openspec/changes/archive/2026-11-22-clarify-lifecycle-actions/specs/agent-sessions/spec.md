## ADDED Requirements

### Requirement: The lifecycle timeline follows the phase's pull request

A lifecycle checkpoint SHALL offer Retry Ship only after a failed shipment that has no discovered or recorded pull request. An existing pull request SHALL drive its own status and recommended action, including while the change's agent session runs. A standalone action menu SHALL have a visible label.

#### Scenario: A pull request opens after an earlier shipping failure

- **WHEN** a phase has a discovered or recorded pull request and a delivery record still offers retry
- **THEN** the timeline shows the phase's pull request without a Retry Ship action

#### Scenario: A running session has an open pull request ready to merge

- **WHEN** a change's implementation pull request is ready while its agent session is running
- **THEN** the timeline offers a labelled Merge action
