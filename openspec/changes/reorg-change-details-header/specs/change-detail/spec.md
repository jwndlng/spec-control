# Spec Delta

## MODIFIED Requirements

### Requirement: Detail header shows the change's state
The detail view SHALL show, above the artifacts: the change name in monospace, the repository name linking to that repository's board, a close control, and every warning the snapshot carries for the change. Below them it SHALL show its column; the relative age of its last activity, or its archive date when archived; how long it has been complete when it is in `Done` or `Synced`; its branch badge when `branchMatch` is set, whose tooltip names the worktree the data comes from and lists the other checkouts holding a copy with their branch and column; for an archive found only in a linked worktree, a badge naming the branch that holds it and stating that the main checkout does not have it yet, with a tooltip listing the checkouts still holding an active copy and how to resolve it; the header SHALL omit facts specific to one session or lifecycle phase; a **Prompt** tab in the detail view when its `prompt.md` has non-empty body text after the generated heading is removed; the tab SHALL show that body as plain text that scrolls when long, and the prompt body MUST NOT appear in the header; when the change declares dependencies, a *Depends on* list giving each dependency's name and its state in words (`met`, `waiting`, `missing`, `cycle`), headed by whether the change is blocked; and when other active changes depend on it, a *Required by* list of their names. Every name in either list that is a change in the snapshot SHALL link to that change's detail view; a `missing` name SHALL be shown as text, not a link. Status SHALL be conveyed by text as well as colour. All of these SHALL come from the existing snapshot; the detail view MUST NOT introduce facts about a change that the snapshot does not carry, and it SHALL NOT show the change's creation date or schema. Local artifact and task progress SHALL NOT appear as a bar in the header; it SHALL appear in the lifecycle timeline under its corresponding phase. For a change that is gone from the snapshot but whose worktree remains, the header SHALL show only its name, the repository and the close control.

#### Scenario: Header content
- **WHEN** a change `cloud-deployment` of repository `demo-ops` is in `Implementing` with `tasks 4/12`, created `2026-03-02`, last activity 3 days ago and `branchMatch: feat/cloud-deployment`
- **THEN** the header shows `cloud-deployment`, `demo-ops` as a link to that repository's board, a close control, `Implementing`, `updated 3d ago` and the branch badge `feat/cloud-deployment`, and shows neither the creation date, the schema, nor a progress bar

#### Scenario: Worktree and other checkouts
- **WHEN** `audit-trail` is `Implementing` in a worktree on `feat/audit-trail` and `Drafts` in the main checkout
- **THEN** its detail header shows the badge `feat/audit-trail`, whose tooltip names the worktree path and lists the main checkout with `Drafts`

#### Scenario: Work status
- **WHEN** a change's session has ended and its worktree holds 3 uncommitted files
- **THEN** the selected session’s Console shows "3 uncommitted" and the detail header omits that status

#### Scenario: Pending archive
- **WHEN** `audit-trail` is archived only in a worktree on `chore/archive-audit-trail`
- **THEN** its detail header names `chore/archive-audit-trail` and says the main checkout does not have the archive yet

#### Scenario: Prompt
- **WHEN** the change has a `prompt.md` reading `# Prompt`, an empty line and `Log every mutation`
- **THEN** the detail view offers a **Prompt** tab, selecting it shows `Log every mutation` as plain text without the heading, and the header does not show the prompt body

#### Scenario: Warnings are surfaced
- **WHEN** the snapshot carries a warning for the change
- **THEN** the warning text is shown in the header

#### Scenario: Archived change
- **WHEN** the detail view is open for an archived change
- **THEN** its artifacts are shown like any other change's, and the header shows its archive date

#### Scenario: Depends on
- **WHEN** the detail view is open for `add-billing-ui`, which depends on `add-billing-schema` (`met`) and `add-billing-api` (`waiting`)
- **THEN** the header says the change is blocked and lists `add-billing-schema — met` and `add-billing-api — waiting`, each linking to that change's detail view

#### Scenario: Required by
- **WHEN** the detail view is open for `add-billing-api`, and `add-billing-ui` and `add-billing-docs` depend on it
- **THEN** the header lists `add-billing-docs` and `add-billing-ui` under *Required by*, each linking to their detail view

