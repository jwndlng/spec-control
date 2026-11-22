## ADDED Requirements

### Requirement: Activity reports are independent of phase completion

The session manager SHALL expose a session-local activity file through `SPEC_CONTROL_ACTIVITY_FILE`. It SHALL accept the same bounded `waiting` and `working` reports and apply the same freshness rules as for legacy state reports. When both files contain valid activity reports, the more recent report SHALL take precedence, with the activity file winning ties. The manager SHALL clear the activity file before starting or resuming a process and SHALL read phase completion from the existing state file.

#### Scenario: An agent reports waiting alongside a phase completion

- **WHEN** a running agent has a valid phase completion report and writes a current waiting report to its activity file
- **THEN** the dashboard shows the agent as waiting and preserves the phase completion report

### Requirement: Open work surfaces agents waiting for the user

Open work SHALL display a count of running change sessions with current waiting reports and show those sessions first.

#### Scenario: One of several agents asks the user for input

- **WHEN** one running change session reports waiting while another is working
- **THEN** Open work shows one session waiting for the user and lists it above the working session
