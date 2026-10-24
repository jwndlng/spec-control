# kanban-board Specification

## Purpose
Defines the Kanban board UI: how changes map to columns, what cards display, filtering, the archived column, refresh behaviour, the copy-apply-command action and the visual design tokens.

## Requirements

### Requirement: Board columns follow the lifecycle phases
The board SHALL place each change in exactly one column, where a column names the phase of the lifecycle the change is in. Using, in order: `Archived` if the change is archived; `Done` if `tasks.total > 0` and `tasks.done == tasks.total`, whether or not the change's delta specs are already synced into the main specs; `Implementing` if `tasks.done > 0`; `Ready` if every **required** artifact is done (ready to apply, nothing ticked yet); `Unknown` if the change's artifacts could not be read; `Backlog` if no artifact is done; otherwise `Drafts` (at least one artifact is done and at least one required artifact is not). An artifact is required when the change's schema names it in `apply.requires` — the artifacts OpenSpec needs before implementation starts; for `spec-driven` that is `tasks` alone, so `design` (and likewise `proposal` and `specs`) never holds a change back from `Ready`. When a schema declares no `apply.requires`, every artifact of it is required. When the change's artifact statuses do not say which artifacts are required — a snapshot recorded before they did — every artifact SHALL count as required. Which artifacts are done, and in which order they were written, SHALL NOT matter beyond that, and the board SHALL NOT name any artifact itself: every schema is placed by its own `apply.requires`.

The board SHALL show the columns `Backlog`, `Drafts`, `Ready`, `Implementing`, `Done`, `Archived`, in that order, on the combined board and on every repository board, whether or not a column holds a change; `Unknown` SHALL be shown between `Drafts` and `Ready` only while at least one change on that board is in it. Columns MUST NOT depend on the schemas the tracked changes use: there SHALL be no column per artifact and no `Synced` column.

#### Scenario: Brand-new change
- **WHEN** a change directory exists and none of its artifacts is done
- **THEN** it appears in the `Backlog` column

#### Scenario: Change with a prompt only
- **WHEN** a change has a `prompt.md` and none of its artifacts is done
- **THEN** it appears in the `Backlog` column

#### Scenario: Change with proposal only
- **WHEN** a `spec-driven` change has `proposal: done` and `design`, `specs` and `tasks` not done
- **THEN** it appears in the `Drafts` column

#### Scenario: Specs written before design
- **WHEN** a `spec-driven` change has `proposal` and `specs` done and `design` and `tasks` not done
- **THEN** it appears in the `Drafts` column

#### Scenario: Only a later artifact written
- **WHEN** a `spec-driven` change has `specs` done and `proposal` not done
- **THEN** it appears in the `Drafts` column, not in `Backlog`

#### Scenario: The column count covers both sub-states
- **WHEN** the `Done` column holds three complete changes and two awaiting validation
- **THEN** its header count is `5` and every "to archive" count is `5`

#### Scenario: First task ticked
- **WHEN** all artifacts are done and `tasks` is `done: 1, total: 12`
- **THEN** it appears in `Implementing` showing `1/12`

#### Scenario: Tasks ticked while an artifact is still open
- **WHEN** `design` is not done and `tasks` is `done: 2, total: 12`
- **THEN** it appears in `Implementing`

#### Scenario: Complete but not synced
- **WHEN** `tasks` is `done: 12, total: 12`, the change is not archived, and its delta specs are not yet reflected in the main specs
- **THEN** it appears in the `Done` column

#### Scenario: Complete and synced, not yet archived
- **WHEN** `tasks` is `done: 12, total: 12`, the change is not archived, and its delta specs are reflected in the main specs
- **THEN** it appears in the `Done` column, counts towards "to archive", and is offered **Archive** like any other change in `Done`

#### Scenario: Archived after syncing
- **WHEN** a change whose specs were synced is archived
- **THEN** it appears in the `Archived` column

#### Scenario: All artifacts done but tasks file empty
- **WHEN** all artifacts are done and `tasks` is `done: 0, total: 0`
- **THEN** it appears in `Ready` with a "no tasks" warning badge

#### Scenario: Ready without a design
- **WHEN** a `spec-driven` change has `proposal`, `specs` and `tasks` done, `design` not done, and `tasks` is `done: 0, total: 6`
- **THEN** it appears in `Ready`, not in `Drafts`, and its card offers **Implement**

#### Scenario: Tasks written, nothing else
- **WHEN** a `spec-driven` change has only `tasks` done and `tasks` is `done: 0, total: 4`
- **THEN** it appears in `Ready`

#### Scenario: Design written, tasks missing
- **WHEN** a `spec-driven` change has `proposal`, `specs` and `design` done and `tasks` not done
- **THEN** it appears in `Drafts`

#### Scenario: Tasks file empty, no design
- **WHEN** a `spec-driven` change has `proposal`, `specs` and `tasks` done, `design` not done, and `tasks` is `done: 0, total: 0`
- **THEN** it appears in `Ready` with a "no tasks" warning badge

#### Scenario: A schema without apply.requires
- **WHEN** a change uses a schema whose artifacts are `brief`, `plan`, `checklist`, which declares no `apply.requires`, and `brief` and `checklist` are done
- **THEN** it appears in `Drafts`, because every artifact of that schema is required

#### Scenario: A snapshot from before required artifacts were reported
- **WHEN** a cached snapshot lists a `spec-driven` change with `design` not done and `tasks` done, its artifact statuses carrying no required flag
- **THEN** the change is shown in `Drafts`, as before, until the next scan reports which artifacts are required

#### Scenario: Column list for the spec-driven schema
- **WHEN** every tracked change uses the `spec-driven` schema
- **THEN** the board shows the columns `Backlog`, `Drafts`, `Ready`, `Implementing`, `Done`, `Archived`, and no `Proposal`, `Design`, `Specs`, `Tasks` or `Synced` column

#### Scenario: Another schema gets the same columns
- **WHEN** every tracked change uses a schema whose artifacts are `brief`, `plan`, `checklist`, and one change has `brief` done
- **THEN** the board shows `Backlog`, `Drafts`, `Ready`, `Implementing`, `Done`, `Archived`, and that change is in `Drafts`

#### Scenario: Lifecycle columns are always present
- **WHEN** no change is in the backlog, being drafted or ready to apply
- **THEN** the board still shows empty `Backlog`, `Drafts` and `Ready` columns in their positions

#### Scenario: Unreadable change
- **WHEN** a change's artifacts could not be read
- **THEN** it appears in the `Unknown` column, between `Drafts` and `Ready`, not in `Backlog`

### Requirement: Board filters
The board SHALL provide filters for repository (multi-select), free-text search over change name and repository name, a recent-activity threshold (default off), a toggle to hide the `Archived` column, and a toggle to hide merged archived changes (default on). **Hide merged** SHALL NOT hide an archived change while an agent session started for that change — its own session or its archive session — is running: such a change SHALL stay in the `Archived` column, take its place among the changes the column's count and bound consider, and be shown whether it is merged or pending. A session that has ended (exited or failed) SHALL NOT keep a change; once every session of the change has ended, **Hide merged** SHALL apply to it as to any other archived change, so the user ends the session to let a merged change be hidden. Running a session SHALL NOT make a change pending, and the main console and integration sessions, which belong to no change, SHALL keep no change. Which sessions are running SHALL come from the session list the board already has, without fetching or writing anything. With a recent-activity threshold of N days the board SHALL hide every change whose last activity is N days (N × 24 hours) ago or longer and SHALL show every change with activity within the last N days, in every column, `Archived` included. A change whose last activity time is unknown SHALL be shown. A change with a running agent session started for it — its own session or its archive session — SHALL be shown whatever its last activity, under the same rules as **Hide merged**: an ended session SHALL NOT keep it, and the main console, project consoles and integration sessions SHALL keep no change. Filters SHALL apply instantly on the client and persist in the URL query string.

#### Scenario: Repo filter
- **WHEN** the user selects repos `beta-soc` and `vcs-admin`
- **THEN** only cards from those two repositories are shown

#### Scenario: Stale filter
- **WHEN** the recent-activity threshold is set to 7 days and `alpha-infra` has `add-sync` with activity 2 days ago and `old-idea` with activity 20 days ago
- **THEN** `add-sync` is shown and `old-idea` is hidden

#### Scenario: Recently archived change stays
- **WHEN** the recent-activity threshold is set to 7 days, **Hide merged** is off and an archived change was archived 3 days ago while another was archived 40 days ago
- **THEN** the `Archived` column shows the first and not the second

#### Scenario: Unknown activity time is kept
- **WHEN** the recent-activity threshold is set to 7 days and a change has no last activity time
- **THEN** that change is shown

#### Scenario: Running session keeps an old change
- **WHEN** the recent-activity threshold is set to 7 days and `old-idea`, last active 20 days ago, has a running agent session
- **THEN** `old-idea` is shown, and once that session has ended and the board has the updated session list it is hidden

#### Scenario: Filters in URL
- **WHEN** the user reloads the page after setting a text search of `terraform`
- **THEN** the search filter is still applied

#### Scenario: Merged archives hidden by default
- **WHEN** the board opens with no query string and the `Archived` column would hold 30 merged and 2 pending archived changes
- **THEN** the `Archived` column shows only the 2 pending ones and its header count reads `2`

#### Scenario: Showing merged archives
- **WHEN** the user turns **Hide merged** off
- **THEN** the `Archived` column shows merged and pending archived changes alike, the URL holds `merged=1`, and after a reload merged archives are still shown

#### Scenario: Running session keeps a merged archive
- **WHEN** **Hide merged** is on and `alpha-infra`'s merged archived change `add-audit-log` has a running agent session
- **THEN** `add-audit-log` is shown in the `Archived` column and counted in its header count

#### Scenario: Ending the session lets it be hidden
- **WHEN** the user ends that session while **Hide merged** is on
- **THEN** once the board has the updated session list, `add-audit-log` is no longer shown in the `Archived` column and its header count drops by one

#### Scenario: Ended sessions keep nothing
- **WHEN** **Hide merged** is on and a merged archived change has only sessions that exited or failed
- **THEN** the change is not shown in the `Archived` column

#### Scenario: Session of another change
- **WHEN** **Hide merged** is on and a running session belongs to `add-audit-log` of `beta-soc`, while `alpha-infra` also has a merged archived change `add-audit-log`
- **THEN** only `beta-soc`'s change is kept; `alpha-infra`'s is hidden