#### Scenario: Missing dependency
- **WHEN** a change depends on `add-billing-scheme` and no such change exists
- **THEN** the *Depends on* list shows `add-billing-scheme — missing` as text without a link, and the header shows the warning naming it

#### Scenario: No dependencies
- **WHEN** a change declares no dependencies and nothing depends on it
- **THEN** the header shows neither list

### Requirement: The detail header shows and copies the change's worktree path
The detail header's facts row SHALL show, when the change has a worktree, a worktree badge: a folder glyph and the
worktree's absolute path in monospace. The badge SHALL identify only the linked checkout supplying the snapshot. A main checkout, a non-git repository or a change gone from the snapshot SHALL yield no header path badge. The badge MUST NOT extend beyond its container: a path that does not fit SHALL
be shortened before its last segment with an ellipsis so that its end — the worktree directory's own name — stays readable,
and the full path SHALL be its tooltip.

Activating the adjacent copy icon SHALL write the worktree's absolute path to the clipboard, and nothing else: no `cd`, no quoting,
no whitespace. It SHALL then show for a short while that the path was copied, announced as `Copied`; when the clipboard
refuses the write, it SHALL NOT claim success. Its accessible name SHALL say what it copies (`Copy worktree path
<path>`). The copy icon SHALL be reachable with the keyboard, SHALL NOT open the Console tab, start a session or otherwise
act on the change, and is drawn as quietly as the branch badge. It is derived from the snapshot checkout: showing or copying it writes nothing to any repository, runs no git command and
contacts no other host.

#### Scenario: A change in a linked worktree
- **WHEN** `audit-trail` of `demo-ops` is `Implementing` in a linked worktree at `/w/acme/demo-ops-audit-trail` on `feat/audit-trail`
- **THEN** its detail header shows a worktree badge reading `/w/acme/demo-ops-audit-trail`, and activating its adjacent copy icon puts exactly `/w/acme/demo-ops-audit-trail` on the clipboard and briefly announces `Copied`

#### Scenario: A change with a session worktree
- **WHEN** a change's data comes from the main checkout and an agent session worktree exists for it under the dashboard home
- **THEN** its detail header omits the session path and the selected session’s Console provides it

#### Scenario: Several session worktrees
- **WHEN** a change has two session worktrees, one last active yesterday and one an hour ago
- **THEN** switching Console sessions shows each session’s own path and leaves the header tied to the snapshot checkout

#### Scenario: No worktree
- **WHEN** a change lives only in the main checkout and has no session worktree
- **THEN** its detail header shows no worktree badge

#### Scenario: Long path
- **WHEN** the worktree path is longer than the facts row leaves room for
- **THEN** the badge shows the path's beginning, an ellipsis and the worktree directory's name, stays inside the header, and presents the full path on hover and to a screen reader

#### Scenario: Clipboard refused
- **WHEN** the browser refuses the clipboard write
- **THEN** the badge does not announce `Copied`

### Requirement: The detail view shows a change's implementation model choice
When a change has a recorded implementation model choice, its Implementing timeline phase SHALL show that model as the choice for Implement.

#### Scenario: Recorded choice is shown
- **WHEN** change `cache-api-calls` records `reasoning-model` as its implementation model
- **THEN** its Implementing phase identifies `reasoning-model` as the model selected for Implement

## REMOVED Requirements

### Requirement: The detail header shows the change's pull request
**Reason**: A single PR beside the change name can belong to only one delivery phase.
**Migration**: Follow the proposal, implementation or archive checkpoint for its PR link. Use the Pull requests view for review details and availability diagnostics.

## ADDED Requirements

### Requirement: Phase pull requests stay within their checkpoints
The header above the timeline SHALL omit PR links, titles, readiness, checks, review, fetch times and availability messages. The timeline SHALL continue to associate each known PR with its own delivery checkpoint.

#### Scenario: More than one delivery
- **WHEN** a change has a merged proposal PR and an open implementation PR
- **THEN** each checkpoint links its own PR and the header displays neither PR

#### Scenario: No usable PR data
- **WHEN** the repository has no matching PR or pull requests are unavailable
- **THEN** the header shows no PR row, placeholder or availability message
