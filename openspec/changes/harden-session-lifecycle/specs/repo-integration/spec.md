## ADDED Requirements

### Requirement: Integrate never shares a folder with another agent
Integrate SHALL be refused with a reason naming the other session while any session other than a running integration of the same folder — which is returned as it is today — runs with the folder, or a folder inside it, as its working directory; the main console in a configured console folder inside the repository is such a session. Paths SHALL be compared as canonical paths. No agent SHALL be started for a refused request, and the repository SHALL stay integratable.

#### Scenario: The console runs in the folder
- **WHEN** the console folder is `/w/acme/gamma-tools`, an untracked git repository without OpenSpec, the console is running, and the user activates Integrate for `/w/acme/gamma-tools`
- **THEN** Integrate is refused with a reason saying the console is running in that folder, no integration session is started, and the repository is still offered for integration

#### Scenario: The console runs below the folder
- **WHEN** the console is running in `/w/acme/gamma-tools/notes` and the user activates Integrate for `/w/acme/gamma-tools`
- **THEN** Integrate is refused and no integration session is started
