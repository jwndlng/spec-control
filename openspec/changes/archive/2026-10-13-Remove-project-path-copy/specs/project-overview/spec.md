## MODIFIED Requirements

### Requirement: Repository board header
The repository board SHALL show a header with a breadcrumb linking back to the overview, the repository name, which SHALL expose the repository's full path as its tooltip, the main checkout's status chip, labelled as such, and a **branches** control reading `<n> branches` (the distinct branches checked out in any checkout) that, when any checkout holds uncommitted, unpushed or stale work, also says how many (`<m> with work`), and that opens a dialog listing one status chip per checkout of the repository — the main checkout and each linked worktree — each with its path — the relative age of the repository's last update, any repository warnings or scan error, and a **New change** action that opens the create-change form for that repository (as specified in the `change-creation` capability), and, for an enabled git repository whose last scan succeeded, a **Clean up** action that opens the cleanup dialog for that repository (as specified in the `repository-cleanup` capability). The header SHALL NOT show the repository's path as text of its own, and it SHALL NOT offer an action that copies the path or a `cd` command for it. The New change action SHALL be shown only when the repository is enabled and its last scan succeeded and it has an `openspec/` directory to create into; otherwise the action SHALL be absent. A checkout chip SHALL show the checkout's branch, or that it is detached, and, only when they apply, text markers for: the number of uncommitted items, the number of unpushed commits, the number of commits behind the upstream, stale, locked, and status unknown or not inspected. A clean, fully pushed checkout SHALL show its branch alone. Every marker SHALL be conveyed with text or a symbol plus a tooltip that spells it out, never by colour alone; the tooltips for unpushed and behind SHALL state that the numbers reflect the last fetch, and the unpushed tooltip SHALL distinguish commits ahead of a named upstream from commits on a branch that was never pushed. When the snapshot carries no checkout information for the repository, the header SHALL fall back to the current branch when known. The header and the dialog MUST NOT offer any action on an individual checkout; worktrees are removed only through the Clean up dialog and the agent-session views.

#### Scenario: Header content
- **WHEN** repository `alpha-infra` at `/Users/x/Workspace/acme/alpha-infra` has a clean main checkout on `main` and two linked worktrees on `feat/report` and `fix/parser`, and was last updated 1 day ago
- **THEN** the header shows `Projects / alpha-infra`, the chip `main` labelled as the main checkout, a `3 branches` control, `updated 1d ago`, a `New change` action and a `Clean up` action, and activating `3 branches` opens a dialog with the chips `main`, `feat/report` and `fix/parser` and their paths

#### Scenario: Worktree with uncommitted and unpushed work
- **WHEN** the worktree on `feat/report` has 4 uncommitted items and is 2 commits ahead of `origin/feat/report`
- **THEN** the branches control reads `3 branches` and `1 with work`, and in its dialog the chip `feat/report` shows an uncommitted marker `4` and an unpushed marker `2`, whose tooltip names `origin/feat/report` and says it reflects the last fetch

#### Scenario: Branch never pushed
- **WHEN** a worktree's branch has no upstream and 3 commits on no remote
- **THEN** its chip in the branches dialog shows an unpushed marker `3` whose tooltip says the commits are not on any remote

#### Scenario: Detached and stale worktrees
- **WHEN** one worktree has a detached HEAD and another is prunable
- **THEN** in the branches dialog the first chip reads detached instead of a branch name and the second carries the text `stale`

#### Scenario: Dirty main checkout
- **WHEN** the main checkout has 2 uncommitted items and the repository has no linked worktrees
- **THEN** the header shows one chip for the main checkout with an uncommitted marker `2`

#### Scenario: Snapshot without checkout information
- **WHEN** the repository's snapshot predates working-tree status and reports only the current branch `main`
- **THEN** the header shows `main` and no status markers

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
