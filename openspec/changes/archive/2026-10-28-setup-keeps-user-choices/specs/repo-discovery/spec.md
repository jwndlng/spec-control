## ADDED Requirements

### Requirement: Discovery never re-adds a forgotten repository

Running discovery SHALL NOT add to the configuration a repository the user forgot, by any path — including the
re-check of integration sessions that discovery performs (`repo-integration` capability). A forgotten repository under
a workspace root SHALL be listed as a candidate until the user enables it.

#### Scenario: A repository set up with Integrate is forgotten
- **WHEN** the user forgets the disabled repository `/w/acme/alpha-infra`, which was added by a confirmed integration, and discovery runs
- **THEN** `/w/acme/alpha-infra` is absent from the configuration and listed as a candidate with its default name
