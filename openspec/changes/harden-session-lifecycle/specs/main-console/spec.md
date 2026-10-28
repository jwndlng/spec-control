## ADDED Requirements

### Requirement: The console never shares its folder with another agent
Opening the console, and resuming an ended console, SHALL be refused with a reason naming the other session while any session that is not the console runs with the console folder as its working directory, or while an integration session runs in a folder that is the console folder or contains it — once that integration succeeds, the console folder would lie inside a tracked repository. Paths SHALL be compared as canonical paths. No agent SHALL be started for a refused request.

#### Scenario: Integration in the console folder
- **WHEN** the console folder is `/w/acme/gamma-tools`, an untracked git repository, and an integration session runs there
- **THEN** opening the console is refused with a reason naming the integration, and no console agent is started

#### Scenario: Integration of a folder holding the console folder
- **WHEN** the console folder is `/w/acme/gamma-tools/notes` and an integration session runs in `/w/acme/gamma-tools`
- **THEN** opening the console is refused, and no console agent is started