### Requirement: Archived column is bounded
The `Archived` column SHALL be presented like every other column: always open, with the same width, header layout, repository grouping and cards, and with no collapse, expand or close control of its own. It SHALL show at most the 25 most recently archived changes sorted by archive date descending, among the archived changes the active filters allow — with **Hide merged** on, only pending ones. Its header count SHALL be the total number of archived changes matching the active filters, **Hide merged** included; when more than 25 match, the count SHALL read `25 of <total>`. The "hide archived" filter SHALL remain the way to remove the column from the board. This SHALL apply to the combined board and to repository boards alike. Where the column shows repository groups, those groups follow the minimizing rules for repository groups and are minimized by default; the bound of 25 SHALL be applied before grouping, so a group's count is the number of its changes within the bound. The number of changes shown in the filter bar SHALL count only the archived cards the column shows.

#### Scenario: Open by default
- **WHEN** the combined board loads with 96 archived changes, "hide archived" is off and **Hide merged** is off, for a user with no remembered choices
- **THEN** the `Archived` column is shown open like the other columns with a header count of `25 of 96`, and the 25 most recently archived changes are represented by minimized repository groups whose counts add up to 25

#### Scenario: Fewer archived changes than the bound
- **WHEN** a repository board has 7 archived changes and **Hide merged** is off
- **THEN** the `Archived` column shows all 7 cards, newest archive first, and the header count reads `7`

#### Scenario: Merged archives take no place in the bound
- **WHEN** 96 archived changes match the other filters, 3 of them pending and the 25 most recent all merged, and **Hide merged** is on
- **THEN** the `Archived` column shows the 3 pending changes, newest archive first, with a header count of `3`

#### Scenario: Only merged archives
- **WHEN** every archived change on the board is merged and **Hide merged** is on
- **THEN** the `Archived` column is still shown, empty, with a count of `0`, like any other empty column

#### Scenario: No collapse control
- **WHEN** the `Archived` column is shown
- **THEN** the column itself has no control to collapse, expand or close it, and clicking the column header does nothing

#### Scenario: Hidden by the filter
- **WHEN** the user enables "hide archived"
- **THEN** the `Archived` column is not shown, and it is still not shown after a page reload

### Requirement: Board refreshes from the snapshot
The board SHALL fetch `GET /api/state` on load, re-fetch on the poll interval, and provide a Refresh button that calls `POST /api/scan` and re-fetches when complete. The header SHALL show the snapshot's `generatedAt` and per-repo error indicators for repos with `ok: false`.

Beside the Refresh button the dashboard SHALL offer an auto-refresh control with exactly the choices `Off`, `2s`, `5s` and `10s`. While an interval is chosen, the dashboard SHALL repeat on that interval what the Refresh button does — trigger a scan and take the resulting snapshot — so that the data shown is re-read from the repositories and not merely the same snapshot fetched again. `Off` SHALL be the initial choice for a user who has never chosen one, and the control SHALL name the interval in force, so the user can always see whether the dashboard is refreshing itself.

The choice SHALL be remembered for the browser it was made in and SHALL survive a reload; it SHALL NOT be written to the dashboard's configuration, SHALL NOT change `pollIntervalSeconds`, and SHALL NOT be shared with another browser or machine. When the choice cannot be stored, it SHALL still apply for the current page session.

An automatic refresh SHALL NOT overlap another refresh: while a refresh is in flight, whether the user started it or the interval did, the due tick SHALL be dropped rather than queued, and the next tick SHALL be timed from the refresh that finished, so that an interval shorter than a scan cannot make scans pile up. While the page is hidden no tick SHALL run; the interval SHALL resume when the page becomes visible again. A failed automatic refresh SHALL be reported like a failed manual one and MUST NOT stop the interval. Auto-refresh SHALL drive nothing but the scan and the re-fetch: it MUST NOT trigger the pull action, which stays bound to the user's explicit request.

#### Scenario: Manual refresh
- **WHEN** the user clicks Refresh
- **THEN** a scan is triggered and the board updates with the new snapshot without a page reload

#### Scenario: Repo in error
- **WHEN** a tracked repo failed to scan
- **THEN** a warning indicator with the error message is visible in the header

#### Scenario: Auto-refresh is off until chosen
- **WHEN** the dashboard is opened by a user who has never used the auto-refresh control
- **THEN** the control shows `Off`, no scan is triggered by a timer, and the board still re-fetches the snapshot on the poll interval as before

#### Scenario: Choosing an interval
- **WHEN** the user chooses `5s`
- **THEN** about every five seconds a scan is triggered and the board and the `updated` age follow the new snapshot, without the user clicking anything

#### Scenario: The choice is remembered for this browser
- **WHEN** the user chooses `2s` and reloads the page
- **THEN** auto-refresh is still `2s`, and the dashboard's configured poll interval is unchanged

#### Scenario: Another browser is unaffected
- **WHEN** the user has chosen `2s` in one browser and opens the dashboard in a different browser
- **THEN** auto-refresh there is `Off`

#### Scenario: Turning it off
- **WHEN** auto-refresh is `10s` and the user chooses `Off`
- **THEN** no further scan is triggered by the timer, and Refresh still works

#### Scenario: A scan slower than the interval
- **WHEN** auto-refresh is `2s` and a scan takes six seconds
- **THEN** no second scan is started while the first is running, and the next one is timed from the first one finishing

#### Scenario: Refreshing by hand while auto-refresh runs
- **WHEN** the user clicks Refresh while an automatic refresh is in flight
- **THEN** no second concurrent scan is started, and the board still ends up on the newest snapshot

#### Scenario: Hidden tab
- **WHEN** auto-refresh is `2s` and the user switches to another tab for ten minutes
- **THEN** no scan is triggered while the page is hidden, and one refresh happens when the user comes back

#### Scenario: A failing scan does not stop the interval
- **WHEN** an automatic refresh fails
- **THEN** the error is shown in the header the same way a failed manual refresh is, and the next tick is still attempted

#### Scenario: Auto-refresh never pulls
- **WHEN** auto-refresh has been running at `2s` for an hour
- **THEN** no repository has been fetched from or merged, because only a scan was triggered

### Requirement: Status labels use a semantic colour palette
Every status label the board paints in a colour SHALL draw that colour from a fixed set of semantic roles, and each role SHALL
mean one thing across the whole UI. The roles are `info` (blue), `branch` (orange), `success`, `warning`, `danger` and
`neutral`. Each role SHALL be defined as theme tokens for its text, its border and a soft background in both themes: a
label in a role SHALL be drawn on that role's soft background (a translucent tint of the role), so the role reads as a
filled chip. The `neutral` role keeps the badge's own background. Component styles MUST reference those tokens
rather than literal colours or the brand accent.

Labels SHALL use the roles as follows:

- `info` — something in flight: an agent session that is running, including its `quiet` state, and outside the board an
  action that is planned but not yet applied. On a card no label other than a running session's SHALL use it, so that
  on the board blue means exactly "an agent is up".
- `branch` — anything naming a working copy that is not merged yet: the branch badge on the change detail view and
  in the repository board header, and the `uncommitted`, `unpushed` and `pushed` work-status badges.
- `success` — a complete change and `merged` work.
- `warning` — a condition the user should look at but that is not an error: a missing tasks file, an archive the main
  checkout does not have yet.
- `danger` — a failed or erroring session, a scan warning, and uncommitted or unpushed work that has gone stale.
  Stale `pushed` work stays `warning`: a pushed branch may simply be waiting for review.
- `neutral` — labels that carry no status: the activity age, the `prompt` note, the column a change sits in, and
  markers such as which agent profile is the default.

A repository's labels (project-labels) are groupings, not status labels, and take no role: wherever they are shown,
including the repository board header, each is painted in its label colour, whose hue is drawn from the same assignable
hues as repository colours and therefore keeps at least 12° from every role hue and from the brand accent.

The brand accent SHALL NOT be the colour of any status label; it stays reserved for focus, active state, primary
actions and progress. Colour MUST NOT be the only cue: every label SHALL keep its text, and its role MUST NOT change
what it says. Every role's text SHALL keep a contrast ratio of at least 4.5:1 against the card and panel backgrounds in
both themes, and so SHALL it against the role's soft background laid over those backgrounds.

#### Scenario: A live agent is blue
- **WHEN** a card's change has a running session that printed something within the last minute
- **THEN** its badge reads `running` in the `info` role, and no other label on that card uses `info`

#### Scenario: A quiet session keeps the live role
- **WHEN** a running session's terminal has printed nothing for more than a minute
- **THEN** its badge reads `quiet <duration>` in the `info` role, without motion

#### Scenario: Branch and uncommitted work share the orange role
- **WHEN** a change's detail view shows the branch badge `feat/add-login` and its worktree holds 3 uncommitted files
- **THEN** both labels are painted in the `branch` role, and both still read their own text

#### Scenario: The brand accent is not a status
- **WHEN** any card on the board is rendered in either theme
- **THEN** none of its labels uses the brand accent colour, while focus rings, primary buttons and the progress bar still do

#### Scenario: Stale open work escalates
- **WHEN** a worktree has had unpushed commits for two days and no session is running
- **THEN** its badge is painted in the `danger` role and still says how long it has been untouched

#### Scenario: A stale pushed branch is only a warning
- **WHEN** a worktree's branch has been pushed and untouched for eight days and no session is running
- **THEN** its badge is painted in the `warning` role, not `danger`

#### Scenario: Repository labels take no role
- **WHEN** a repository board header shows the repository's labels `client` and `terraform`
- **THEN** neither chip is painted in a status role or the brand accent, and each keeps its label colour

#### Scenario: Roles are legible in both themes
- **WHEN** the theme is switched between dark and light
- **THEN** each role's text keeps a contrast ratio of at least 4.5:1 against the badge's own ground and against the card it sits in

### Requirement: Cards are grouped by repository within each column
Within every column, including the expanded `Archived` column, the board SHALL group cards by repository: all cards of one repository SHALL be adjacent, under a group header showing the repository name and the number of cards in that group. Groups SHALL be ordered by repository name, case-insensitively, and the order SHALL be the same in every column. Within a group, cards SHALL keep the order they would have had without grouping. A repository with no visible cards in a column SHALL NOT produce a group there. Column counts SHALL remain the total number of cards in the column. Grouping SHALL be applied after filtering, and in the `Archived` column after selecting the most recently archived changes, so it never changes which cards are shown.

#### Scenario: Two repositories in one column
- **WHEN** the `Implementing` column contains changes `a1` and `a2` from repository `alpha` and `b1` from repository `beta`, scanned in the order `a1`, `b1`, `a2`
- **THEN** the column shows a group `alpha` with count `2` containing `a1` then `a2`, followed by a group `beta` with count `1` containing `b1`, and the column count is `3`

#### Scenario: Same group order across columns
- **WHEN** repositories `zeta` and `Alpha` both have cards in `Drafts` and in `Done`
- **THEN** the `Alpha` group is above the `zeta` group in both columns

#### Scenario: No empty groups
- **WHEN** repository `beta` has no cards in the `Ready` column
- **THEN** the `Ready` column shows no `beta` group header

#### Scenario: Filtered-out repository
- **WHEN** the repository filter selects only `alpha`
- **THEN** every column shows at most one group, `alpha`, and its header count equals the number of visible `alpha` cards in that column

