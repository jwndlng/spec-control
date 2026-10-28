## ADDED Requirements

### Requirement: git counts as found by the environment check's rule

The `git` precondition of **New project** SHALL use the rule of the `environment-check` capability's "On macOS the git
placeholder is not git": on a Mac without the command line developer tools the request SHALL be refused as with no
git, before any folder is created.

#### Scenario: A Mac without the developer tools
- **WHEN** the user confirms a valid name on a Mac whose only `git` is Apple's placeholder
- **THEN** the request is refused with a reason saying git was not found, no folder is created and no process was started
