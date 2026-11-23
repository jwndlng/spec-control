# Spec Delta

## MODIFIED Requirements

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
  does not drop, and the session’s Console still shows its worktree’s status

#### Scenario: Archive worktree of an archived change
- **WHEN** the archive worktree of a change that is already archived holds a commit that is not pushed
- **THEN** it appears in the Open work list although no card offers it, and opening it shows its Console tab

#### Scenario: Nothing open
- **WHEN** no session runs and no session worktree holds anything
- **THEN** the top bar shows no Open work control

### Requirement: Cards link to their change's pull request
When a change has a linked pull request (`pull-requests`: "A pull request is linked to a change by its head branch"), its card SHALL show `PR #<number>` on the status line that carries the session status and the console quick link, as a link that opens that pull request on GitHub in a new browser tab. It SHALL convey the pull request's state — draft, open, merged or closed — as text or a symbol with a tooltip, and never by colour alone. For an open pull request it SHALL also convey its readiness (`pull-requests`: "A linked open pull request has a readiness"): `ready`, or the one reason it is not ready — `draft`, `conflicts`, `checks failing`, `checks running` or `mergeability unknown` — in words, with a tooltip saying what the pull request is waiting for and when its list was last fetched. Its accessible name SHALL name the repository's pull request, its number, its state and, when open, its readiness.

The readiness SHALL use the status roles: `success` for ready, `danger` for failing checks, `warning` for conflicts, and `branch` for a draft, running checks and unknown mergeability. It MUST NOT use the `info` role, which stays reserved for a running agent.

A card whose change has no linked pull request SHALL show nothing in its place and SHALL NOT reserve space for it, so a board with no pull requests renders exactly as it does without this requirement. A merged or closed pull request SHALL still be shown, more quietly than an open one. Cards in `Archived` SHALL follow the same rule as every other card, so an archive whose pull request still awaits review shows it. Nothing SHALL be shown when pull requests are unavailable for the repository — the Pull requests view reports the reason, and repeating it per card would be noise.

The link MUST NOT change the card's column, progress bar, counts, warnings, starters or session badge, MUST NOT become a board filter or a column count, MUST NOT decide whether an archived card is hidden by **Hide merged**, and MUST NOT be the only way to reach the pull request: the matching delivery checkpoint links to it in change detail. The one thing beyond its own badge that it changes on the card is the working state ("A card keeps its working state until its pull request is ready").

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

### Requirement: A card names a proposal pull request as such
When a change's linked pull request is its proposal pull request (`pull-requests`: "A proposal pull request is linked to its change"), the change's card SHALL label the pull-request badge as the proposal pull request — for example `Proposal #90` — together with the readiness every linked pull request shows, and any recommended step the card derives from that pull request SHALL name it the same way. Nothing else about the badge, the card's column, counts or available actions SHALL differ from any other linked pull request.

#### Scenario: Proposal checks running
- **WHEN** `rotate-keys` is `Ready` and its linked pull request `#90` from `docs/rotate-keys` is open with checks running
- **THEN** the card's badge reads as the proposal pull request `#90`, its state says the checks are running, and **Implement** is still available for the change

#### Scenario: Implementation pull request
- **WHEN** the linked pull request is `#94` from `feat/rotate-keys`
- **THEN** the badge shows `#94` without the proposal label
