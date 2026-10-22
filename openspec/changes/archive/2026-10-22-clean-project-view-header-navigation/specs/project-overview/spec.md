## MODIFIED Requirements

### Requirement: Repository board header
The repository board SHALL show a header in three parts: a **title row**, a **quick view** and the **action area** of
kanban-board's "Actions have their own area", followed by the repository's notices.

The **title row** SHALL hold a breadcrumb linking back to the overview, the repository name, which SHALL expose the
repository's full path as its tooltip, and the project's settings button ("The repository board opens the project's
settings").

The **quick view** SHALL be one row of the facts a user needs at a glance, in this order, each shown only when it
applies: the open and to-archive counts (kanban-board: "The board opens with a header band"); the main checkout's
status chip, labelled as such; a **branches** control reading `<n> branches` (the distinct branches checked out in any
checkout) that, when any checkout holds uncommitted, unpushed or stale work, also says how many (`<m> with work`); the
pull requests control ("Repository board lists the repository's pull requests"); the fetch note ("A project shows when
it was last fetched"); an attention marker when a shared-config profile the repository carries is not `in-sync` or its
`openspec/config.yaml` is unreadable, saying so in text; and a **Details** control. The quick view SHALL NOT show the
repository's labels, its in-sync shared-config profiles or the relative age of its last update: those are in the
details overlay.

The **Details** control SHALL open the **project details** overlay over the dimmed page, titled with the word Details
and the repository's name, with an accessible name that includes the repository's name. It SHALL hold labelled
sections, each shown only when it has something to show, in this order:
- **Repository**: the full path, whether it is a git repository, the main checkout's branch and the relative age of the
  last update with the exact time in a tooltip.
- **Checkouts**: one status chip per checkout of the repository — the main checkout and each linked worktree — each
  with its path.
- **Sync**: the fetch note with its exact time, the project's auto fetch interval or that auto fetch is off, the reason
  of a failed automatic fetch, and the notice of "A main checkout that is off its default branch is flagged".
- **Pull requests**: the number of open pull requests from the cached list, or that there is no list, and a control
  that opens the repository's pull requests dialog.
- **Shared config**: every profile the repository carries with its state, and that `openspec/config.yaml` is
  unreadable when it is.
- **Labels**: the repository's labels as the `project-labels` capability displays them.
The overlay SHALL only show what the snapshot, the configuration and the cached pull-request list already hold:
opening it MUST NOT start a scan, a fetch or a pull-request query. It SHALL close when the user presses Escape,
activates its close control or clicks the backdrop, returning focus to the control that opened it, and MUST NOT change
the route.

Activating the **branches** control SHALL open the project details overlay with its Checkouts section in view.

The repository's warnings, a failed scan and the off-default-branch notice SHALL stay visible as notices in the header
below its three parts; the overlay MUST NOT be the only place they are shown.

The header SHALL offer a **New change** action that opens the create-change form for that repository (as specified in
the `change-creation` capability), and, for an enabled git repository whose last scan succeeded, a **Clean up** action
that opens the cleanup dialog for that repository (as specified in the `repository-cleanup` capability), both in its
action area. The header SHALL NOT show the repository's path as text of its own, and it SHALL NOT offer an action that
copies the path or a `cd` command for it. The New change action SHALL be shown only when the repository is enabled and
its last scan succeeded and it has an `openspec/` directory to create into; otherwise the action SHALL be absent. A
checkout chip SHALL show the checkout's branch, or that it is detached, and, only when they apply, text markers for:
the number of uncommitted items, the number of unpushed commits, the number of commits behind the upstream, stale,
locked, and status unknown or not inspected. A clean, fully pushed checkout SHALL show its branch alone. Every marker
SHALL be conveyed with text or a symbol plus a tooltip that spells it out, never by colour alone; the tooltips for
unpushed and behind SHALL state that the numbers reflect the last fetch, and the unpushed tooltip SHALL distinguish
commits ahead of a named upstream from commits on a branch that was never pushed. When the snapshot carries no
checkout information for the repository, the quick view SHALL fall back to the current branch when known, and the
overlay SHALL have no Checkouts section. The header and the overlay MUST NOT offer any action on an individual
checkout; worktrees are removed only through the Clean up dialog and the agent-session views.

#### Scenario: Header content
- **WHEN** repository `alpha-infra` at `/Users/x/Workspace/acme/alpha-infra` has a clean main checkout on `main` and two linked worktrees on `feat/report` and `fix/parser`, and was last updated 1 day ago
- **THEN** the title row shows `Projects / alpha-infra` and a settings button, the quick view shows the counts, the chip `main` labelled as the main checkout, a `3 branches` control and a **Details** control and does not show `updated 1d ago`, and the action area offers `New change` and `Clean up`

#### Scenario: Branches open the details at the checkouts
- **WHEN** the user activates `3 branches` on the board of `alpha-infra`
- **THEN** the project details overlay opens with its Checkouts section in view, showing the chips `main`, `feat/report` and `fix/parser` and their paths

#### Scenario: Worktree with uncommitted and unpushed work
- **WHEN** the worktree on `feat/report` has 4 uncommitted items and is 2 commits ahead of `origin/feat/report`
- **THEN** the branches control reads `3 branches` and `1 with work`, and in the overlay's Checkouts section the chip `feat/report` shows an uncommitted marker `4` and an unpushed marker `2`, whose tooltip names `origin/feat/report` and says it reflects the last fetch

#### Scenario: Branch never pushed
- **WHEN** a worktree's branch has no upstream and 3 commits on no remote
- **THEN** its chip in the overlay's Checkouts section shows an unpushed marker `3` whose tooltip says the commits are not on any remote

#### Scenario: Detached and stale worktrees
- **WHEN** one worktree has a detached HEAD and another is prunable
- **THEN** in the overlay's Checkouts section the first chip reads detached instead of a branch name and the second carries the text `stale`

#### Scenario: Dirty main checkout
- **WHEN** the main checkout has 2 uncommitted items and the repository has no linked worktrees
- **THEN** the quick view shows one chip for the main checkout with an uncommitted marker `2`

#### Scenario: Snapshot without checkout information
- **WHEN** the repository's snapshot predates working-tree status and reports only the current branch `main`
- **THEN** the quick view shows `main` and no status markers, and the details overlay has no Checkouts section

#### Scenario: Details overlay
- **WHEN** the user activates **Details** on the board of `demo-ops`, a git repository with auto fetch every 15 minutes, 2 cached open pull requests, the shared-config profile `base` in sync and the labels `client` and `terraform`
- **THEN** an overlay titled Details and `demo-ops` shows its path, its checkouts, its last fetch and that it is fetched every 15 minutes, `2 open PRs` with a control that opens its pull requests dialog, `base` as in sync, and `client` and `terraform`; no scan, fetch or pull-request query was started, and the route is unchanged

#### Scenario: Closing the overlay
- **WHEN** the project details overlay is open and the user presses Escape
- **THEN** the overlay closes and focus returns to the **Details** control

#### Scenario: A profile out of sync is not hidden
- **WHEN** `demo-ops` carries `base` outdated
- **THEN** the quick view shows an attention marker saying a shared-config profile needs attention, and the overlay's Shared config section shows `base` as outdated

#### Scenario: Warnings stay in the header
- **WHEN** the repository's last scan failed and the snapshot carries a warning
- **THEN** both are shown as notices in the header, and the overlay is not needed to see them

#### Scenario: Back to overview
- **WHEN** the user activates `Projects` in the breadcrumb
- **THEN** the overview at `/` is shown without a page reload

#### Scenario: Copy cd
- **WHEN** the board of a repository at `/Users/x/My Repos/foo` is shown
- **THEN** the header shows no `Copy cd` action and does not show `/Users/x/My Repos/foo` as text, and hovering the repository name shows `/Users/x/My Repos/foo` as its tooltip

#### Scenario: New change action opens the form
- **WHEN** the user activates the `New change` action on the header
- **THEN** the create-change form opens for that repository and nothing has been written yet

#### Scenario: Clean up action
- **WHEN** the user activates the `Clean up` action on the header of a git repository
- **THEN** the cleanup dialog opens for that repository and nothing has been removed yet

#### Scenario: Clean up hidden for a non-git repository
- **WHEN** the repository is not a git repository, or its last scan failed
- **THEN** the header shows no `Clean up` action

#### Scenario: New change hidden for a failed scan
- **WHEN** the repository's last scan failed
- **THEN** the header shows no `New change` action

### Requirement: A project shows when it was last fetched
For a managed git repository the projects overview row and tile SHALL show beside the Pull control, and the repository board header SHALL show in its quick view, outside its action area, how long ago the repository was last fetched, as a relative age (for example `fetched 4m ago`), with the exact time in a tooltip. The time SHALL be read from the repository itself, so a fetch the user ran outside the dashboard counts as well, and SHALL be read without writing anything. A repository that was never fetched SHALL show `never fetched`; a repository without a remote, and a folder without git, SHALL show nothing. When the project has auto fetch on, the note SHALL also say so and at which interval. When the most recent automatic fetch of the project failed, the note SHALL say that auto fetch failed, in a warning tone that is not conveyed by colour alone, with the reason, credentials masked, in its tooltip; the next successful fetch, automatic or by Pull, SHALL clear it. The note SHALL update from the rescan that follows a fetch, without a page reload.

#### Scenario: Recently fetched
- **WHEN** `demo-ops` has auto fetch every 15 minutes and its last fetch was 4 minutes ago
- **THEN** its row shows `fetched 4m ago` beside Pull, and the tooltip gives the exact time and says it is fetched every 15 minutes

#### Scenario: On the board
- **WHEN** the board of `demo-ops` is shown and its last fetch was 4 minutes ago
- **THEN** `fetched 4m ago` stands in the header's quick view and not among the actions

#### Scenario: Fetched outside the dashboard
- **WHEN** the user runs `git fetch` in a terminal for `alpha-infra`, which has auto fetch off, and the overview rescans
- **THEN** its row shows that it was fetched moments ago

#### Scenario: Automatic fetch failed
- **WHEN** the last automatic fetch of `demo-ops` failed because the remote could not be reached
- **THEN** its row shows that auto fetch failed, with the reason in the tooltip, and after a successful Pull the warning is gone

#### Scenario: No remote
- **WHEN** a git repository has no remote configured
- **THEN** its row shows no fetch note

## ADDED Requirements

### Requirement: The repository board opens the project's settings
The repository board header SHALL offer, in its title row beside the repository name, the project's **settings
button** as "Each managed project carries its own settings on the overview" describes it: an icon button whose
accessible name and tooltip say that it opens the project's settings and include the project's name. Activating it
SHALL open the same project settings dialog the overview's rows and tiles open, with the same lines, behaviour, saving,
errors and Labels and Disable actions, over the dimmed page, without changing the route. A change made in it SHALL take
effect on the board at once, without waiting for a scan. When the dialog closes, keyboard focus SHALL return to the
board's settings button. When the user disables the project from it and the configuration is saved, the dialog SHALL
close and the projects overview SHALL be shown; when Disable fails the dialog SHALL stay open and show the reason. The
button SHALL NOT be offered for a repository that is not enabled in the configuration.

#### Scenario: Opening the settings from the board
- **WHEN** the user activates the settings button on the board of `alpha-infra`
- **THEN** the settings dialog of `alpha-infra` opens, the same as from its overview row, and the route stays `/repos/alpha-infra`

#### Scenario: A setting changed on the board
- **WHEN** agent sessions are on and the user switches Agent sessions to Disabled in that dialog
- **THEN** the configuration is saved without any Save, and the cards of `alpha-infra` on the board behind it no longer offer session starters

#### Scenario: Disabling from the board
- **WHEN** the user activates Disable in the settings dialog opened from the board of `demo-agent`
- **THEN** `demo-agent` is disabled, the dialog closes and the projects overview is shown, listing `demo-agent` under Unmanaged projects

#### Scenario: Labels from the board
- **WHEN** the user activates Labels in the settings dialog opened from the board
- **THEN** the labels dialog of that project replaces it, and when it closes focus returns to the board's settings button