#### Scenario: Archived column keeps its bound
- **WHEN** 96 changes are archived across repositories and the `Archived` column is expanded
- **THEN** the 25 most recently archived changes are shown, grouped by repository, with each group's cards in archive-date descending order, and the column header still reports the total of `96`

### Requirement: Each repository has its own stable colour
The board SHALL assign every repository in the snapshot a colour derived deterministically from its repository id, without any configuration. The assignment SHALL be computed over all repositories in the snapshot, independent of the active filters, so that the same set of tracked repositories always yields the same colours across reloads, scans and filter changes. Repositories tracked at the same time SHALL receive distinct colours for up to 19 repositories. The colours a repository can be assigned SHALL exclude the hues the status roles and the brand accent own: every assignable repository hue SHALL differ from every one of those hues by at least 12°, so a repository is never shown in a colour that means "running", "uncommitted", "complete", "needs attention", "error" or "console". The repository colour SHALL be shown on the repository's group header, which encloses its cards, on its entry in the repository filter menu and on its active-filter tag, and on each entry of the Open work list — as an accent on the entry and on the repository name it shows. An entry whose repository is not in the current snapshot SHALL be shown without a repository colour. The repository colour on an entry MUST NOT replace or obscure its live session badge, which SHALL stay distinguishable from every assignable repository colour. The colour SHALL adapt to the active theme so that repository-coloured text keeps a contrast ratio of at least 4.5:1 against its background in every supported theme, including the background of the Open work list. Colour MUST NOT be the only cue: wherever a repository colour is shown, the repository name SHALL be shown with it. The error styling of a repository's filter menu entry SHALL take precedence over its repository colour.

#### Scenario: Distinct colours
- **WHEN** 17 repositories are tracked
- **THEN** no two of them have the same colour

#### Scenario: Stable across reload and rescan
- **WHEN** the page is reloaded or a scan completes and the set of tracked repositories is unchanged
- **THEN** every repository has the same colour as before

#### Scenario: Filters do not change colours
- **WHEN** the user filters the board to repository `vcs-admin` only
- **THEN** `vcs-admin` group headers, filter menu entry and active-filter tag keep the colour they had with no filter applied

#### Scenario: Colour is consistent across the board
- **WHEN** repository `beta-soc` has cards in three columns
- **THEN** its group headers, around all of its cards, and its filter menu entry all use the same colour, each alongside the name `beta-soc`

#### Scenario: Open work entries carry the repository colour
- **WHEN** the Open work list holds entries for sessions of `beta-soc` and of `alpha-infra`
- **THEN** each entry shows its repository's accent and its repository name in that repository's colour, the same colour that repository's group headers use, and both entries still show the repository name as text

#### Scenario: Filtering the board does not recolour an entry
- **WHEN** the user filters the board to `alpha-infra` only while a `beta-soc` session is in the Open work list
- **THEN** the `beta-soc` entry keeps the colour it had with no filter applied

#### Scenario: The live badge survives the tint
- **WHEN** a tinted Open work entry is for a running session and carries its live badge
- **THEN** the badge stays distinguishable from the repository colour and still reads as text

#### Scenario: Session of an untracked repository
- **WHEN** a session's repository is switched off in Settings while its entry is in the Open work list
- **THEN** that entry is shown without a repository colour and stays readable

#### Scenario: Theme change
- **WHEN** the user switches from the dark to the light theme
- **THEN** each repository keeps the same hue, and repository-coloured text remains legible (contrast ≥ 4.5:1) on the light backgrounds, on the board and in the Open work list

#### Scenario: Repository in error
- **WHEN** a tracked repository failed to scan
- **THEN** its entry in the repository filter menu shows the error styling rather than its repository colour

#### Scenario: No repository wears a status colour
- **WHEN** 19 repositories are tracked
- **THEN** every assigned hue is at least 12° away from each of the status role hues, from the brand accent and from the console accent

### Requirement: Repository groups are visually distinct
On a board showing more than one repository, each repository group SHALL be rendered as an enclosing panel that contains its group header and all of its cards. The panel SHALL have a background that differs from the column background and is tinted with the repository's colour, and a border in the same tint. The repository name in the group header SHALL be rendered in bold. The vertical distance between two adjacent groups SHALL be larger than the distance between two adjacent cards within a group. Cards SHALL remain visually distinguishable from the panel they sit on. The panel tint SHALL be derived from the repository colour and theme tokens so that it adapts to every supported theme, and repository-coloured text shown on the panel SHALL keep a contrast ratio of at least 4.5:1 against the panel background in every supported theme.

#### Scenario: Bold group name
- **WHEN** a column shows groups for `alpha` and `beta`
- **THEN** both repository names in the group headers are rendered with a bold font weight

#### Scenario: Group is an enclosed, tinted panel
- **WHEN** repository `beta-soc` has two cards in the `Ready` column
- **THEN** its header and both cards sit inside one panel whose background is a tint of the `beta-soc` colour and differs from the column background

#### Scenario: Groups are further apart than cards
- **WHEN** a column shows group `alpha` with two cards followed by group `beta`
- **THEN** the gap between the `alpha` panel and the `beta` panel is larger than the gap between the two `alpha` cards

#### Scenario: Works in both themes
- **WHEN** the user switches between the dark and the light theme
- **THEN** the panels stay tinted with their repository colour relative to that theme's column background, and the repository name keeps at least 4.5:1 contrast against the panel for every assignable repository colour

#### Scenario: Single-repository board is unchanged
- **WHEN** the board shows only one repository and cards render without group headers
- **THEN** no group panel is drawn

### Requirement: Repository groups can be minimized
On a board that shows repository groups, every group SHALL offer a control on its header to minimize and expand it. A minimized group SHALL show only its header — the repository colour and name and the number of cards in the group — and none of its cards; an expanded group SHALL show its cards as before. The control SHALL be operable by pointer and keyboard and SHALL expose its expanded or minimized state to assistive technology. The state SHALL be held per group, that is per repository and column: changing one group MUST NOT change the same repository's group in another column.

Groups in the `Archived` column SHALL be minimized by default; groups in every other column SHALL be expanded by default. A state the user has chosen explicitly SHALL be remembered in the browser and SHALL survive page reloads, scans and filter changes; repositories and columns without an explicit choice SHALL use the default. If the remembered state cannot be read or written, the board SHALL fall back to the defaults and remain fully usable.

Minimizing MUST NOT change which cards match the active filters or any count: the group header count and the column header count SHALL include the cards of minimized groups. While a text search is active, every group shown SHALL be presented expanded regardless of its remembered state, the control SHALL NOT change the remembered state, and clearing the search SHALL restore the previous presentation. Boards that render cards without group headers (single-repository boards) are unaffected.

#### Scenario: Minimize a group
- **WHEN** the `Implementing` column shows group `alpha` with 3 cards and the user activates the control on its header
- **THEN** the group shows only its header with the name `alpha` and the count `3`, none of its cards are shown, and the `Implementing` column count is unchanged

#### Scenario: Expand again
- **WHEN** the user activates the control on the minimized `alpha` group
- **THEN** its 3 cards are shown again in their previous order

#### Scenario: State is per column
- **WHEN** the user minimizes `alpha` in `Implementing` and `alpha` also has a group in `Ready`
- **THEN** the `alpha` group in `Ready` stays expanded

#### Scenario: Archived groups start minimized
- **WHEN** the combined board loads for a user with no remembered choices and the `Archived` column contains groups `alpha` (4) and `beta` (2)
- **THEN** both groups are shown minimized with their counts, and the groups in all other columns are shown expanded

#### Scenario: Choice is remembered
- **WHEN** the user expands `alpha` in `Archived`, minimizes `beta` in `Ready`, and reloads the page
- **THEN** `alpha` in `Archived` is expanded, `beta` in `Ready` is minimized, and all other groups use their defaults

#### Scenario: New repository gets the defaults
- **WHEN** a repository is tracked for the first time after the user has made choices for other repositories
- **THEN** its groups are minimized in `Archived` and expanded elsewhere

#### Scenario: Search shows matches inside minimized groups
- **WHEN** `alpha` in `Archived` is minimized and the user searches for the name of one of its archived changes
- **THEN** the matching card is shown in an expanded `alpha` group, and after the search is cleared `alpha` in `Archived` is minimized again

#### Scenario: Keyboard and assistive technology
- **WHEN** the user focuses a group header control with the keyboard and presses Enter or Space
- **THEN** the group toggles, and the control reports whether the group is expanded

#### Scenario: Storage unavailable
- **WHEN** the browser refuses access to local storage
- **THEN** the board shows the default states, toggling still works for the current page, and no error is shown

### Requirement: Cards offer session starters and show session state
When agent sessions are enabled and the card's repository is tracked and not excluded, a card SHALL offer the session starters available for its change in its footer as one split button ("A change's actions are one split button") — its recommended action in the main part and every other available action in its menu, none for archived changes — limited to the starters the repository's agent has a prompt for, and disabled with an explanation when that agent's executable is not found.

A card whose change is in `Ready` or `Implementing` and is **blocked** by its dependencies (change-dependencies) SHALL NOT offer **Implement**; in its place it SHALL show a "waits for" note naming the change's dependencies that are not `met` — the first by name and the number of others (e.g. `waits for add-billing-api +1`), or saying that its `depends-on.yaml` could not be read — whose tooltip and accessible name list every such dependency with its state. The note SHALL NOT be a control and SHALL NOT start anything; **Show details** stays beside it. The note SHALL be shown whether or not agent sessions are enabled, since it states an order rather than a session. A blocked change in any other column SHALL show no note on its card; its detail view says what it waits for. Blocking SHALL NOT move a card, change its progress bar or hide it from any filter.

While any session of the card's change is running, the card SHALL show that session's badge **in the place the starters occupy** and SHALL offer no starter at all. The badge SHALL read the running state the terminal can tell — that the agent is working, or that it may need the user with how long the terminal has been silent — and the starters SHALL stay hidden for every one of those states, so no button appears or vanishes as a terminal falls silent. Activating the badge SHALL open that change's detail view with its Console tab selected and that session shown.

A card whose latest session failed to start or ended with an error SHALL show that badge and SHALL still offer the starters its change's stage allows, so the next attempt stays one activation away. A card MUST NOT offer a control that ends a session. Status MUST be conveyed by text as well as colour. **Show details** remains available. When agent sessions are disabled or the repository is excluded, cards MUST look and behave exactly as before, apart from the "waits for" note.

#### Scenario: Done change offers Archive
- **WHEN** a change is in `Done` and agent sessions are enabled
- **THEN** the card offers **Archive** in its footer

#### Scenario: Ready change
- **WHEN** a change is in `Ready`, agent sessions are enabled and its repository is not excluded
- **THEN** the card offers **Implement** and still offers **Show details**

