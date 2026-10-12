# Spec Delta

## MODIFIED Requirements

### Requirement: Adding from GitHub is simulated in the demo
The demo's mock API SHALL implement the GitHub repository listing, the clone endpoints and the workspace-folder
endpoint in memory, without a process, a network connection or a write anywhere. The listing SHALL return a fixed set
of fictional repositories of a fictional owner, at least one of them already added and at least one without OpenSpec.
A clone SHALL report made-up progress through the phases and complete after a few seconds into the demo's fictional
workspace root, and SHALL be cancellable while it runs: a repository marked as using
OpenSpec SHALL be tracked in the demo's in-memory configuration and appear on the projects overview with sample
changes, one without OpenSpec SHALL be listed under Unmanaged projects as integratable, and one fictional repository
SHALL fail with a canned reason so the failure, retry and dismiss can be seen. Creating a workspace folder SHALL succeed
in memory. Everything SHALL be gone after a reload.

#### Scenario: Cloning in the demo
- **WHEN** a demo visitor opens Add from GitHub, chooses a fictional repository that uses OpenSpec and activates Clone
- **THEN** after a short delay it is listed under Managed projects, and no request left the page

#### Scenario: Gone after reload
- **WHEN** the visitor clones a repository in the demo and reloads the page
- **THEN** the overview is back as on first load

#### Scenario: Progress and Cancel in the demo
- **WHEN** a demo visitor starts a clone and cancels it before it finished
- **THEN** its progress had advanced, it is listed as cancelled with Retry and Dismiss, and nothing was tracked
