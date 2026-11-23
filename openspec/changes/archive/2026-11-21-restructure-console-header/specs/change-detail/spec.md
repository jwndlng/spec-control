# Spec Delta

## MODIFIED Requirements

### Requirement: Maintenance actions are progressively disclosed
Resume, Clean up, Delete record, and Open in editor SHALL be directly visible in a session actions group with an accessible name but no visible heading for the selected session when applicable, without expanding a menu. Their eligibility and confirmations SHALL be retained. The visible worktree path SHALL have an adjacent keyboard-accessible copy icon with success/failure feedback; detail SHALL NOT show a separate Copy cd text button.

#### Scenario: Ended session
- **WHEN** a resumable ended session is selected
- **THEN** Resume is directly available in its actions group without competing with the lifecycle action

#### Scenario: Copy path
- **WHEN** the user activates the icon beside a worktree path
- **THEN** exactly the absolute path is copied, success is announced only after a successful clipboard write, and no command runs

#### Scenario: Small screen and keyboard
- **WHEN** detail is viewed at narrow width or navigated by keyboard
- **THEN** timeline labels, artifact tabs, the always-visible session actions, and copy controls remain reachable with visible focus and no page-wide horizontal overflow

### Requirement: The detail header offers Dismiss change
The detail header SHALL offer **Dismiss change** for a change that is not archived and whose directory the snapshot places in the repository's main checkout — its own checkout or one of its other checkouts is the main checkout. It SHALL be set apart from the change's facts and have a visible border at rest, so that it is recognizable as an available action without hover or focus. For an active change held only by linked worktrees it SHALL be shown disabled, with a tooltip naming the worktree's branch and saying that such a change leaves the board when that worktree is removed. It SHALL NOT be shown for an archived change, for a change that is gone from the snapshot, or in the repository's failed or disabled state. Activating it SHALL open the dismiss confirmation of the `change-dismissal` capability inside the detail view. After a successful dismissal the detail view SHALL close to the board it was opened from — unless a linked worktree still holds the change, in which case it stays open on the copy now shown — and a short notice SHALL say that the change was dismissed and whether its removal was staged.

#### Scenario: Offered for a draft
- **WHEN** the detail view is open for `lint-rules` in `Drafts`, whose directory is in the main checkout
- **THEN** the header offers **Dismiss change** with a visible border at rest

#### Scenario: Not offered for an archived change
- **WHEN** the detail view is open for an archived change
- **THEN** the header does not offer **Dismiss change**

#### Scenario: Worktree-only change
- **WHEN** the detail view is open for `cloud-deployment`, held only by a linked worktree on `feat/cloud-deployment`
- **THEN** **Dismiss change** is disabled and its tooltip names `feat/cloud-deployment`

#### Scenario: After dismissing
- **WHEN** the user confirms dismissing `lint-rules` and no linked worktree holds it
- **THEN** the detail view closes to the board it was opened from, which no longer shows `lint-rules`, and a notice says it was dismissed and its removal staged

#### Scenario: Refused
- **WHEN** the dismissal is refused because the change changed since the confirmation was shown
- **THEN** the confirmation stays open, says why, and offers to show the current state again

### Requirement: The console tab shows work status and offers Ship
The Console tab SHALL show the work status of the selected session's worktree. It MUST NOT show a Ship button or duplicate a shipping action in the console panel. When shipping is available, the lifecycle timeline SHALL show Ship at the matching delivery checkpoint. For `merged` work, the Console tab SHALL suggest removing the worktree, and the clean-up dialog SHALL preselect removal.

#### Scenario: Ship from the console
- **WHEN** shipping is available for the selected change session
- **THEN** Ship is offered at the matching lifecycle delivery checkpoint and is absent from the Console panel

#### Scenario: Merged
- **WHEN** the Console tab is opened for a session whose worktree is `merged`
- **THEN** Ship is not offered and removal of the worktree is suggested

## ADDED Requirements

### Requirement: Delete change files remains visibly outlined
When offered in the detail header, **Delete change files** SHALL have a visible border at rest so the action is recognizable without hover or focus.

#### Scenario: Delete change files at rest
- **WHEN** the detail header offers **Delete change files**
- **THEN** the control has a visible border before pointer hover or keyboard focus

### Requirement: The console panel keeps its header compact
The Console panel header SHALL occupy no more than 20% of the available Console panel height, leaving at least 80% for the terminal. Its top-left area SHALL keep the selected session's agent, project, branch when present, session state, and work status visible. Its top-right area SHALL place End session and Open in editor when each is available, without a visible "Session actions" heading.

#### Scenario: Console panel header layout
- **WHEN** a change session with a branch and uncommitted work is shown in the Console tab
- **THEN** the agent, project, branch, working state and uncommitted status appear at the top left of the Console panel, End session and Open in editor appear at its top right without a "Session actions" heading, and the terminal has at least 80% of the panel height

#### Scenario: In-place session
- **WHEN** the selected session runs in place and has no branch or worktree status
- **THEN** the header shows its agent, project and in-place state without reserving space for absent branch or work status

### Requirement: Console configuration is progressively disclosed
Agent and permission settings for the change SHALL be grouped behind a collapsed-by-default disclosure in the Console panel, opened by a settings gear button with an accessible name and tooltip. Opening it SHALL expose the existing controls and their current saved values; closing it SHALL return the panel to its compact header without changing those values.

#### Scenario: Settings stay out of the compact header
- **WHEN** the Console tab is opened
- **THEN** agent and permission settings are hidden behind a collapsed disclosure and a settings gear button identifies that it opens console settings

#### Scenario: Change a console setting
- **WHEN** the user opens the settings disclosure and changes an available setting
- **THEN** the existing setting behavior and feedback are preserved, and the console session is not restarted

### Requirement: The change window provides room for Console settings
The change window SHALL use the available viewport with compact outer gutters and SHALL grow beyond its previous width and height limits on larger screens. When Console Settings is open, its menu SHALL remain visible outside the compact header, bounded by the viewport and scrollable when its contents exceed the available height.

#### Scenario: Open settings
- **WHEN** the user opens Console Settings
- **THEN** the menu is not clipped by the compact Console header and its contents can be reached by scrolling

#### Scenario: Larger viewport
- **WHEN** the detail view opens on a viewport larger than the previous window limits
- **THEN** the change window uses the additional width and height while keeping its outer gutters
