## MODIFIED Requirements

### Requirement: Checkout inspection is bounded and failure-isolated
The scanner SHALL inspect the checkouts of a repository with a bounded concurrency and within the repository's existing scan timeout. It SHALL always inspect the main checkout and SHALL inspect at most 50 linked worktrees per repository; further linked worktrees SHALL still be listed, marked as not inspected and without a status. When the status of a checkout cannot be determined — the command fails or times out — that checkout SHALL be reported with an unknown status, and this MUST NOT fail the repository's scan nor affect the status of its other checkouts. Only paths reported by `git worktree list` for a tracked repository SHALL be used as the working directory of such a command. When a repository's scan fails, its previously recorded checkouts and their statuses SHALL be retained. A repository that is not a git repository SHALL report no checkouts.

#### Scenario: More worktrees than the cap
- **WHEN** a repository has 53 linked worktrees
- **THEN** all 53 are listed, 50 of them with a status, and 3 marked as not inspected

#### Scenario: Status fails for one worktree
- **WHEN** the status command fails in one of three linked worktrees
- **THEN** that worktree is reported with an unknown status, the other two and the main checkout carry their status, and the repository is reported with `ok: true`

#### Scenario: Status times out
- **WHEN** the status command does not return within the command timeout for a worktree
- **THEN** that worktree is reported with an unknown status and the scan of the repository completes

#### Scenario: Failed scan keeps the previous values
- **WHEN** a repository was scanned successfully with two worktrees and its next scan fails
- **THEN** it is reported with `ok: false` and still lists those two worktrees with their last known status

#### Scenario: Non-git repository
- **WHEN** a tracked repository is not a git repository
- **THEN** it reports no checkouts and no work-in-progress summary
