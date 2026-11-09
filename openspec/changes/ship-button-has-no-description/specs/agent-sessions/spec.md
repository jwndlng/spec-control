## ADDED Requirements

### Requirement: Draft and Implement maintain a pull request description

The **Draft artifacts** prompt SHALL ask the agent to create `openspec/changes/<change>/pull-request.md` containing a
concise summary of the problem, intended outcome and planned verification, based on the change artifacts. The
**Implement** prompt SHALL ask the agent to update that file to describe the delivered behavior and checks actually
performed, remove planned or unverified claims, and keep it concise for pull request reviewers. Neither prompt SHALL
claim a check passed unless it was run and passed. The file SHALL be ordinary Markdown included in the change's own
checkout.

#### Scenario: Draft prepares a description

- **WHEN** Draft artifacts completes the proposal for `rotate-keys`
- **THEN** `openspec/changes/rotate-keys/pull-request.md` summarizes the problem, intended outcome and planned
  verification for reviewers

#### Scenario: Implement records delivered work

- **WHEN** Implement completes code and runs its available checks for `rotate-keys`
- **THEN** `pull-request.md` describes the delivered behavior and reports only checks that were actually performed

### Requirement: Ship uses the prepared description for a new pull request

When deterministic Ship creates a pull request, it SHALL read `openspec/changes/<change>/pull-request.md` from the
session's own worktree, where `<change>` is the validated change name. If it is a readable regular file with non-empty
content after trimming surrounding whitespace, Ship SHALL pass that trimmed Markdown as the pull request body. It
MUST NOT read the artifact from the main checkout, another worktree, or a path outside the session worktree.

If the file is absent, blank, unreadable, or not a regular file, Ship SHALL use a fixed non-empty fallback body that
identifies the change and directs reviewers to its OpenSpec artifacts. This SHALL NOT prevent Ship from proceeding.
When a pull request for the session's branch already exists, Ship SHALL leave its title and body unchanged.

#### Scenario: New pull request uses the prepared description

- **WHEN** Ship creates a pull request for `rotate-keys` and the session worktree's description contains Markdown
- **THEN** `gh pr create` receives the trimmed Markdown as `--body`

#### Scenario: Legacy change has no description artifact

- **WHEN** Ship creates a pull request for a change whose worktree has no `pull-request.md`
- **THEN** the pull request receives the fixed non-empty fallback body and Ship proceeds

#### Scenario: Description artifact is empty or unsafe

- **WHEN** the description is blank, unreadable, or not a regular file
- **THEN** Ship uses the fallback and reads no file outside the session worktree

#### Scenario: Pull request already exists

- **WHEN** Ship finds an existing pull request for the session's branch
- **THEN** it does not change that pull request's body
