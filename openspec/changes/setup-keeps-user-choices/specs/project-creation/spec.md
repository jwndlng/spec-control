## ADDED Requirements

### Requirement: A created project can be forgotten like any other

A project added to the configuration by the integration session that **New project** started SHALL, once the user
disables and forgets it, stay out of the configuration as specified in "A forgotten integrated repository stays
forgotten" (`repo-integration` capability), whether that session has ended or still runs.

#### Scenario: Forgetting a new project
- **WHEN** the user created `/w/acme/demo-ops`, its agent set it up, and the user disables and forgets it on the projects overview
- **THEN** after the overview's discovery `/w/acme/demo-ops` is not in the configuration and is listed as a candidate