#### Scenario: Running session
- **WHEN** a change has a running session whose terminal is printing
- **THEN** its card shows the `working` badge where the **Implement** button was, offers no starter and no control that ends the session, and activating the badge opens that change's detail view on its Console tab

#### Scenario: Silent session shows the same badge and no starter
- **WHEN** that session's terminal has printed nothing for 45 seconds
- **THEN** the card's badge says the agent may need the user, and the card still offers no starter

#### Scenario: Failed session keeps its starter
- **WHEN** a change's latest session failed to start and no session of that change is running
- **THEN** its card shows the failure badge and the starter for its stage beside it

#### Scenario: Feature off
- **WHEN** agent sessions are disabled
- **THEN** no card shows a starter, a session badge or a console link

#### Scenario: Blocked card waits instead of offering Implement
- **WHEN** a change in `Ready` depends on `add-billing-api` (`waiting`) and `add-billing-scheme` (`missing`), and agent sessions are enabled
- **THEN** its footer shows `waits for add-billing-api +1` beside **Show details** and no **Implement**, and the note's tooltip lists `add-billing-api — waiting` and `add-billing-scheme — missing`

#### Scenario: Waiting is shown without agent sessions
- **WHEN** agent sessions are disabled and a change in `Ready` is blocked
- **THEN** its card shows the "waits for" note and no starter

#### Scenario: Drafting card is unchanged
- **WHEN** a blocked change is in `Drafts` and agent sessions are enabled
- **THEN** its card offers **Draft artifacts** as before and shows no "waits for" note

#### Scenario: Running session takes precedence
- **WHEN** a blocked change in `Implementing` has a running session
- **THEN** its card shows that session's badge, as for any running session, and no "waits for" note

#### Scenario: Ready change with an optional artifact missing
- **WHEN** a change is in `Ready`, its optional `design.md` is not written, and agent sessions are enabled
- **THEN** its card's split button shows **Implement**, with **Draft artifacts** in its menu

### Requirement: Open work lists running sessions and unshipped work
While agent sessions are enabled the top bar SHALL show an "Open work" control. Now that each terminal lives in its
change's detail view, this list is the only view of agent activity that spans repositories, so it SHALL cover both the
agents running and the work they left behind.

Its count SHALL be the number of running sessions plus the number of worktrees that hold unshipped work with no session
running; it SHALL be hidden only when there is neither of those and no merged worktree either. Opening it SHALL list,
across all repositories, first every running session — oldest first — each with repository, change, the session's
action, agent, branch, its live session badge, the work-status badge of its worktree when there is one, and how long
ago it started; and then every worktree whose work is `uncommitted`, `unpushed`, `pushed` or `merged` and whose session
is not running, stale ones first and merged ones last, each with repository, change, branch, status and age.

Sessions SHALL be listed by session and not by worktree, so that a session running in place — in a tracked folder that
is not a git repository, which has no worktree — is listed like any other. A worktree SHALL be listed at most once, and
a running session's own worktree SHALL count as that session rather than a second time as unshipped.

Worktrees without a session record, and worktrees of archived or vanished changes, SHALL be listed: no card offers
them, and this list is the only way to reach them. An entry with a session SHALL open its change's
detail view on the Console tab with that session shown, and close the list; an entry without one SHALL offer copying a
`cd` command and, after confirmation, removal when that is safe. The list SHALL update as sessions start and end,
without a reload.

#### Scenario: Running sessions are listed first
- **WHEN** five sessions are running and two worktrees hold unpushed work with no session
- **THEN** the control shows the count 7 and the list has the five running sessions first, oldest first, each with its
  action, agent and live badge, and the two worktrees after them

#### Scenario: A session running in place
- **WHEN** a session runs in a tracked folder that is not a git repository, so it has no worktree
- **THEN** it is listed with its repository, change and live badge like any other running session

#### Scenario: Opening a running session
- **WHEN** the user activates a running session's entry
- **THEN** that change's detail view opens on its Console tab with that session's terminal and its earlier output, and
  the list closes

#### Scenario: A worktree counted once
- **WHEN** a running session's own worktree holds three uncommitted files
- **THEN** it appears once, as that running session, and the count does not also count it as unshipped

#### Scenario: Stale worktrees are listed first
- **WHEN** a worktree has had unpushed commits for two days and no session runs in it
- **THEN** it is listed first among the work left behind — after every running session, before the unshipped worktrees
  that are not stale and before the merged ones — with its age and its staleness stated as text

#### Scenario: A session that ends leaves the running rows
- **WHEN** the list shows a running session and that session's agent exits with unpushed commits in its worktree
- **THEN** the entry leaves the running rows and its worktree takes a place among the work left behind, so the count
  does not drop, and the change's detail header still shows the worktree's work-status badge

#### Scenario: Archive worktree of an archived change
- **WHEN** the archive worktree of a change that is already archived holds a commit that is not pushed
- **THEN** it appears in the Open work list although no card offers it, and opening it shows its Console tab

#### Scenario: Nothing open
- **WHEN** no session runs and no session worktree holds anything
- **THEN** the top bar shows no Open work control

### Requirement: The running session badge shows activity through motion
The session badge of a running session whose terminal is producing output — the badge that reads `working` — SHALL be animated wherever it is shown (cards, the Open work list and the Console tab): its dot pulses and a lighter colour sweeps across its label, in a loop of about two seconds that never hides the label or reduces its contrast below that of the static badge. The card of a change whose session badge is in that same state SHALL also show it as a whole: the card's background and edge SHALL take a soft tint of the `info` role, and a band in the `info` colour SHALL sweep across the change name in the same loop, never hiding the name, and the name SHALL keep a contrast ratio of at least 4.5:1 against the tinted background at every point of the sweep. The tint SHALL change the background's hue, not its lightness, so that every role's text keeps its contrast ratio of at least 4.5:1 against the role's soft background laid over the tinted card in both themes; hovering a tinted card SHALL give it the usual hover edge and lift but keep the tint. The `may need you`, ended and failed badges, work-status badges and every other badge MUST NOT be animated, and a card whose change has no session in that state — including every card of a repository with agent sessions disabled — MUST NOT be tinted and its name MUST NOT be animated, so that motion means exactly "an agent is working now". The animation and the tint MUST be decorative only: the badge still reads `working`, the name still reads the change name, the dot is hidden from assistive technology, and status remains conveyed by text as well as colour. When the user prefers reduced motion (`prefers-reduced-motion: reduce`) the badge and the name MUST be static and look as they did without this requirement; the card's tint SHALL remain, as it is not motion. Colours MUST come from the theme tokens so that both themes apply.

#### Scenario: Running
- **WHEN** a change has a running session that printed something within the last 20 seconds
- **THEN** its badge reads `working`, its dot pulses and a colour sweeps across the label

#### Scenario: The working card stands out
- **WHEN** a card's change has a session whose badge reads `working`
- **THEN** the card's background and edge are tinted in the `info` role and a colour sweeps across the change name, which still reads in full

#### Scenario: An idle card stays plain
- **WHEN** a card's change has no session, or only an ended or failed one
- **THEN** the card has its usual background and edge and its name is not animated

#### Scenario: Quiet session is still
- **WHEN** a running session has been silent for longer than 20 seconds and its badge reads `may need you`
- **THEN** neither that badge nor the card's name is animated, and the card is not tinted

#### Scenario: Reduced motion
- **WHEN** the user's system asks for reduced motion and a card's change has a session whose badge reads `working`
- **THEN** the badge and the change name are static, the badge still reads `working`, and the card keeps its tint

### Requirement: The end-session dialog is graded by work status
Ending a session SHALL be offered from the Console tab and nowhere else, and SHALL go through one dialog that reads the worktree's work status fresh and grades its warning: a plain confirmation for `clean`, `merged` or `missing`; a notice for `pushed` that the work is not merged as of the last fetch; and for `uncommitted` or `unpushed` a strong warning, as text plus colour, naming the number of files or commits that exist only in this worktree, with **Ship instead** offered and the confirming button labelled **End anyway**. The dialog MUST state that the worktree and branch are kept, and SHALL offer worktree removal only when that is safe. Cancelling MUST change nothing.

#### Scenario: Unshipped work
- **WHEN** the user ends a session whose worktree holds 3 uncommitted files
- **THEN** the dialog warns that 3 files exist only in this worktree, offers Ship instead, and ends the session only on **End anyway**

#### Scenario: Nothing unshipped
- **WHEN** the user ends a session whose worktree is `clean`
- **THEN** the dialog asks for a plain confirmation

#### Scenario: The board does not end sessions
- **WHEN** a session is running and the user looks for a way to end it on the board
- **THEN** no card offers one, and the way to it is the change's Console tab

### Requirement: Cards offer Show details
Each card SHALL offer a **Show details** action that opens its change's detail view, carrying the board it sits on and that board's filters so the detail view can lead back to them. The action SHALL be a link: opening it in a new tab or window SHALL land on the same detail view, and activating it with the keyboard SHALL open the detail view in the current tab.

**Show details** SHALL be the only part of a card that navigates to the detail view, apart from the **Console** quick link and the session badge. Whenever agent sessions apply to the card's repository — agent sessions on and the repository not excluded — the card SHALL show the console quick link in its top right corner, whether or not the change has a session or a session worktree, so the way into a change's terminal is always in the same place; it SHALL open the change's detail view directly on its Console tab, carrying the board like **Show details** does. The quick link is an icon; its tooltip and accessible name SHALL say that it opens the agent console of the named change. When agent sessions do not apply to the repository the card SHALL show no console quick link. The card as a whole MUST NOT be a link, and the change name MUST NOT be one; clicking a card's background, its badges or its progress bar MUST NOT navigate anywhere. The session starters keep their own behaviour.

#### Scenario: Opening a change
- **WHEN** the user activates **Show details** on the card of change `multi-tenant-sync`
- **THEN** the detail view of `multi-tenant-sync` is shown

#### Scenario: Card background does not navigate
- **WHEN** the user clicks the card's background, its change name, its progress bar or its age badge
- **THEN** nothing is opened and the board stays as it is

#### Scenario: New tab
- **WHEN** the user middle-clicks or ⌘-clicks **Show details**
- **THEN** a new tab opens on that change's detail view

#### Scenario: Keyboard
- **WHEN** the user tabs to a card and presses Enter
- **THEN** the detail view for that change is shown

#### Scenario: Console quick link
- **WHEN** the change `multi-tenant-sync` has a running session and the user activates the console link on its card
- **THEN** the detail view of `multi-tenant-sync` opens on its Console tab, and closing it returns to the board with its filters

#### Scenario: The link is there before any session
- **WHEN** a change in a repository with agent sessions enabled has neither a session nor a session worktree
- **THEN** its card still shows the console quick link at the top right, in the same place as every other card's, and activating it opens that change's Console tab

