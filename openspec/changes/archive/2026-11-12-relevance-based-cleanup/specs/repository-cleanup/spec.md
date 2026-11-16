## ADDED Requirements

### Requirement: Cleanup prioritizes active changes and recent work
The cleanup preview SHALL keep the main checkout, active agent sessions, user-locked worktrees and worktrees with uncommitted changes. A branch or worktree associated with an active change directory SHALL be kept. Otherwise, merged branches and clean worktrees SHALL be offered for cleanup regardless of age. Unmerged branches and worktrees SHALL be kept when their latest commit is within the last 30 days and SHALL be offered when older. The preview SHALL state whether an item is kept for an active change or recent unmerged work. Existing default-branch, main-checkout, stale-record and linked-worktree dependencies remain in force.

#### Scenario: Active change protects its branch and worktree
- **WHEN** branch `feat/rotate-keys` corresponds to active change directory `openspec/changes/rotate-keys`
- **THEN** its branch and worktree are kept even if merged or old

#### Scenario: Recent unmerged work is kept
- **WHEN** an unmerged branch has its latest commit within the last 30 days and is not part of an active change
- **THEN** the branch and its clean worktree are kept with a recent-work reason

#### Scenario: Old unrelated unmerged work is offered
- **WHEN** an unmerged branch has no active change and its latest commit is more than 30 days old
- **THEN** its branch and clean worktree are offered for cleanup

#### Scenario: Merged recent work is offered
- **WHEN** a merged branch has no active change
- **THEN** its branch and clean worktree are offered regardless of commit age
