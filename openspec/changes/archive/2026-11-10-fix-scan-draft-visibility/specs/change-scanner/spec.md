## MODIFIED Requirements

### Requirement: Reading worktrees is bounded and isolated
The scanner SHALL read every eligible linked worktree with bounded concurrency, preferring those whose changes directory was modified most recently for scheduling only. It MUST NOT omit a readable worktree solely because other worktrees are newer or because there are more than twelve. A worktree that cannot be read, or whose reading fails or times out, SHALL be skipped with a repository warning naming it, and MUST NOT fail the repository's scan or affect changes read from other checkouts. All of it SHALL run within the repository's scan timeout. The repository snapshot SHALL list paths of worktrees whose changes directory exists but could not be read, and SHALL omit that list when all were read. Stale-leftover detection SHALL resolve each linked worktree path at most once per invocation, reusing it across archived changes without caching it across scans. It SHALL inspect archived changes with bounded concurrency and preserve their report ordering.

#### Scenario: More worktrees than the cap
- **WHEN** a repository has fifteen readable linked worktrees containing unique draft changes and completes within the scan deadline
- **THEN** all fifteen drafts appear, including those in the oldest worktrees, without a count-limit warning

#### Scenario: One worktree fails
- **WHEN** one worktree cannot be read and the others are readable
- **THEN** the failed path is reported as unread with a warning, while changes from the other worktrees appear

#### Scenario: Many archived changes
- **WHEN** stale detection checks many archives against the same linked worktrees
- **THEN** each linked worktree path is resolved once for that invocation

#### Scenario: Worktree directory was deleted by hand
- **WHEN** git reports a worktree as prunable because its directory no longer exists
- **THEN** it is skipped, the repository is reported with `ok: true`, and changes from other checkouts are unaffected

#### Scenario: Every worktree read
- **WHEN** a repository scan reads all its linked worktrees
- **THEN** its snapshot lists no worktree as not read
