## MODIFIED Requirements

### Requirement: Explicit Archive is not blocked by unfinished tasks
Spec Control SHALL offer **Archive** only when the change is in `Done` and its required artifacts are ready. Unresolved or unknown task state SHALL NOT make Archive available before `Done`. A dependency that is not met SHALL NOT withhold Archive from a change in `Done`. Archive SHALL preserve task state and SHALL NOT imply that outstanding work was completed. Automatic Archive SHALL continue to follow its separate eligibility requirements, including its task completion gate.

#### Scenario: Ready change has unresolved tasks
- **WHEN** a change's required artifacts are ready but its stage is `Ready` or `Implementing`
- **THEN** Archive is not offered, whether or not the change has an unmet dependency

#### Scenario: Done change has an unmet dependency
- **WHEN** a change is in `Done`, its required artifacts are ready, and one or more dependencies are unresolved
- **THEN** Archive is offered and preserves the dependency and task state
