## MODIFIED Requirements

### Requirement: Reading worktrees is bounded and isolated
The scanner SHALL read a repository's worktrees with bounded concurrency and SHALL read at most 12 worktrees per repository, preferring those whose `openspec/changes` directory was modified most recently; when worktrees are left out, the repository's warnings SHALL say how many. A worktree that cannot be read, or whose reading fails or times out, SHALL be skipped with a repository warning naming it, and MUST NOT fail the repository's scan or affect changes read from other checkouts. All of it SHALL run within the repository's scan timeout. The repository's snapshot SHALL list the paths of the linked worktrees that have an `openspec/changes` directory but were not read, as the same paths its changes' checkouts carry — left out by the limit, or skipped because reading failed or timed out — so that a change missing from that scan can be told from a change that is gone (`activity-feed`: "A worktree left unread is not activity"); the list SHALL be omitted when every such worktree was read. It SHALL NOT change what the board shows.

#### Scenario: Worktree directory was deleted by hand
- **WHEN** git reports a worktree as prunable because its directory no longer exists
- **THEN** it is skipped, the repository is reported with `ok: true`, and changes from other checkouts are unaffected

#### Scenario: One worktree fails
- **WHEN** reading one worktree throws while two others are readable
- **THEN** the repository's warnings name the failing worktree, its path is listed among the worktrees not read, and the changes from the main checkout and the other two worktrees are reported

#### Scenario: More worktrees than the cap
- **WHEN** a repository has 15 linked worktrees with changes
- **THEN** the 12 with the most recently modified `openspec/changes` are read, the warnings say that 3 were not, and the paths of those 3 are listed among the worktrees not read

#### Scenario: Every worktree read
- **WHEN** a repository's scan reads all of its linked worktrees
- **THEN** its snapshot lists no worktree as not read
