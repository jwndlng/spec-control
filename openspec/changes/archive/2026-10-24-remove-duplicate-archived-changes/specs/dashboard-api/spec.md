## ADDED Requirements

### Requirement: A remove-duplicate session request is checked against the last scan
The session start request SHALL accept `removeDuplicate: true` together with `action: "archive"`, a tracked repository
and a validated change name, and nothing else describing the duplicate. The server SHALL refuse it with a 4xx status and
the reason when the action is not `archive`, when its own last scan reports no duplicate after archive for that change,
when a local branch `chore/archive-<name>` exists or a worktree is on it, or when a session for the change is running;
otherwise it SHALL start the session with the archive directory and differing paths of that scan. The request passes
the same-origin guard of every mutating route.

#### Scenario: Smuggled archive name
- **WHEN** a request carries `removeDuplicate: true` and an `archive` field naming another directory
- **THEN** the extra field is ignored and the prompt names the archive directory from the last scan

#### Scenario: Wrong action
- **WHEN** a request carries `removeDuplicate: true` with `action: "implement"`
- **THEN** it is refused and no session starts
