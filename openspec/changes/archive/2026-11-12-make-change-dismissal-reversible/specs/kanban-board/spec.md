## ADDED Requirements

### Requirement: Dismissed changes are available through an explicit filter
The board SHALL hide dismissed active change identities by default across all their checkout copies. A Show dismissed filter SHALL reveal them with Restore, independently of Hide merged. Reloading, rescanning, and restarting SHALL preserve dismissal. Dismissal SHALL NOT alter lifecycle progress, archived history, dependency evidence, or agent work status.

#### Scenario: Dismissal survives a stale worktree
- **WHEN** a dismissed change still exists on a linked worktree branch
- **THEN** its card remains hidden by default after subsequent scans

#### Scenario: Restore
- **WHEN** the user reveals dismissed changes and chooses Restore
- **THEN** the active change returns to its derived lifecycle column without recreating or changing files
