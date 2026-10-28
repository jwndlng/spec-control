## ADDED Requirements

### Requirement: The Workspace step keeps the projects the user left out

A project the user unchecked on the Workspace step SHALL stay unchecked for as long as the wizard is open — after
**Continue** saved the step, after a refused clone kept the step open, and after **Back** or the step list returned to
the step — and SHALL NOT be tracked by any later **Continue** unless the user checks it again.

#### Scenario: A refused clone keeps the step open
- **WHEN** discovery lists `/w/acme/alpha-infra` and `/w/acme/demo-ops`, the user unchecks `demo-ops`, lists `acme/chat-groups` whose folder already exists, and continues, then renames the folder and continues again
- **THEN** `alpha-infra` is tracked, `demo-ops` was shown unchecked throughout and is not in the configuration

#### Scenario: Back to the Workspace step
- **WHEN** the user unchecked `demo-ops`, continued to Agents, activated **Back** and continued again
- **THEN** `demo-ops` is shown unchecked and is not in the configuration

### Requirement: The wizard identifies a clone by the server's path

The wizard SHALL remember each clone it started by the path the server reported for that clone when it accepted it,
and the Done step SHALL show every such clone — its progress, failure and **Retry** — whatever spelling the user typed
the workspace root in.

#### Scenario: A root typed in another case
- **WHEN** the folder `~/Workspace` exists on a case-insensitive disk, the user types `~/workspace` as a root, lists `acme/missing-repo` and continues, and the clone later fails
- **THEN** the Done step lists `acme/missing-repo` with its reason and **Retry**

#### Scenario: A root through a symbolic link
- **WHEN** the user types a root whose path runs through a symbolic link and lists `acme/beta-soc`
- **THEN** the Done step lists `acme/beta-soc` with its progress while it clones

### Requirement: The Workspace step continues only on the latest discovery

While discovery runs on the Workspace step, **Continue** SHALL be unavailable, saying that projects are still being
looked for, and the step list SHALL NOT move forward; **Continue** SHALL track only projects from the latest discovery
result.

#### Scenario: Removing a root and continuing at once
- **WHEN** the user removes the entered root `/w/acme`, whose projects were listed, and activates **Continue** before discovery has finished
- **THEN** nothing is saved; once discovery has finished, **Continue** saves the remaining roots and tracks no project under `/w/acme`, and no error is shown