#### Scenario: No console, no link
- **WHEN** agent sessions are disabled, or the card's repository is excluded from them
- **THEN** its card shows no console quick link

### Requirement: Cards show only what an overview needs
A card SHALL show only what an overview needs: the change name in monospace, the relative age of `lastActivityAt` under it (e.g. `updated 3d ago`, or the archive date for an archived change), a progress bar, a console quick link in the card's top right corner, and a footer carrying the change's session status and next-step starter as the "Cards offer session starters and show session state" requirement gives them, together with **Show details**.

The change name and its age SHALL have the top of the card to themselves apart from the console quick link, which SHALL occupy a slot of its own at the top right: the name SHALL wrap within the width that slot leaves and SHALL never be shortened or pushed by a badge. A card SHALL NOT show a separate session-status line between the age and the progress bar: the session status sits in the footer, so a card goes from its age straight to its progress bar whether or not it has a session. **Show details** SHALL have the same height and text size as the next-step starter button in the footer, so the two sit on the footer's line as a pair; at rest it keeps its quieter look than the starter. The progress bar SHALL be, for a change in `Drafts`, the drafting progress: the number of the change's artifacts that are done out of all of its schema's artifacts, labelled `done/total Artifacts`, with a tooltip and accessible name that say it counts artifacts (e.g. `2 of 4 artifacts written`); for any other change with tasks (`tasks.total > 0`), the task progress labelled `done/total Tasks`, with a tooltip and accessible name that say it counts tasks. Both bars SHALL share one shape and style; the word after the count is what tells them apart at a glance. A card in `Backlog`, and a card outside `Drafts` without tasks, SHALL show no progress bar. A card SHALL additionally show the `no tasks` warning and an error mark for any other warning the snapshot carries. A card SHALL NOT show the repository name — on the combined board every card sits in its repository's group, whose header names it, and a repository board names it in its header — nor the branch badge, the checkouts holding the change, the worktree's work status, the prompt, how long the change has been complete, whether its specs are synced, or which artifacts are written: the change's detail view shows those (change-detail: "Detail header shows the change's state"), and the column and the progress bar say how far the change has come.

The branch badge in the repository board header MUST NOT extend beyond its container at any width. A branch name that fits SHALL be shown in full; one that does not SHALL be shortened in the middle with an ellipsis so that both its beginning and its end remain readable, with the branch glyph visible and the full name as its tooltip and accessible name.

#### Scenario: Card content
- **WHEN** a change `cloud-deployment` in repo `demo-ops` has `tasks 30/30`, last activity 12 days ago and a branch match `feat/cloud-deployment`, and is shown on the combined board
- **THEN** the card sits in the `demo-ops` group and shows `cloud-deployment`, `updated 12d ago`, a full progress bar labelled `30/30 Tasks` and **Show details**, and shows neither `demo-ops`, the branch, nor a completion badge

#### Scenario: Drafting progress
- **WHEN** a `spec-driven` change has `proposal` and `design` done and `specs` and `tasks` not done
- **THEN** its card in `Drafts` shows a progress bar half filled and labelled `2/4 Artifacts`, whose tooltip and accessible name read `2 of 4 artifacts written`

#### Scenario: Drafting progress for another schema
- **WHEN** a change of a schema with the artifacts `brief`, `plan`, `checklist` has `brief` done
- **THEN** its card in `Drafts` shows a drafting progress bar labelled `1/3 Artifacts`

#### Scenario: Backlog card has no bar
- **WHEN** a change in `Backlog` has a `tasks.md` that is not written yet
- **THEN** its card shows no progress bar

#### Scenario: Task progress replaces drafting progress
- **WHEN** a change moves from `Drafts` to `Ready` with `tasks` `done: 0, total: 12`
- **THEN** its card shows the task progress bar labelled `0/12 Tasks`

#### Scenario: Card with a running session
- **WHEN** a change in `Implementing` has a session whose agent is waiting for the user
- **THEN** its card shows the change name and its age, under them the task progress, and in its footer the session's status in the starter's place beside **Show details**

#### Scenario: The console slot does not squeeze the name
- **WHEN** the change `introduce-tenant-quota-enforcement` has a running session and its name fits the width the console slot leaves
- **THEN** its card shows the whole name on one line, with the console quick link at the top right and no badge beside the name

#### Scenario: The age is followed by the progress bar
- **WHEN** a change has neither a session nor a session worktree
- **THEN** its card goes straight from the age to the progress bar, with no status line and no space for one

#### Scenario: Show details matches the starter
- **WHEN** a card in `Ready` offers **▶ Implement** and **Show details** in its footer
- **THEN** both are drawn with the same height and the same text size

#### Scenario: Details live in the detail view
- **WHEN** a change has a `prompt.md`, a worktree with uncommitted files and all of its artifacts written
- **THEN** its card shows none of these, and its detail view shows the prompt, the work status and each artifact's state

#### Scenario: Long branch name in the repository header
- **WHEN** the repository board's current branch is `feat/introduce-tenant-quota-enforcement` and it does not fit
- **THEN** its badge shows the beginning, an ellipsis and `quota-enforcement`, stays inside the header, and presents the full name on hover and to a screen reader

#### Scenario: Awaiting validation
- **WHEN** a change in `Done` has `tasks` `done: 13, awaiting: 2, total: 15`
- **THEN** its card shows a **Validate** badge and a progress bar labelled `13 + 2 awaiting / 15 Tasks`, whose accessible name says thirteen tasks are done, two await validation and none are open

#### Scenario: Awaiting segment is not the only cue
- **WHEN** a screen reader reads a card awaiting validation
- **THEN** it reads the **Validate** badge and a progress label naming the awaiting count, without relying on the segment's colour

#### Scenario: No awaiting tasks
- **WHEN** a change has `tasks` `done: 4, awaiting: 0, total: 12`
- **THEN** its card shows no **Validate** badge and a two-part bar labelled `4/12 Tasks`

### Requirement: Visual design follows the grey and indigo token set
The UI SHALL define its colours as two token sets sharing the same token names: a dark set (neutral dark grey backgrounds ascending from `#26272b` for the page to `#4b4c51` for the most elevated surface, light enough that the edges between surfaces and every border stay visible; indigo brand `#6366f1`) and a light set (slate backgrounds from `#f8fafc`, with white raised surfaces, indigo brand `#4f46e5`). In the dark theme the background tokens SHALL be near-neutral greys, in the light theme slate greys with at most a slight cool tint; the indigo brand SHALL be used only as an accent (focus, active state, primary actions, progress) and MUST NOT be the resting colour of panel or card borders, nor the colour of any status label; highlighting the border of the card or control under the pointer is an active state and MAY use it. Borders SHALL be neutral: translucent white in the dark theme and translucent slate in the light theme. Both themes SHALL share Inter for text, JetBrains Mono for identifiers, one radius scale (small controls, fields and cards, panels and columns — rounder the larger the element) and one set of shadow tokens, with fonts bundled locally. Component styles MUST reference colour, radius and shadow tokens only and MUST NOT contain literal colour values. In both themes, text and status colours SHALL have a contrast ratio of at least 4.5:1 against the backgrounds they are rendered on, and so SHALL the text of a filled primary button against that button. The token set SHALL keep the status roles, the brand accent and the repository colours in three disjoint colour ranges, so that no status label can be mistaken for a repository accent or for the accent, and no repository can be shown in a colour that means a status. The UI MUST render correctly without network access, and any icon SHALL be drawn from inline markup, be decorative only, and sit beside text that says the same thing — with one exception, the card's console quick link, whose icon carries its meaning in a tooltip and an accessible name.

#### Scenario: Offline rendering
- **WHEN** the dashboard is opened with no network connectivity
- **THEN** fonts, icons and styles render as designed in the active theme with no external requests

#### Scenario: Same layout in both themes
- **WHEN** the theme is switched between dark and light
- **THEN** only colours and shadows change; layout, spacing, typography and radius are identical

#### Scenario: Status badges readable in light theme
- **WHEN** the light theme is active and a card shows success, warning and danger badges
- **THEN** each badge's text has a contrast ratio of at least 4.5:1 against the card background and is still accompanied by a text label

#### Scenario: Dark ground is a neutral grey, not near-black
- **WHEN** the dark theme is active
- **THEN** the page, column, card and panel backgrounds are greys whose red, green and blue channels differ by no more than 6 of 255, the page background is lighter than `#1a1b1e` and darker than `#2a2b2f`, and panel and card borders are neutral rather than indigo

#### Scenario: Borders are visible
- **WHEN** a column or card is rendered in either theme
- **THEN** its border has a contrast ratio of at least 1.3:1 against the ground it edges

#### Scenario: Subtle text readable on dark cards
- **WHEN** the dark theme is active and a card shows heading, body and subtle text
- **THEN** each has a contrast ratio of at least 4.5:1 against the card background

#### Scenario: Status text readable on dark cards
- **WHEN** the dark theme is active and a card shows success, warning and danger badges
- **THEN** each badge's text has a contrast ratio of at least 4.5:1 against the card background

#### Scenario: Primary button is readable
- **WHEN** the **New change** primary button is rendered in either theme
- **THEN** its label has a contrast ratio of at least 4.5:1 against the button's filled background

#### Scenario: Status, brand and repository colours do not overlap
- **WHEN** the colours a repository can be assigned are compared with the status roles and the brand accent
- **THEN** none of them coincides, in either theme, and the `info` role's hue is at least 24° away from the brand accent's

#### Scenario: Icons are never the only cue
- **WHEN** a control or label shows an icon, such as the search field, the New change button or the theme control
- **THEN** the icon is hidden from assistive technology and the control still carries its text or accessible name

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

### Requirement: Column headers mark the lifecycle stage
Every column header SHALL show a small lifecycle marker before the column name, followed by the name and the column count in a pill. The marker's colour SHALL mean the kind of column: neutral for `Backlog` and `Drafts`, the brand accent for `Ready` and `Implementing`, the `success` role for `Done`, a muted neutral for `Archived`, and the `warning` role for `Unknown`. The marker SHALL be decorative only and hidden from assistive technology: the column name SHALL remain the cue. The existing highlighting of the `Done` count and the `Archived` column's `25 of <total>` count SHALL be kept. Each lifecycle column's name SHALL carry a tooltip saying what it holds.

#### Scenario: Markers along the lifecycle
- **WHEN** the board shows the columns `Backlog`, `Drafts`, `Ready`, `Implementing`, `Done`, `Archived`
- **THEN** `Backlog` and `Drafts` carry a neutral marker, `Ready` and `Implementing` an accent marker, `Done` a success marker, and `Archived` a muted one

#### Scenario: Column hints
- **WHEN** the user hovers the `Drafts` column name
- **THEN** a tooltip says that the column holds changes with some but not all artifacts written

#### Scenario: Marker is not the only cue
- **WHEN** a screen reader reads a column header
- **THEN** it reads the column name and count and nothing for the marker

