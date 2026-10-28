## ADDED Requirements

### Requirement: Add from GitHub finds git by the environment check's rule

Whether `git` was found on this machine, for offering **Add from GitHub** and for accepting a clone, SHALL be decided
by the `environment-check` capability's "On macOS the git placeholder is not git".

#### Scenario: A Mac without the developer tools
- **WHEN** the only `git` on a Mac is Apple's placeholder
- **THEN** **Add from GitHub** is inactive and its reason says that git was not found, and a clone request is refused without running `git`
