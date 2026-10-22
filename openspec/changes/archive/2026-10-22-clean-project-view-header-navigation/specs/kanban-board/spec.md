## MODIFIED Requirements

### Requirement: The board opens with a header band
The combined board SHALL show a header band above its filter row. It SHALL hold the title `All changes`, the number of open (not archived) changes matching the active filters and the number of changes to archive, each as a labelled count, and the **New change** action as the band's only filled primary button, under the same visibility rules the `change-creation` capability gives it. These counts and the action SHALL NOT also appear in the filter row. On a repository board the repository board header SHALL take the same band styling and show the same two counts for that repository first in its quick view (project-overview: "Repository board header"). The counts SHALL follow the snapshot and the filters without a reload.

#### Scenario: Band on the combined board
- **WHEN** the combined board shows 14 open changes and 3 changes are complete or synced
- **THEN** the band reads `All changes`, shows `Open 14` and `To archive 3`, and offers **New change** as a filled primary button

#### Scenario: Counts follow the filters
- **WHEN** the user filters the combined board to repository `alpha-infra`, which has 5 open changes
- **THEN** the band's open count reads `5` without a reload

#### Scenario: No eligible repository
- **WHEN** no tracked repository is eligible for a new change
- **THEN** the band shows its title and counts and no **New change** button

#### Scenario: Repository board
- **WHEN** the board for `alpha-infra` is shown
- **THEN** the repository header is drawn as the band, its quick view starts with the open and to-archive counts of `alpha-infra`, and the filter row holds no counts and no **New change** button

### Requirement: Actions have their own area
Wherever a board or the overview offers actions for what it shows — **New change** on the combined board, the actions of a repository board — they SHALL sit together in an action area at the end of the header band, separate from titles, counts, checkout chips, notes and badges, at full control size and never squeezed between them. The action area SHALL hold actions only: no note, count or status badge SHALL stand in it. The primary action SHALL be the last and only filled button in that area. When the window is narrow the area SHALL move below the header's content as one group rather than splitting.

On a repository board the actions SHALL be arranged in named groups, in this order, each shown only when at least one of its actions is offered:
- **Agent**: the project console control (project-console: "Each managed project offers a project console").
- **Repository**: **Pull** and **Clean up**.
- **Changes**: **Import from issues** and **New change**, the primary action, last.
Each group SHALL show its name as a small visible caption tied to its actions and SHALL be exposed to assistive technology as a group with that name. Each action SHALL keep its visible text and SHALL carry a one-sentence description, as its tooltip and as its accessible description, saying what it does and, where it touches the repository, what it leaves alone: Console opens an agent in the project's own folder for anything that is not a change; Pull brings the main checkout up to date with its remote by fast-forward only, never merging, rebasing or discarding work; Clean up lists worktrees and branches that are safe to remove and removes only those the user confirms; Import from issues turns open GitHub issues into new changes; New change creates a change directory with an optional prompt. An action that is offered but inactive SHALL say why in the same description. When the window is narrow the groups SHALL wrap as whole groups, never separating an action from its group's caption.

#### Scenario: Repository board actions
- **WHEN** agent sessions are on and the board of `alpha-infra`, a git repository whose last scan succeeded, is shown
- **THEN** the action area shows **Agent** with Console, **Repository** with Pull and Clean up, and **Changes** with Import from issues and the filled **New change**, in that order, apart from the quick view's chips, notes and badges

#### Scenario: Actions are described
- **WHEN** the user hovers over **Pull** or a screen reader reaches it
- **THEN** it reads that Pull fast-forwards the main checkout from its remote and never merges, rebases or discards work

#### Scenario: A group with nothing to offer
- **WHEN** the board of a folder without git is shown while agent sessions are off
- **THEN** the action area shows only the **Changes** group, without **Import from issues**, and no **Agent** or **Repository** caption

#### Scenario: Fetch note is not an action
- **WHEN** the board of `alpha-infra` shows that it was fetched 4 minutes ago
- **THEN** `fetched 4m ago` stands in the quick view and not in the action area

#### Scenario: Narrow window
- **WHEN** the window is 720px wide
- **THEN** the action area wraps below the title and quick view as one group, each action group stays together with its caption, and every action in it stays fully visible