### Requirement: The board's filters form one filter bar
The board's filters SHALL be presented as one filter bar below the header band, with the same filters and URL persistence as before: a search field with a leading search icon and, while it holds text, a control that clears it; on the combined board a **Repositories** menu button that shows how many repositories are selected (or `All`) and opens a list of every repository with a checkbox, its colour and name, and its error styling when its last scan failed; an **Activity** selector offering `Any time` and `Last 7 days`, `Last 14 days`, `Last 30 days` and `Last 90 days`, which also offers the current threshold when the URL holds another value, kept in the URL as `active=<days>`; a former `stale=<days>` parameter SHALL be ignored, so the selector shows `Any time`; a **Hide archived** switch; directly after it a **Hide merged** switch, on by default, disabled while **Hide archived** is on, with a tooltip explaining that it hides archived changes whose archive has reached the main checkout and that a change with a running agent session stays shown until that session is ended; and **Clear filters** while any filter is active. **Hide merged** SHALL count as an active filter only while it is off, and **Clear filters** SHALL turn it back on. Each selected repository and an active recent-activity threshold, labelled like its option, SHALL also appear as a removable tag in the bar, and removing a tag SHALL clear that one filter. The **Lanes**/**Stack** layout switch and the number of changes shown SHALL stay at the bar's end. The menu SHALL close on Escape, on a click outside it and on leaving it with the keyboard, SHALL expose its open state to assistive technology, and every control SHALL be operable by keyboard.

#### Scenario: Selecting repositories
- **WHEN** the user opens **Repositories** and checks `alpha-infra` and `beta-soc`
- **THEN** only their cards are shown, the button reads `2`, the bar shows the tags `alpha-infra` and `beta-soc` in their colours, and the URL holds both

#### Scenario: Removing a tag
- **WHEN** the user removes the `beta-soc` tag
- **THEN** only `alpha-infra` stays selected and the menu shows `beta-soc` unchecked

#### Scenario: Custom threshold from the URL
- **WHEN** the board opens with `?active=10`
- **THEN** the **Activity** selector shows `Last 10 days` selected and the tag `Last 10 days` is shown

#### Scenario: An old stale link is ignored
- **WHEN** the board opens with `?stale=10`
- **THEN** the **Activity** selector shows `Any time`, no activity tag is shown, and every change the other filters allow is shown

#### Scenario: Hide archived
- **WHEN** the user turns **Hide archived** on
- **THEN** the `Archived` column is removed, the URL holds `archived=0`, exactly as the former checkbox did, and **Hide merged** is disabled

#### Scenario: Hide merged is the default
- **WHEN** the board opens with no query string
- **THEN** **Hide merged** is on, the URL holds no `merged` parameter, and **Clear filters** is not offered

#### Scenario: Clearing restores Hide merged
- **WHEN** **Hide merged** is off and the user activates **Clear filters**
- **THEN** **Hide merged** is on again and the URL no longer holds `merged=1`

#### Scenario: Clearing the search
- **WHEN** the search field holds `sync` and the user activates its clear control
- **THEN** the field is empty and every card that the other filters allow is shown

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

### Requirement: The dashboard opens with a hero header
Every view SHALL open with a hero header. It SHALL show the product mark and the title `Spec Control` in large type, at least 32px and growing with the window up to 56px, with the one-line tagline `Mission control for every agent change across your repositories. Never miss a change.` under it. The mark and the title SHALL together be one way home: a link to the Projects overview `/`, reachable by keyboard as a single stop with the accessible name `Spec Control`, that navigates without a page reload on a plain click and, like any link, opens a new tab on a modifier or middle click; in the demo it SHALL use the demo's hash route. The tagline SHALL NOT be part of the link, and the link SHALL NOT change how the title looks apart from a hover and focus indication. The status corner (Open work, scan errors, the theme control, the last-update age, Refresh and the auto-refresh control) SHALL sit in the hero's top-right corner, and the main navigation as large tabs, each with an icon beside its name, SHALL sit below the title. The auto-refresh control SHALL stand next to Refresh, at the same control size as the rest of the corner, and SHALL carry an accessible name saying it sets the auto-refresh interval. The current view's header band and filter bar SHALL continue on the hero's ground, a soft accent glow with a faint dot grid that fades out before the board, so that title, navigation, view header and filters read as one header; a line SHALL close the hero off from the board. The hero's decoration SHALL be drawn from theme tokens, be purely decorative, and SHALL NOT reduce the contrast of any text in it below the rules of the token set. On narrow windows the status corner SHALL move below the title and the title SHALL shrink, without horizontal scrolling.

#### Scenario: Hero on the combined board
- **WHEN** the combined board is opened in a 1920px wide window
- **THEN** the page shows the mark and `Spec Control` in type of at least 48px, the tagline `Mission control for every agent change across your repositories. Never miss a change.`, the status corner at the top right, the navigation tabs with icons, and then `All changes` with its counts, **New change** and the filter bar on the same glowing ground

#### Scenario: Every view has the hero
- **WHEN** the user moves to Settings or Activity
- **THEN** the same hero with its title and navigation is shown above the view

#### Scenario: Narrow window
- **WHEN** the window is 720px wide
- **THEN** the title is smaller but still the largest text on the page, the status corner sits below it, and nothing scrolls horizontally

#### Scenario: Auto-refresh sits with Refresh
- **WHEN** the status corner is shown
- **THEN** the auto-refresh control stands beside Refresh, shows the interval in force, and is reachable by keyboard with a name that says what it sets

#### Scenario: Auto-refresh on every view
- **WHEN** auto-refresh is `5s` and the user moves from the board to Activity
- **THEN** the control still shows `5s` and the dashboard keeps refreshing on that interval

#### Scenario: Mark and title lead home
- **WHEN** the user is on a repository board and clicks the title `Spec Control` or the mark beside it
- **THEN** the Projects overview is shown without a page reload

#### Scenario: Home in a new tab
- **WHEN** the user Ctrl- or Cmd-clicks the title
- **THEN** the Projects overview opens in a new browser tab and the current view stays as it was

#### Scenario: Home in the demo
- **WHEN** the demo is open on its Activity view and the user clicks the title
- **THEN** the demo shows its Projects overview through its hash route, without leaving the demo's page

### Requirement: The product has its own mark
The dashboard SHALL show its own product mark instead of a generic icon: a drafting drawing of a change travelling through its artifacts — a rounded square framed by faint dashed construction lines that overshoot it, a short tick at each corner-radius centre, a small hub in the middle, and four circular nodes centred on the square's four edges, each carrying a glyph: an arrow for the proposal at the top, a document for the spec on the right, a triangle for the delta at the bottom and a prompt for the code on the left. The mark in the page SHALL be a line drawing on the page's own ground, with its strokes in the theme's accent text colour and its nodes and hub filled with the page background, drawn from theme tokens only so that it stays legible in every supported theme, and SHALL be hidden from assistive technology, as the product name stands beside it. The page SHALL carry the same mark as its favicon, embedded in the page itself so no request is made for it. Because a favicon is shown at 16–32px and cannot follow the page's theme, it SHALL draw the mark on a filled rounded square in fixed colours and MAY leave out the construction lines and ticks; the square, the hub and the four nodes with their glyphs SHALL be the same as in the page.

#### Scenario: Favicon without a request
- **WHEN** the dashboard is opened offline
- **THEN** the browser tab shows the mark, and no request for an icon is made

#### Scenario: One mark
- **WHEN** the favicon and the mark in the hero are compared
- **THEN** they show the same square, hub and four nodes with the same glyphs in the same places

#### Scenario: Mark in both themes
- **WHEN** the theme is switched between dark and light
- **THEN** the mark in the hero is redrawn in that theme's accent and background colours, and its nodes, glyphs and square stay clearly visible against the hero's ground

#### Scenario: Mark is decorative
- **WHEN** a screen reader reads the hero
- **THEN** it reads `Spec Control` and nothing for the mark

