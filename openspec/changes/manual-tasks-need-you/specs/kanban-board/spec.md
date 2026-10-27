## MODIFIED Requirements

### Requirement: Cards show only what an overview needs
A card SHALL show only what an overview needs: the change name in monospace, the relative age of `lastActivityAt` under it (e.g. `updated 3d ago`, or the archive date for an archived change), a progress bar, a console quick link in the card's top right corner, and a footer carrying the change's session status and next-step starter as the "Cards offer session starters and show session state" requirement gives them, together with **Show details**.

The change name and its age SHALL have the top of the card to themselves apart from the console quick link, which SHALL occupy a slot of its own at the top right: the name SHALL wrap within the width that slot leaves and SHALL never be shortened or pushed by a badge. A card SHALL NOT show a separate session-status line between the age and the progress bar: the session status sits in the footer, so a card goes from its age straight to its progress bar whether or not it has a session. **Show details** SHALL have the same height and text size as the next-step starter button in the footer, so the two sit on the footer's line as a pair; at rest it keeps its quieter look than the starter. The progress bar SHALL be, for a change in `Drafts`, the drafting progress: the number of the change's artifacts that are done out of all of its schema's artifacts, labelled `done/total Artifacts`, with a tooltip and accessible name that say it counts artifacts (e.g. `2 of 4 artifacts written`); for any other change with tasks (`tasks.total > 0`), the task progress labelled `done/total Tasks`, with a tooltip and accessible name that say it counts tasks. Both bars SHALL share one shape and style; the word after the count is what tells them apart at a glance. A card in `Backlog`, and a card outside `Drafts` without tasks, SHALL show no progress bar. A card whose change is not archived and has tasks that need the user (`- [~]`) SHALL show a **Needs you** badge reading `N need you`; its tooltip and accessible name SHALL list the text of those tasks as the scan reports them (`change-scanner`: "Task progress is derived from tasks.md"), followed by `and N more` when the scan lists fewer than the count, so the user learns what to check or do without opening the change. The badge SHALL be drawn as text, never as HTML or Markdown from the repository. Activating it SHALL open the change's detail view on its tasks artifact. A card SHALL additionally show the `no tasks` warning and an error mark for any other warning the snapshot carries. A card SHALL NOT show the repository name — on the combined board every card sits in its repository's group, whose header names it, and a repository board names it in its header — nor the branch badge, the checkouts holding the change, the worktree's work status, the prompt, how long the change has been complete, whether its specs are synced, or which artifacts are written: the change's detail view shows those (change-detail: "Detail header shows the change's state"), and the column and the progress bar say how far the change has come.

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
- **THEN** its card shows a badge reading `2 need you` and a progress bar labelled `13 + 2 need you / 15 Tasks`, whose accessible name says thirteen tasks are done, two need the user and none are open

#### Scenario: The badge says what to do
- **WHEN** a change's `awaitingTasks` are `Add the API token to the deployment secrets — you: set API_TOKEN` and `Check the retry on a slow network`
- **THEN** the **Needs you** badge's tooltip and accessible name list both texts, and activating the badge opens the change's detail view on its tasks

#### Scenario: More tasks than the scan lists
- **WHEN** a change has `awaiting` `12` and ten `awaitingTasks`
- **THEN** the badge reads `12 need you` and its tooltip lists the ten texts followed by `and 2 more`

#### Scenario: Awaiting segment is not the only cue
- **WHEN** a screen reader reads a card with tasks that need the user
- **THEN** it reads the **Needs you** badge with the tasks' text and a progress label naming the count, without relying on the segment's colour

#### Scenario: No awaiting tasks
- **WHEN** a change has `tasks` `done: 4, awaiting: 0, total: 12`
- **THEN** its card shows no **Needs you** badge and a two-part bar labelled `4/12 Tasks`

