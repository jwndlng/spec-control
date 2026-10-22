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
  with its path. Each linked worktree whose branch belongs to no active change of the project — no active change is
  read from that worktree or names it as its branch, and the branch is not one an agent session would use for an
  active change — SHALL carry a `no active change` marker, with a tooltip saying the branch may be left over; the main
  checkout, a detached or stale worktree and the default branch never carry it. The section's summary line SHALL say
  how many branches have no active change when there are any. Each linked worktree that is not stale, not bare and
  not on the default branch SHALL offer a **Delete…** control that opens the deletion dialog of the
  `repository-cleanup` capability ("One branch and its worktree can be deleted whatever they hold") for that worktree,
  over the overlay; while that dialog is open, Escape and the backdrop close it and not the overlay.
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
overlay SHALL have no Checkouts section. The header MUST NOT offer any action on an individual checkout, and the
overlay offers only the **Delete…** control above; worktrees are otherwise removed only through the Clean up dialog
and the agent-session views.

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

#### Scenario: Branch with no active change is highlighted
- **WHEN** `alpha-infra` has active changes `report` and `parser`, a worktree on `feat/report` holding `report`, and a
  worktree on `spike/old-idea` holding no change
- **THEN** in the overlay's Checkouts section `spike/old-idea` carries the marker `no active change` with its tooltip,
  `feat/report` and the main checkout do not, and the summary line says 1 branch has no active change

#### Scenario: Archived change no longer counts
- **WHEN** the only change named after the worktree branch `feat/audit-trail` has been archived
- **THEN** that worktree carries the `no active change` marker

#### Scenario: Delete control per worktree
- **WHEN** the overlay's Checkouts section lists the main checkout on `feat/redesign`, a worktree on the default branch
  `main`, a worktree on `feat/report` and a stale worktree record
- **THEN** only the `feat/report` row offers **Delete…**, and activating it opens the deletion dialog for that worktree
  over the overlay without removing anything

#### Scenario: Escape closes the deletion dialog first
- **WHEN** the deletion dialog is open over the overlay and the user presses Escape
- **THEN** the deletion dialog closes and the project details overlay stays open