### Requirement: The board fits half a screen
The board SHALL offer two layouts of the same columns and cards: **Lanes**, the columns side by side, and **Stack**, each column a full-width section whose repository groups (or, on a repository board, cards) flow in a grid, with the page scrolling vertically so the hero scrolls away. By default the layout SHALL follow the window: **Stack** below 1280px wide, **Lanes** otherwise, switching live as the window is resized. A **Lanes**/**Stack** switch in the filter bar SHALL mark the layout on screen and SHALL make an explicit choice that overrides the default and persists in the URL (`layout=lanes` or `layout=stack`); an unknown value SHALL mean the default. The layout SHALL NOT be a filter: it changes no card or count, and **Clear filters** keeps it. In **Lanes**, a column without cards SHALL shrink to a slim rail that still shows its name and count, and lanes SHALL be narrower on windows narrower than 1600px. Grouping, minimizing, counts, the archived bound and every card's content SHALL be the same in both layouts.

#### Scenario: Half a screen
- **WHEN** the combined board is opened in a window 960px wide
- **THEN** the columns are stacked sections, the cards of each column's repository groups sit side by side in a grid, nothing scrolls horizontally, and the switch marks **Stack**

#### Scenario: Explicit choice
- **WHEN** the user activates **Lanes** in a 960px window
- **THEN** the columns are shown side by side, the URL holds `layout=lanes`, and a reload keeps lanes

#### Scenario: Empty lane
- **WHEN** the `Drafts` column has no cards in the lanes layout
- **THEN** it is a slim rail showing `Drafts` and `0`, and the other lanes get the width

#### Scenario: Clearing filters keeps the layout
- **WHEN** the board holds `layout=stack` and a text search and the user activates **Clear filters**
- **THEN** the search is cleared and the board stays stacked

### Requirement: Archived changes are told apart as merged or pending
The board SHALL treat an archived change as **pending** — still needing to be pushed or merged — when its archive is found only in a linked worktree and not yet in the repository's main checkout, unless that worktree's work status is known to be `merged`; or when an agent-session worktree of that change reports `uncommitted`, `unpushed` or `pushed` work. Every other archived change SHALL be **merged**: in particular every archive the main checkout holds with no such session worktree, and every archive of a repository without git. The distinction SHALL be derived only from the snapshot and the session worktrees the board already has — from local git, as of the user's last fetch — and SHALL NOT fetch, contact a remote or write anything. With agent sessions disabled, only where the archive was found SHALL decide.

#### Scenario: Archive only in a worktree
- **WHEN** `alpha-infra`'s change `add-audit-log` is archived on the branch of a linked worktree and the main checkout does not hold that archive yet
- **THEN** `add-audit-log` is pending

#### Scenario: Archive arrived in the main checkout
- **WHEN** the change `add-audit-log` was archived, merged, and the main checkout now holds `openspec/changes/archive/<date>-add-audit-log/`, and no session worktree of that change holds unmerged work
- **THEN** `add-audit-log` is merged

#### Scenario: Worktree already merged, main checkout not pulled
- **WHEN** an archive exists only in an agent worktree whose work status is `merged`
- **THEN** the change is merged

#### Scenario: Archive worktree still holds unpushed work
- **WHEN** the main checkout holds a change's archive and that change's archive session worktree reports `unpushed`
- **THEN** the change is pending

#### Scenario: Repository without git
- **WHEN** a tracked folder without git holds an archived change
- **THEN** the change is merged

### Requirement: The hero warns about environment problems
When the latest environment report has at least one check whose status is neither `ok` nor `not-needed`, the hero's
status corner SHALL show an environment indicator beside the scan-failure badges: the number of such checks and a short
label, conveyed by text and an icon and not by colour alone, describing in its tooltip or accessible description what is
wrong. The indicator SHALL be a real link to the Environment section of Settings, so it can be opened in a new tab, and
activating it SHALL navigate there without a page reload. When every check is `ok` or `not-needed`, while no report has
been loaded yet, and when the report could not be loaded, the indicator MUST NOT be shown: a failed check of the
environment is not itself something to warn about on the board. The indicator SHALL appear on every view, because the
hero does, and MUST NOT change any count, filter or card.

#### Scenario: A missing tool is visible from the board
- **WHEN** the default agent's executable is not found and the user opens the combined board
- **THEN** the hero's status corner shows an environment indicator with the number of failing checks and a label saying what area is wrong, and its tooltip names the missing agent

#### Scenario: Following the indicator
- **WHEN** the user activates the environment indicator
- **THEN** Settings is shown with the Environment section at the top of the visible area, without a page reload

#### Scenario: A healthy machine shows nothing
- **WHEN** every check in the latest report is `ok` or `not-needed`
- **THEN** the hero's status corner shows no environment indicator

#### Scenario: Nothing is claimed before the report is in
- **WHEN** the dashboard has just loaded and the report has not arrived yet, or the request for it failed
- **THEN** no environment indicator is shown

#### Scenario: The indicator is not a filter
- **WHEN** the environment indicator is shown on the combined board
- **THEN** the columns, counts and cards are exactly what they would be without it

### Requirement: Cards link to their change's pull request
When a change has a linked pull request (`pull-requests`: "A pull request is linked to a change by its head branch"), its card SHALL show `PR #<number>` on the status line that carries the session status and the console quick link, as a link that opens that pull request on GitHub in a new browser tab. It SHALL convey the pull request's state — draft, open, merged or closed — as text or a symbol with a tooltip, and never by colour alone. For an open pull request it SHALL also convey its readiness (`pull-requests`: "A linked open pull request has a readiness"): `ready`, or the one reason it is not ready — `draft`, `conflicts`, `checks failing`, `checks running` or `mergeability unknown` — in words, with a tooltip saying what the pull request is waiting for and when its list was last fetched. Its accessible name SHALL name the repository's pull request, its number, its state and, when open, its readiness.

The readiness SHALL use the status roles: `success` for ready, `danger` for failing checks, `warning` for conflicts, and `branch` for a draft, running checks and unknown mergeability. It MUST NOT use the `info` role, which stays reserved for a running agent.

A card whose change has no linked pull request SHALL show nothing in its place and SHALL NOT reserve space for it, so a board with no pull requests renders exactly as it does without this requirement. A merged or closed pull request SHALL still be shown, more quietly than an open one. Cards in `Archived` SHALL follow the same rule as every other card, so an archive whose pull request still awaits review shows it. Nothing SHALL be shown when pull requests are unavailable for the repository — the Pull requests view reports the reason, and repeating it per card would be noise.

The link MUST NOT change the card's column, progress bar, counts, warnings, starters or session badge, MUST NOT become a board filter or a column count, MUST NOT decide whether an archived card is hidden by **Hide merged**, and MUST NOT be the only way to reach the pull request: the change's detail header carries it in full. The one thing beyond its own badge that it changes on the card is the working state ("A card keeps its working state until its pull request is ready").

#### Scenario: Card with an open pull request
- **WHEN** a card's change has an open pull request `#125`
- **THEN** the card shows `PR #125` on its status line as a link to that pull request, opening in a new tab, with its state given as text or a symbol

#### Scenario: Card with a ready pull request
- **WHEN** a card's change has open pull request `#125` with passing checks that is mergeable
- **THEN** the card shows `PR #125` with `ready` in the `success` role

#### Scenario: Card with running checks
- **WHEN** a card's change has open pull request `#125` whose checks are pending
- **THEN** the card shows `PR #125` with `checks running` in the `branch` role, and its tooltip says when the list was last fetched

#### Scenario: Card with a conflict
- **WHEN** a card's change has open pull request `#125` that conflicts with its base
- **THEN** the card shows `PR #125` with `conflicts` in the `warning` role

#### Scenario: Card without a pull request
- **WHEN** a card's change has no linked pull request
- **THEN** the card shows no pull-request link and no space is left for one

#### Scenario: Merged pull request
- **WHEN** a card's change has a merged pull request
- **THEN** the card still shows it, marked as merged, more quietly than an open one, and with no readiness

#### Scenario: State is not conveyed by colour alone
- **WHEN** a screen reader reads a card with a draft pull request
- **THEN** it reads the pull request's number and that it is a draft

#### Scenario: Archive awaiting review
- **WHEN** an archived change's archive pull request on `chore/archive-<name>` is open
- **THEN** its card in `Archived` shows that pull request as open, with its readiness

#### Scenario: Archived change
- **WHEN** an archived change's former branch still has a cached merged pull request
- **THEN** its card in `Archived` shows it, marked as merged, more quietly than an open one

#### Scenario: Pull requests unavailable
- **WHEN** `gh` is not installed
- **THEN** no card shows a pull-request link and no card shows an error for it

#### Scenario: The link is not a filter
- **WHEN** the user clears filters on a board whose cards show pull requests
- **THEN** the same cards are shown and the links are unaffected

### Requirement: Starting a session from a card stays on the board
Activating a session starter on a card SHALL start the session and SHALL leave the user on the board they activated it
from: the dashboard MUST NOT navigate to the change's detail view, select its Console tab or otherwise move away from
the board because a session started. This SHALL hold for every starter a card offers. Once the session is known, the
card SHALL show its badge in place of its starters, as the "Cards offer session starters and show session state"
requirement gives it, and activating that badge or **Show details** SHALL open the detail view as before. A start that
is refused or fails SHALL still report its reason on the card it was activated from.

Starters offered inside a change's Console tab — the openings for a change no agent has worked on, and the next-step
starters that send a prompt to a running session — are not card starters: they SHALL keep showing the started or
prompted session in that same Console tab.

#### Scenario: Drafting from the board
- **WHEN** the user activates **Draft artifacts** on a card of change `audit-trail` on the `demo-ops` board
- **THEN** the session starts, the `demo-ops` board stays on screen, and the card shows the `working` badge where its
  starter was

#### Scenario: Several starts in a row
- **WHEN** the user activates **Draft artifacts** on the cards of `audit-trail` and then `upgrade-runtime`
- **THEN** both sessions start, the board stays on screen throughout, and each card shows its own session's badge

#### Scenario: Opening the started session
- **WHEN** a session was started from a card and the user then activates that card's badge
- **THEN** the change's detail view opens on its Console tab with that session's terminal shown

#### Scenario: A refused start
- **WHEN** a card's starter is activated and the start is refused
- **THEN** the board stays on screen and the card shows the reason beside its starters

#### Scenario: Starting from the Console tab
- **WHEN** the user activates **Implement** in the Console tab of a change no agent has worked on
- **THEN** the session starts and that same Console tab shows its terminal

### Requirement: A card keeps its working state until its pull request is ready
A card whose change links an open pull request that is not ready (`pull-requests`: "A linked open pull request has a readiness") SHALL be shown in its **working state** — the same card tint a card with an agent at work has — whether or not an agent session is running, so that the board tells the user the change is not finished without a visit to GitHub. While that pull request is in progress (its checks are running or its mergeability is unknown) the card's name SHALL sweep as it does for a working agent; while it is only waiting (a draft, failing checks or a conflict) the card SHALL keep the tint without motion. When the pull request becomes ready, is merged or is closed, or the card no longer links it, the working state it caused SHALL end, and a card whose agent is working SHALL keep the working state the agent gives it. Users who prefer reduced motion SHALL see the tint without the sweep, as for a working agent.

The working state caused by a pull request MUST NOT add or remove an available action, change the session badge, the column, the progress bar or any count, and MUST NOT be recorded in the activity log. When pull requests are unavailable for the repository, or have never been fetched, no card SHALL be put in the working state by a pull request.

#### Scenario: Checks running after a ship
- **WHEN** the agent's session for `add-validate-phase` has ended and its open pull request `#125`'s checks are running
- **THEN** the card is tinted as working with its name sweeping, shows `PR #125` with `checks running`, its split button's main part says it waits for the checks, and its menu still offers the starters its stage allows

#### Scenario: Failing checks keep the tint without motion
- **WHEN** `#125`'s checks fail
- **THEN** the card stays tinted as working, its name does not sweep, and its badge says `checks failing`

#### Scenario: Ready releases the card
- **WHEN** a refresh finds `#125` with passing checks and mergeable, and no agent session of the change is running
- **THEN** the card is no longer tinted, and shows `PR #125` with `ready`

#### Scenario: A working agent keeps the tint
- **WHEN** `#125` is ready and an agent session of the change is working
- **THEN** the card stays tinted because of the agent, with its `working` session badge

#### Scenario: Merged pull request
- **WHEN** `#125` is merged
- **THEN** the pull request puts the card in no working state

#### Scenario: Nothing fetched
- **WHEN** the pull-request cache is empty or `gh` is not signed in
- **THEN** no card is tinted because of a pull request

### Requirement: The board refreshes not-ready pull requests on its own
A Kanban board SHALL run the pull-request watch of the `pull-requests` capability ("The board watches pull requests that are not ready") for the cards it shows, and the cards and the pull-request badges SHALL update in place when a watch refresh answers, without reordering cards or changing any column or count. The Refresh control on the board's pull-request dialog SHALL show a watch refresh as running, like any other refresh.

#### Scenario: The card updates in place
- **WHEN** a watch refresh finds that `#125`'s checks now pass and it is mergeable
- **THEN** the card's badge changes to `ready` and its working state ends without the card moving or the board scrolling

#### Scenario: A repository board watches only its own cards
- **WHEN** the repository board of `beta-soc` is open and `alpha-infra` has a not-ready pull request but `beta-soc` has none
- **THEN** the board starts no watch refresh

### Requirement: Preferences kept in the browser survive the rename
Every value the UI keeps in the browser's `localStorage` — the theme, whether the tour was seen, collapsed groups, the auto-refresh interval, the last seen What's new entry and the last seen activity — SHALL be stored under a key starting with `spec-control.`. Once per browser, before any of them is read, the UI SHALL copy every key under the former prefix `openspec-dashboard.` that holds a value to the key of the same name under `spec-control.`, unless that key already holds a value, and SHALL then record in `spec-control.migrated` that the copy was made. Once that record exists the UI SHALL NOT read any former key again, so that a preference changed or removed after the copy is never brought back by the former one. The copy SHALL NOT remove the former keys. When `localStorage` is unavailable or throws, the UI SHALL behave as it does without a stored value. The demo SHALL use the same keys.

#### Scenario: Theme carries over
- **WHEN** the browser holds `openspec-dashboard.theme` = `light` and no `spec-control.theme`, and the user opens the dashboard
- **THEN** the dashboard is shown in the light theme and `spec-control.theme` now holds `light`

#### Scenario: New value wins
- **WHEN** the browser holds `spec-control.autoRefresh` = `30s` and `openspec-dashboard.autoRefresh` = `5s`
- **THEN** auto-refresh is `30s`

#### Scenario: Removing a preference does not bring back the old one
- **WHEN** the theme was copied to `spec-control.theme` and the user then selects `system`, which removes that key, and reloads
- **THEN** the theme follows the system and is not taken from `openspec-dashboard.theme` again

#### Scenario: Tour not shown again after the upgrade
- **WHEN** the browser holds the former tour key marking the tour as seen
- **THEN** the tour does not start by itself after the upgrade

### Requirement: Cards copy the change's reference
In addition to what "Cards show only what an overview needs" lists, a card SHALL offer, directly after the change name, the same copy control as the detail header (change-detail: "The detail header copies the change's reference"): activating it SHALL write `<repository name>/<change name>` (e.g. `demo-ops/cloud-deployment`) to the clipboard and briefly confirm it, with a tooltip and accessible name naming the reference it copies. The card SHALL still not show the repository name as text; the reference merely includes it. The control SHALL stay quiet — not drawn — until the card is hovered or the control has keyboard focus, and it SHALL remain reachable with the keyboard. It SHALL NOT open the detail view, start a session or otherwise act on the card, and it SHALL NOT shorten the name, push the console quick link out of its slot or change where the name wraps beyond the width of the icon itself. It is offered on every card, archived ones included.

#### Scenario: Copying from a card
- **WHEN** the user hovers the card `cloud-deployment` in the `demo-ops` group and activates the copy icon next to its name
- **THEN** the clipboard holds exactly `demo-ops/cloud-deployment`, the icon briefly shows that it was copied, and the board stays as it was

#### Scenario: Quiet at rest
- **WHEN** a card is shown and neither hovered nor holding focus
- **THEN** no copy icon is drawn next to its name, and the card's name and age look exactly as before

#### Scenario: Reachable by keyboard
- **WHEN** the user tabs through a card
- **THEN** the copy icon receives focus, becomes visible, and is announced as `Copy demo-ops/cloud-deployment`

### Requirement: Cards offer Fast-forward
When a card offers its change's starters and **Fast-forward** is available for the change (agent-sessions: "Fast-forward
drafts, implements and ships in one session"), the card SHALL offer it as an item of the split button's menu ("A change's actions are one split button")
whose visible text is `Fast-forward`, whose accessible name and tooltip say what it does — write the artifacts,
implement and open a pull request — together with the agent's name, and which is disabled with the same explanation as
the other starters when the agent's executable is not found. It SHALL follow every rule the other starters follow: it is
hidden while a session of the change runs, offered again beside a failed session's badge, reports a refused or failed
start on the card, and leaves the user on the board. Activating it SHALL first ask for confirmation as that capability
requires; while the dialog is open the card's starters SHALL be disabled. The same item SHALL be offered in the split button of a
change's Console tab wherever Fast-forward is available there.

#### Scenario: Backlog card offers FF
- **WHEN** a change in `Backlog` is not blocked, agent sessions are enabled and the repository's agent has Draft and Implement prompts
- **THEN** its split button shows **Draft artifacts** and its menu offers **Fast-forward**

#### Scenario: FF stays on the board
- **WHEN** the user chooses **Fast-forward** from a card's menu and confirms
- **THEN** the session starts, the card shows its badge in place of its starters and the board stays open

#### Scenario: No FF on a planned card
- **WHEN** a change is in `Ready`
- **THEN** its card's split button shows **Implement** and its menu offers no **Fast-forward**

### Requirement: A change's actions are one split button
Wherever the dashboard offers a change's session starters — a card's footer and the change's Console tab — it SHALL offer
them as **one split button**: a **main part** showing the **recommended action**, and an **arrow part** that opens a
menu of every **other** action available for the change. The available actions SHALL be exactly the starters the
change's stage, sub-state and dependencies allow (`agent-sessions`: "Session starters run a fixed prompt for a validated
change"), narrowed to those the repository's agent has a prompt for — Fast-forward where it is available — plus, while
the change links an open pull request, that pull request's action when it has one. The menu SHALL list them in a fixed
order (Draft artifacts, Fast-forward, Implement, Validate, Archive, then the pull request's action), without the one the
main part shows. When nothing else is available, the arrow part SHALL NOT be shown.

The recommended action SHALL be, for a change with no linked **open** pull request, its stage's primary step: **Draft
artifacts** in `Unknown`, `Backlog` and `Drafts`; **Implement** in `Ready` and `Implementing`; **Validate** in `Done`
with the sub-state `validate`; **Archive** in `Done`. For a change that is not archived and links an open pull request
(`pull-requests`: "A pull request is linked to a change by its head branch") it SHALL follow that pull request's
readiness:

- `conflicts` → **Resolve conflicts**;
- `ready` → **Merge**;
- `checks failing` → **Implement**, so that an agent fixes what the checks report; in `Done`, where Implement is not
  available, **Fix checks**, which opens the Console tab of the session whose branch heads that pull request;
- `draft`, `checks running` or `mergeability unknown` → **no recommended action**: the main part SHALL be a
  non-actionable **waiting** label that says in words what the pull request waits for, and the arrow part SHALL still
  offer every available action.

When the stage's primary step is not available — Implement for a **blocked** change, or a step the agent has no prompt
for — the main part SHALL show the next available action in the menu order, or, when there is none, the split button
SHALL NOT be shown; a blocked change's "waits for" note is shown as before.

**Merge** and **Resolve conflicts** SHALL open the change's detail view on its Console tab with the session whose branch
heads that pull request selected, where those actions are offered, and SHALL NOT start, resume or send anything by
themselves; without a session record whose branch heads the pull request, **Merge** SHALL be a link that opens the pull
request on GitHub in a new browser tab and **Resolve conflicts** SHALL open the Console tab. Where a dedicated Resolve
conflicts action for pull requests is available (`resolve-pr-conflicts`), **Resolve conflicts** SHALL be that action.
Every starter SHALL behave exactly as it does today wherever it is chosen from — main part or menu: the same
confirmation for Fast-forward, the same refusal shown in place, the same "Starting…" state, and in the Console tab of a
running session the same sending into that session.

The arrow part SHALL be a menu button: it SHALL carry an accessible name naming the change ("More actions for
<change>"), `aria-haspopup="menu"` and `aria-expanded`, and the menu SHALL use menu and menu-item semantics. The menu
SHALL open with Enter, Space or Arrow Down and move focus to its first item; Arrow Up and Arrow Down SHALL move between
items, Home and End to the first and last; Enter or Space SHALL activate an item; Escape SHALL close it and return focus
to the arrow part; Tab, a click outside or activating an item SHALL close it. Each item and the main part SHALL carry the
same accessible name and tooltip its starter has today, disabled with the same explanation when the agent is not found.
While a starter is starting or a confirmation dialog is open, both parts SHALL be disabled.

The recommended action SHALL be derived on display from the snapshot, the session list and the cached pull-request
lists, with the same link and readiness the pull-request badge shows. It MUST NOT be stored or logged and MUST NOT change
the change's available actions, column, sub-state, progress or any count. When pull requests are unavailable for the
repository or were never fetched, the recommended action is the stage's. A running session's badge SHALL stand in for
the split button on a card exactly as it does for the starters today.

#### Scenario: Ready change with an optional design missing
- **WHEN** change `rotate-keys` is in `Ready`, its optional `design.md` is not written, and agent sessions are enabled
- **THEN** its card's main part is **Implement** and its menu offers **Draft artifacts**

#### Scenario: Done change awaiting validation
- **WHEN** a change is in `Done` with the sub-state `validate`
- **THEN** the main part is **Validate** and the menu offers **Archive**

#### Scenario: Done change without a design
- **WHEN** a change is in `Done` and its optional `design.md` is not written
- **THEN** the main part is **Archive** and nothing offers **Draft artifacts**

#### Scenario: Backlog card
- **WHEN** a change in `Backlog` is not blocked and the agent has Draft and Implement prompts
- **THEN** the main part is **Draft artifacts** and the menu offers **Fast-forward**

#### Scenario: Checks running
- **WHEN** change `rotate-keys` is in `Done`, no session runs, and its linked open pull request `#58`'s checks are running
- **THEN** the main part reads that the checks are running and starts nothing, and the menu offers **Archive**

#### Scenario: Checks failing
- **WHEN** `rotate-keys` is in `Implementing` and `#58`'s checks fail
- **THEN** the main part is **Implement**

#### Scenario: Checks failing on a finished change
- **WHEN** `rotate-keys` is in `Done`, `#58`'s checks fail, and its ended Implement session's branch heads `#58`
- **THEN** the main part is **Fix checks**, which opens the change's Console tab with that session selected, and the menu offers **Archive**

#### Scenario: Ready to merge
- **WHEN** `#58` is ready and the change's ended Implement session's branch `feat/rotate-keys` heads it
- **THEN** the main part is **Merge**, and activating it opens the change's Console tab with that session selected

#### Scenario: Ready to merge without a session
- **WHEN** `#58` is ready and the dashboard has no session record for `rotate-keys`
- **THEN** the main part **Merge** is a link that opens `#58` on GitHub

#### Scenario: Conflicting pull request
- **WHEN** `#58` conflicts with its base
- **THEN** the main part is **Resolve conflicts**

#### Scenario: Merged pull request gives the stage back
- **WHEN** `#58` is merged and `rotate-keys` is still in `Done`
- **THEN** the main part is **Archive**

#### Scenario: Keyboard
- **WHEN** the user focuses the arrow part, presses Enter, then Escape
- **THEN** the menu opens with focus on its first item, then closes with focus back on the arrow part

#### Scenario: Nothing else available
- **WHEN** a change in `Done` with the sub-state `complete` has no linked open pull request
- **THEN** the split button shows **Archive** and no arrow part

#### Scenario: Running session
- **WHEN** a session of `rotate-keys` is running and `#58` is ready
- **THEN** the card shows that session's badge and no split button
