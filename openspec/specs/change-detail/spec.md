# change-detail Specification

## Purpose
Lets the user read one change's OpenSpec artifacts inside the dashboard — its proposal, design, delta specs and tasks — without leaving the board and opening files in the repository by hand.

## Requirements

### Requirement: Change detail route
The UI SHALL provide a client-side route `/repo/<repoId>/change/<changeName>` that shows exactly one change of one tracked repository, for active and archived changes alike. The repository id and the change name SHALL be URL-encoded in the path and decoded when the route is parsed. A path that cannot be decoded, or that names a repository or change absent from the current snapshot, SHALL render a "not found" state that names what was asked for and offers a link to the projects overview; it MUST NOT render a blank page or throw.

A change that the snapshot does not carry but that has a session or a session worktree — the archive worktree of a
change that is already archived, or a worktree adopted from disk — SHALL NOT be treated as not found: the route SHALL
render the detail view with its Console tab, and say in place of the artifacts that the change has none to read here.

The route SHALL work in both routing modes the UI supports (path routing on the dashboard server, hash routing on static hosting).

#### Scenario: Opening a change
- **WHEN** the user opens `/repo/<id>/change/cloud-deployment` for a repository in the snapshot that has a change `cloud-deployment`
- **THEN** the detail view for that change is shown

#### Scenario: Archived change
- **WHEN** the user opens the detail route for a change that is archived
- **THEN** the detail view is shown with its archived state, like any other change

#### Scenario: Unknown change
- **WHEN** the user opens the detail route for a change name that is not in the snapshot and has no session or worktree
- **THEN** a "not found" message naming the repository and the change is shown together with a link back to the overview

#### Scenario: Change gone, session left
- **WHEN** the user opens the detail route for the archive worktree of a change the snapshot no longer carries
- **THEN** the view is shown with a working `Console` tab and an explanation that there are no artifacts to read

#### Scenario: Hash routing
- **WHEN** the UI runs in hash routing mode and the user opens `index.html#/repo/<id>/change/cloud-deployment`
- **THEN** the same detail view is shown

### Requirement: Detail header shows the change's state
The detail view SHALL show, above the artifacts: the change name in monospace, the repository name linking to that repository's board, a close control, and every warning the snapshot carries for the change. Below them it SHALL show the change's state and whereabouts that the card on the board leaves out: its column; its task progress as a bar with `done/total` when tasks exist; the relative age of its last activity, or its archive date when archived; how long it has been complete when it is in `Done` or `Synced`; its branch badge when `branchMatch` is set, whose tooltip names the worktree the data comes from and lists the other checkouts holding a copy with their branch and column; for an archive found only in a linked worktree, a badge naming the branch that holds it and stating that the main checkout does not have it yet, with a tooltip listing the checkouts still holding an active copy and how to resolve it; when agent sessions apply and a session worktree exists for the change, the work-status badge (uncommitted files, commits not pushed, `pushed` or `merged`, highlighted as stale by the same rules as before), which opens the change's Console tab; the text of its `prompt.md`, without the heading the create form writes, as plain text that scrolls when long; when the change declares dependencies, a *Depends on* list giving each dependency's name and its state in words (`met`, `waiting`, `missing`, `cycle`), headed by whether the change is blocked; and when other active changes depend on it, a *Required by* list of their names. Every name in either list that is a change in the snapshot SHALL link to that change's detail view; a `missing` name SHALL be shown as text, not a link. Status SHALL be conveyed by text as well as colour. All of these SHALL come from the existing snapshot; the detail view MUST NOT introduce facts about a change that the snapshot does not carry, and it SHALL NOT show the change's creation date or schema. For a change that is gone from the snapshot but whose worktree remains, the header SHALL show only its name, the repository and the close control.

#### Scenario: Header content
- **WHEN** a change `cloud-deployment` of repository `demo-ops` is in `Implementing` with `tasks 4/12`, created `2026-03-02`, last activity 3 days ago and `branchMatch: feat/cloud-deployment`
- **THEN** the header shows `cloud-deployment`, `demo-ops` as a link to that repository's board, a close control, `Implementing`, a progress bar with `4/12`, `updated 3d ago` and the branch badge `feat/cloud-deployment`, and shows neither the creation date nor the schema

#### Scenario: Worktree and other checkouts
- **WHEN** `audit-trail` is `Implementing` in a worktree on `feat/audit-trail` and `Drafts` in the main checkout
- **THEN** its detail header shows the badge `feat/audit-trail`, whose tooltip names the worktree path and lists the main checkout with `Drafts`

#### Scenario: Work status
- **WHEN** a change's session has ended and its worktree holds 3 uncommitted files
- **THEN** the detail header shows "3 uncommitted", and activating it opens the Console tab

#### Scenario: Pending archive
- **WHEN** `audit-trail` is archived only in a worktree on `chore/archive-audit-trail`
- **THEN** its detail header names `chore/archive-audit-trail` and says the main checkout does not have the archive yet

#### Scenario: Prompt
- **WHEN** the change has a `prompt.md` reading `# Prompt`, an empty line and `Log every mutation`
- **THEN** the header shows `Log every mutation` as plain text, without the heading

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
- **THEN** the header lists `add-billing-docs` and `add-billing-ui` under *Required by*, each linking to its detail view

#### Scenario: Missing dependency
- **WHEN** a change depends on `add-billing-scheme` and no such change exists
- **THEN** the *Depends on* list shows `add-billing-scheme — missing` as text without a link, and the header shows the warning naming it

#### Scenario: No dependencies
- **WHEN** a change declares no dependencies and nothing depends on it
- **THEN** the header shows neither list

### Requirement: The console is a tab of the detail view
Whenever agent sessions apply to the change's repository — agent sessions on and the repository not excluded — the
detail view SHALL offer a **Console** tab beside the artifact tabs, after them, as the last tab of the strip, whether or
not the change has ever had a session. The tab SHALL be selectable whenever it is offered, whatever state the change's
artifacts are in, and MUST NOT carry an artifact state label.

Selecting it SHALL show the selected session's terminal — what the agent printed, as it printed it, with what the
terminal has shown so far before it follows live — together with the session's change, repository, agent, worktree path
and branch, its state, its default responses and its actions: End session or Clean up, Resume when available, Delete
record for an ended session, "Copy cd" for the worktree and **Open in editor** (`editor-launch`) for the folder the
session's agent works in. The terminal SHALL be coloured from the dashboard's theme
tokens and SHALL load nothing from the network. It SHALL follow the size of the panel, and SHALL be the part of the
overlay that scrolls, so the page behind it does not move.

With no session to show the tab SHALL say why and leave the user something to do: for a change whose session worktree
has outlived its session record, that there is no terminal to show while its work is still there, with the worktree's
path, a `cd` to copy and **Open in editor** for that worktree; for a change that has neither a session nor a session worktree, that no agent has worked on it
yet, together with the starters its stage allows. Neither state SHALL show a terminal, and neither MUST be reported as
an error.

When agent sessions are off for the repository, or the repository is excluded from them, no Console tab SHALL be shown
and the detail view MUST look and behave as it did before.

#### Scenario: A change with a session
- **WHEN** the user opens the detail view of a change whose Implement session is running
- **THEN** the tab strip shows `Proposal`, `Design`, `Specs`, `Tasks` and `Console`, and selecting `Console` shows that
  session's terminal with its earlier output, its worktree path and branch, and its actions, **Open in editor** among
  them

#### Scenario: Console is selectable while artifacts are not
- **WHEN** a change has a running session and no artifact file at all
- **THEN** every artifact tab is unselectable and the `Console` tab is selectable and shows the terminal

#### Scenario: A change no agent has worked on
- **WHEN** the user opens the Console tab of a change in `Ready` that has neither a session nor a session worktree
- **THEN** the tab says that no agent has worked on this change yet, offers **Implement**, shows no terminal and reports
  no error

#### Scenario: Starting from the empty console
- **WHEN** the user activates that **Implement** starter
- **THEN** a session starts for the change and the same Console tab shows its terminal

#### Scenario: A worktree without a session record
- **WHEN** the change's session record is gone and its worktree still holds uncommitted work
- **THEN** the Console tab says there is no terminal to show, names the worktree's path, offers a `cd` to copy and offers
  **Open in editor** for that worktree

#### Scenario: Feature off
- **WHEN** agent sessions are disabled
- **THEN** no detail view shows a `Console` tab

#### Scenario: Long output scrolls in the terminal
- **WHEN** the agent has printed more than fits the panel
- **THEN** the output scrolls inside the terminal and the board behind the overlay does not move

### Requirement: The console tab offers the change's next step
The Console tab SHALL be the place the dashboard offers a change's next step while its session runs. For the selected
session it SHALL offer the starters of the change's current stage whose prompt would go into that very session — Draft
and Implement for a session in the change's own worktree — labelled and described as sending the prompt to the running
session, and MUST NOT ask the user for a further key press. When the prompt was typed but not submitted, the tab SHALL
say so as it does for any other text sent on the user's behalf. Archive SHALL open its own session as before, and no
starter SHALL be offered for a session that a prompt cannot reach.

For a change with no session and no session worktree the tab SHALL offer the starters its stage allows as openings for
a new session, disabled with an explanation when the repository's agent is not found on this machine.

In both cases the tab SHALL offer its starters as the same split button a card shows (`kanban-board`: "A change's
actions are one split button"), with the same recommended action and the same menu, limited to the starters a prompt
can reach where a session runs. A **Draft artifacts** item offered in `Ready` SHALL say that it writes the artifacts
not required for implementing, such as a design.

#### Scenario: Draft finished, Implement next
- **WHEN** a Draft session is still running, the change has moved to `Ready`, and its Console tab is open
- **THEN** the tab offers **Implement**, saying it sends the prompt to this session, and activating it types that prompt
  into the terminal without asking the user for another key press

#### Scenario: The prompt was not sent
- **WHEN** the next step is sent to a session whose agent never shows the typed prompt
- **THEN** the Console tab says that the text was typed but not sent, and the session keeps running

#### Scenario: Nothing a prompt can reach
- **WHEN** the selected session is the change's Archive session
- **THEN** the tab offers no next-step starter for it

#### Scenario: The agent is missing
- **WHEN** a change has no session and the repository's agent executable is not found
- **THEN** the Console tab's starters are disabled and say that the agent was not found

#### Scenario: Drafting a design for a ready change
- **WHEN** a change is in `Ready`, its optional `design.md` is not written, and it has no session
- **THEN** its Console tab's split button shows **Implement**, and its menu offers **Draft artifacts**, described as writing the artifacts not required for implementing

#### Scenario: Waiting pull request keeps the menu
- **WHEN** a change in `Implementing` links an open pull request whose checks are running and it has no running session
- **THEN** its Console tab's main part says it waits for the checks, and its menu offers **Implement**

### Requirement: The console tab selects among the change's sessions
A change MAY have more than one session at a time — its own session and the session of its archive worktree run in
separate worktrees. When it has more than one, the Console tab SHALL list them with their action, branch and live
state, most recent first, and show the selected one; with a single session the list MAY be omitted. The most recently
active session SHALL be selected by default.

The selected session SHALL be part of the URL, so the console can be linked to and survives a reload, alongside the
selected tab. A URL naming a session the change does not have SHALL fall back to the default selection without an
error. Typing, default responses and next-step prompts MUST reach only the selected session.

#### Scenario: Two sessions
- **WHEN** a change has a running Implement session and a running Archive session
- **THEN** the Console tab lists both with their branch and state and shows the more recently active one

#### Scenario: Selection is linkable
- **WHEN** the user selects the Console tab and its second session and reloads the page
- **THEN** the same tab and the same session are shown again, with that session's earlier output

#### Scenario: Stale session in the URL
- **WHEN** a URL names a session id the change does not have
- **THEN** the Console tab opens on the change's most recently active session and no error is reported

#### Scenario: Input reaches only the selected session
- **WHEN** the change has two sessions and the user activates a default response
- **THEN** only the selected session's terminal receives it

### Requirement: The console tab shows work status and offers Ship
The Console tab SHALL show the work status of the selected session's worktree and a Ship button while that status is
`uncommitted`, `unpushed` or `pushed`, naming what it will do. For `merged` it SHALL suggest removing the worktree, and
the clean-up dialog SHALL preselect removal.

#### Scenario: Ship from the console
- **WHEN** the user presses Ship on the Console tab of an ended session with uncommitted work
- **THEN** the agent starts in the terminal with the Ship prompt

#### Scenario: Merged
- **WHEN** the Console tab is opened for a session whose worktree is `merged`
- **THEN** Ship is not offered and removal of the worktree is suggested

### Requirement: The console tab reads as a console
The Console tab and the panel below it SHALL carry the dashboard's informational accent — the blue the token set
already owns — on the tab itself and on the panel's frame and header, so the console is recognisable as a different
kind of surface from the artifact tabs, which keep their existing colours. The accent SHALL come from the theme tokens
so that both themes apply, and MUST NOT be the only cue: the tab keeps its label `Console`.

The accent MUST NOT be a colour that means "running", "uncommitted", "complete", "needs attention" or "error", and MUST
NOT be a colour a repository can be assigned.

#### Scenario: Console tab stands out
- **WHEN** the detail view is open on the Console tab
- **THEN** the tab and the panel's frame carry the informational accent while the artifact tabs keep theirs, and the
  tab still reads `Console`

#### Scenario: Both themes
- **WHEN** the user switches from the dark to the light theme with the Console tab open
- **THEN** the accent follows the theme and the tab's label keeps a contrast ratio of at least 4.5:1

### Requirement: Artifacts are browsable as tabs
The detail view SHALL show one tab per artifact of the change's schema, in the schema's artifact order, labelled with the artifact's display name, and — when agent sessions apply to the change's repository — the Console tab after them. Each artifact tab SHALL show the artifact's state (`done`, `ready` or `blocked`). An artifact tab whose artifact has no file yet SHALL NOT be selectable; selecting it SHALL be impossible and its state SHALL be readable from the tab.

An artifact that resolves to more than one file — the delta specs under `specs/**` — SHALL additionally show a list of its files, by path relative to the change directory, with the first file selected by default. Selecting a file SHALL show that file.

The selected tab and the selected file SHALL be part of the URL, so the view can be linked to and survives a reload. A URL naming an artifact or a file that does not exist SHALL fall back to the first artifact that has content, without an error; a URL naming the Console tab for a change whose repository agent sessions do not apply to SHALL fall back the same way.

#### Scenario: Tabs in schema order
- **WHEN** a `spec-driven` change has `proposal` and `specs` done, `design` ready and `tasks` blocked
- **THEN** the view shows the tabs `Proposal`, `Specs`, `Design`, `Tasks` in the schema's order, with `Design` and `Tasks` not selectable and labelled `ready` and `blocked`

#### Scenario: Console comes last
- **WHEN** that change's repository has agent sessions enabled
- **THEN** `Console` is shown after `Tasks` and carries no artifact state

#### Scenario: Delta specs file list
- **WHEN** the selected artifact is `specs` and the change has `specs/dashboard-api/spec.md` and `specs/kanban-board/spec.md`
- **THEN** both paths are listed, the first is selected, and selecting the second shows its content

#### Scenario: Selection is linkable
- **WHEN** the user selects the `specs` artifact and its file `specs/kanban-board/spec.md` and reloads the page
- **THEN** the same artifact and file are selected again

#### Scenario: Stale link
- **WHEN** a URL names an artifact or a file that the change does not have
- **THEN** the first artifact with content is shown and no error is reported

#### Scenario: Console in the URL with the feature off
- **WHEN** a URL names the Console tab for a change in a repository agent sessions do not apply to
- **THEN** the first artifact with content is shown and no error is reported

### Requirement: Artifact content is rendered as Markdown
The selected file's content SHALL be rendered as Markdown, supporting at least headings, paragraphs, ordered and unordered lists, nested lists, task list items, tables, fenced and inline code, block quotes, horizontal rules, emphasis, strong emphasis and links. Rendering SHALL happen entirely in the browser from the file's text; no Markdown is rendered on the server.

#### Scenario: Structured document
- **WHEN** a spec file containing headings, a table, a fenced code block and nested lists is shown
- **THEN** each of those is rendered as the corresponding structure, not as literal Markdown source

#### Scenario: Code is not reflowed
- **WHEN** a fenced code block is shown
- **THEN** its content keeps its line breaks and leading whitespace in a monospace font

### Requirement: Repository content is treated as untrusted
Artifact content comes from tracked repositories and MUST be treated as untrusted input. The renderer MUST NOT interpret raw HTML in the Markdown source: HTML tags SHALL either be shown as text or be dropped, and MUST NOT become elements, attributes, scripts, styles or event handlers in the page. The renderer MUST NOT load any remote resource — images, scripts, stylesheets, fonts or frames — from artifact content, whatever the source says.

A link in artifact content SHALL be rendered as a link only when its target uses `http:`, `https:` or `mailto:`, or is relative; any other target (including `javascript:` and `data:`) SHALL be rendered as plain text. Rendered links SHALL open in a new tab and SHALL NOT send a referrer or expose the opener.

#### Scenario: Script tag in an artifact
- **WHEN** a proposal contains `<script>alert(1)</script>` or `<img src=x onerror=alert(1)>`
- **THEN** no script runs, no request is made, and no element with an event handler is created

#### Scenario: Markdown image
- **WHEN** an artifact contains `![diagram](https://example.com/a.png)`
- **THEN** no request to `example.com` is made and the image is not embedded

#### Scenario: Dangerous link target
- **WHEN** an artifact contains `[click](javascript:alert(1))`
- **THEN** the text is shown without a link

#### Scenario: External link
- **WHEN** an artifact contains `[docs](https://example.com/docs)`
- **THEN** the link opens in a new tab without sending a referrer and without giving the opened page access to the dashboard window

### Requirement: Raw source can be shown
The detail view SHALL offer a toggle that shows the selected file's source text verbatim in a monospace block instead of the rendered Markdown, and back. The choice SHALL apply to whichever file is selected.

#### Scenario: Toggle to raw
- **WHEN** the user turns the raw toggle on
- **THEN** the file's source text is shown unrendered, with its Markdown syntax visible

#### Scenario: Raw survives a file change
- **WHEN** the raw toggle is on and the user selects another file
- **THEN** that file is also shown as raw source

### Requirement: Tasks are shown as a read-only checklist
When the tasks artifact is selected, its task list SHALL be rendered as checkboxes reflecting each task's state, together with the same progress the card shows. A task SHALL be drawn in one of three states: **done**, ticked; **awaiting validation** (`- [~]`), a third state that is neither ticked nor empty and is announced as mixed rather than as done or not done; and **open**, empty. Where any task awaits validation, the view SHALL say in words how many do. The checkboxes MUST NOT be operable in any state: the dashboard MUST NOT write a change to the repository from this view.

#### Scenario: Checklist
- **WHEN** the tasks artifact has 12 tasks of which 4 are ticked
- **THEN** 12 checkboxes are shown with the first-ticked 4 checked and `4/12` is shown

#### Scenario: Awaiting validation
- **WHEN** the tasks artifact has 15 tasks of which 13 are ticked and 2 are `- [~]`
- **THEN** 15 checkboxes are shown, the 2 awaiting ones are drawn in the third state and announced as mixed, and the view says that 2 tasks await validation

#### Scenario: Not editable
- **WHEN** the user clicks a checkbox in the tasks view, in any of the three states
- **THEN** nothing is sent to the server and the repository is unchanged

### Requirement: Navigation between board and detail view
Each board card SHALL open the detail view for its change through its **Show details** action, which carries the board and its filters. The detail view SHALL offer a way back to the board it was opened from with that board's filters intact; when the detail view was opened directly by URL, it SHALL lead to the board of its repository. Opening **Show details** in a new tab or window SHALL land on the same detail view.

#### Scenario: From a filtered board
- **WHEN** the user has filtered the combined board to a text search, opens a card's detail view and then closes it
- **THEN** the combined board is shown again with the same search applied

#### Scenario: Opened by URL
- **WHEN** the detail view is opened directly from a pasted URL
- **THEN** closing it leads to the board of that change's repository

#### Scenario: New tab
- **WHEN** the user middle-clicks or ⌘-clicks a card's **Show details**
- **THEN** a new tab opens on that change's detail view

### Requirement: The detail view follows the regular refresh
The detail view SHALL take the change's header information from the same snapshot the boards use and SHALL re-read the selected file's content whenever that snapshot is renewed, so that ticking a task or editing an artifact on disk becomes visible without a manual reload. That is the poll interval while auto-refresh is off, the auto-refresh interval while one is chosen, and a manual Refresh in either case: the detail view SHALL NOT keep a refresh cadence of its own. The selected artifact, the selected file, the selected session, the raw toggle and the scroll position MUST NOT be reset by a refresh that does not change the content, however often the refresh happens. A refresh MUST NOT detach, restart or clear the terminal of the Console tab.

#### Scenario: Task ticked on disk
- **WHEN** a task is ticked in the repository while the tasks artifact is shown
- **THEN** the checklist and the progress update on the next poll without a page reload

#### Scenario: Refresh keeps the view
- **WHEN** a poll returns unchanged content while the user is reading the third spec file
- **THEN** the same file stays selected and the view does not jump

#### Scenario: Refresh keeps the terminal
- **WHEN** a poll completes while the Console tab is shown
- **THEN** the terminal keeps its output, its scroll position and its connection

#### Scenario: Artifact added on disk
- **WHEN** an artifact file is created in the repository while the detail view is open
- **THEN** its tab becomes selectable after the next scan

#### Scenario: The detail view follows auto-refresh
- **WHEN** auto-refresh is `2s`, the detail view is open, and a task is ticked in the repository
- **THEN** the checklist updates within about two seconds, without the user clicking Refresh

#### Scenario: A fast cadence does not disturb reading
- **WHEN** auto-refresh is `2s` and the user reads a long spec file that nobody is editing
- **THEN** the selected artifact, the selected file, the raw toggle and the scroll position stay exactly as the user left them across every refresh

### Requirement: Empty and error states
When the selected file cannot be read, the view SHALL show a message naming the file and the reason, and the rest of the view SHALL stay usable. When the file exceeds the server's size cap, the view SHALL say so and offer an action that copies the file's absolute path instead of the content. When a change has no artifact file at all, the view SHALL show its header with an explanation that nothing has been written yet.

#### Scenario: File too large
- **WHEN** the selected file exceeds the server's size cap
- **THEN** the view explains that the file is too large to display and offers "Copy file path", which copies the file's absolute path

#### Scenario: Read error
- **WHEN** the server answers with an error for the selected file
- **THEN** the reason is shown in the content area and the tabs and the header remain usable

#### Scenario: Nothing written yet
- **WHEN** a change directory exists with no artifact file
- **THEN** the header is shown and the content area explains that this change has no artifacts yet

### Requirement: The detail view is an overlay over its board
The detail view SHALL be presented as an overlay: the board it belongs to — the board it was opened from, or the board of the change's repository when it was opened directly by URL — SHALL stay rendered behind it under a dimmed backdrop, and the overlay SHALL sit above the rest of the page. The overlay SHALL fill a bounded area of the window rather than the whole viewport, so that the board behind it stays recognisable.

The overlay SHALL be dismissed by its close control, by pressing `Escape` and by activating the backdrop, each returning to the board behind it with that board's filters intact — the same target the back link leads to. Dismissing the overlay MUST NOT reload the board or reset its filters, its minimized groups or its scroll position.

While the keyboard focus is inside the terminal of the Console tab, `Escape` SHALL be delivered to the agent and MUST NOT dismiss the overlay; the close control and the backdrop keep dismissing it, and `Escape` with the focus anywhere else in the overlay keeps dismissing it. While the dismiss confirmation is open, `Escape` and activating outside it SHALL close only the confirmation, and the overlay stays open.

While the overlay is open the board behind it MUST NOT be operable: it MUST NOT take keyboard focus and its cards, filters and controls MUST NOT react to pointer input. Opening the overlay SHALL move the keyboard focus into it; dismissing it SHALL return the focus to the page. The overlay SHALL be exposed as a modal dialog with an accessible name naming the change.

The overlay MUST NOT end, pause or hide any agent session, and MUST NOT write anything to a repository except by dismissing the change after the user confirmed it, as specified in the `change-dismissal` capability. Dismissing it while a session is shown MUST NOT end that session: the agent keeps running and its card keeps showing the session badge.

The change's own content — the artifact tabs, the file list, the artifact text and the terminal — SHALL scroll inside the overlay; the page behind it MUST NOT scroll in its place.

#### Scenario: Board stays visible behind
- **WHEN** the user opens the detail view of a card on a filtered combined board
- **THEN** the overlay is shown over that board, dimmed behind it, with the board's cards still in place

#### Scenario: Escape closes
- **WHEN** the overlay is open on an artifact tab and the user presses `Escape`
- **THEN** the overlay closes and the board it was opened from is shown again with the same filters

#### Scenario: Escape reaches the agent
- **WHEN** the Console tab is selected, the keyboard focus is in the terminal and the user presses `Escape`
- **THEN** the agent receives it and the overlay stays open

#### Scenario: Escape outside the terminal still closes
- **WHEN** the Console tab is selected, the keyboard focus is on the tab strip and the user presses `Escape`
- **THEN** the overlay closes

#### Scenario: Escape closes the confirmation first
- **WHEN** the dismiss confirmation is open and the user presses `Escape`
- **THEN** the confirmation closes, nothing is deleted, and the detail view stays open

#### Scenario: Backdrop closes
- **WHEN** the user activates the dimmed area outside the overlay
- **THEN** the overlay closes and the same board is shown again

#### Scenario: Closing does not end the session
- **WHEN** the user closes the overlay while the agent is working
- **THEN** the agent keeps running and the card keeps showing the session badge

#### Scenario: Opened by URL
- **WHEN** the detail view is opened directly from a pasted URL
- **THEN** the board of that change's repository is shown behind the overlay, and closing it lands there

#### Scenario: The board behind is inert
- **WHEN** the overlay is open and the user clicks where a card or a filter sits behind it, or tabs through the page
- **THEN** nothing on the board reacts and the focus stays inside the overlay

#### Scenario: Long artifact scrolls inside the overlay
- **WHEN** the selected file is longer than the overlay
- **THEN** its text scrolls within the overlay and the board behind it does not move

### Requirement: The detail header offers Dismiss change
The detail header SHALL offer **Dismiss change** for a change that is not archived and whose directory the snapshot places in the repository's main checkout — its own checkout or one of its other checkouts is the main checkout. It SHALL be set apart from the change's facts and drawn as a quiet control that reads as destructive only on hover or focus, so that it is not mistaken for a next step. For an active change held only by linked worktrees it SHALL be shown disabled, with a tooltip naming the worktree's branch and saying that such a change leaves the board when that worktree is removed. It SHALL NOT be shown for an archived change, for a change that is gone from the snapshot, or in the repository's failed or disabled state. Activating it SHALL open the dismiss confirmation of the `change-dismissal` capability inside the detail view. After a successful dismissal the detail view SHALL close to the board it was opened from — unless a linked worktree still holds the change, in which case it stays open on the copy now shown — and a short notice SHALL say that the change was dismissed and whether its removal was staged.

#### Scenario: Offered for a draft
- **WHEN** the detail view is open for `lint-rules` in `Drafts`, whose directory is in the main checkout
- **THEN** the header offers **Dismiss change**

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

### Requirement: The detail header shows the change's pull request
When a change has a linked pull request (`pull-requests`: "A pull request is linked to a change by its head branch"), the detail header SHALL show it beside the branch the match was made on: `#<number>`, the title as a link opening the pull request on GitHub in a new browser tab, its state (draft, open, merged or closed), its review decision, its checks summary and, when it conflicts with its base, that it has conflicts. For an open pull request it SHALL also show its readiness (`pull-requests`: "A linked open pull request has a readiness") — `ready`, or the one reason it is not ready — in the same words and roles the card uses, with the time its list was last fetched. Each SHALL be conveyed as text or a symbol with a tooltip and never by colour alone, using the same symbols the Pull requests view uses so that the two read alike.

When the change has no linked pull request the header SHALL show the branch as it does today and nothing in place of the pull request. When pull requests are unavailable for the repository the header SHALL say so once, quietly, with the reason the `pull-requests` capability gives — the detail view is where a user who wonders why a card shows no pull request will look.

The header MUST NOT offer any action on the pull request: the dashboard stays read-only towards GitHub. The detail view does not run the pull-request watch: it shows the readiness of the last fetch.

#### Scenario: Header with a pull request
- **WHEN** the detail view is open for a change whose branch `feat/add-validate-phase` has open pull request `#125`, approved, with passing checks, mergeable
- **THEN** the header shows `#125` with its title as a link, that it is open, that it is approved, that its checks pass and that it is ready, beside the branch

#### Scenario: Header with a conflicting pull request
- **WHEN** the change's open pull request `#125` has passing checks and conflicts with its base
- **THEN** the header shows that `#125` has conflicts and is not ready, with when that was last fetched

#### Scenario: Header without a pull request
- **WHEN** the change's branch has no cached pull request
- **THEN** the header shows the branch and nothing in place of a pull request

#### Scenario: Unavailable is explained here
- **WHEN** `gh` is not signed in and the detail view is open
- **THEN** the header says once that pull requests are unavailable, with the reason

#### Scenario: No actions
- **WHEN** the header shows a pull request awaiting review
- **THEN** it offers no way to approve, merge, comment on or close it

#### Scenario: Checks and review are not colour alone
- **WHEN** a screen reader reads the header of a change whose pull request has failing checks
- **THEN** it reads that the checks are failing and that the pull request is not ready

### Requirement: The detail header copies the change's reference
The detail header SHALL offer, directly after the change name, a copy control drawn as a copy icon. Activating it SHALL write the change's reference — the repository's name as the header shows it, a slash, and the change name, e.g. `demo-ops/cloud-deployment` — to the clipboard, and nothing else: no whitespace, no path, no quoting. It SHALL then show for a short while, as a check mark with the text `Copied` as its tooltip and accessible name, that the reference was copied; when the clipboard refuses the write, it SHALL NOT claim success. Because the control is an icon only, its tooltip and accessible name SHALL name what it copies (`Copy demo-ops/cloud-deployment`). The control SHALL be offered for every change the header names, including an archived change and a change gone from the snapshot whose worktree remains. It SHALL NOT shorten or move the change name or the repository link, and it SHALL NOT be mistaken for the change's next step: it is drawn as quietly as the close control. Copying writes nothing to any repository and contacts no other host.

#### Scenario: Copying the reference from the header
- **WHEN** the detail view of `cloud-deployment` in repository `demo-ops` is open and the user activates the copy icon next to the name
- **THEN** the clipboard holds exactly `demo-ops/cloud-deployment` and the icon briefly shows a check mark announced as `Copied`

#### Scenario: Named for assistive technology
- **WHEN** a screen reader reaches the copy icon in the header of `cloud-deployment` in `demo-ops`
- **THEN** it reads `Copy demo-ops/cloud-deployment`

#### Scenario: A change gone from the snapshot
- **WHEN** the header shows only the name, the repository and the close control because the change is gone but its worktree remains
- **THEN** the copy icon is still offered next to the name

#### Scenario: Clipboard refused
- **WHEN** the browser refuses the clipboard write
- **THEN** the icon does not switch to the check mark and does not announce `Copied`

### Requirement: The detail header shows and copies the change's worktree path
The detail header's facts row SHALL show, when the change has a worktree, a worktree badge: a folder glyph and the
worktree's absolute path in monospace. The worktree SHALL be, in this order: the linked worktree the change's data comes
from (the snapshot's `checkout`, when it is not the main checkout); otherwise the change's session worktree under the
dashboard home, and of several the one with the most recent activity. A change whose data comes from the main checkout
and that has no session worktree, a change of a repository that is not a git repository, and a change gone from the
snapshot SHALL show no worktree badge. The badge MUST NOT extend beyond its container: a path that does not fit SHALL
be shortened before its last segment with an ellipsis so that its end — the worktree directory's own name — stays readable,
and the full path SHALL be its tooltip.

Activating the badge SHALL write the worktree's absolute path to the clipboard, and nothing else: no `cd`, no quoting,
no whitespace. It SHALL then show for a short while that the path was copied, announced as `Copied`; when the clipboard
refuses the write, it SHALL NOT claim success. Its accessible name SHALL say what it copies (`Copy worktree path
<path>`). The badge SHALL be reachable with the keyboard, SHALL NOT open the Console tab, start a session or otherwise
act on the change, and is drawn as quietly as the branch badge. It is derived from the snapshot and the session
worktree list the view already has: showing or copying it writes nothing to any repository, runs no git command and
contacts no other host.

#### Scenario: A change in a linked worktree
- **WHEN** `audit-trail` of `demo-ops` is `Implementing` in a linked worktree at `/w/acme/demo-ops-audit-trail` on `feat/audit-trail`
- **THEN** its detail header shows a worktree badge reading `/w/acme/demo-ops-audit-trail`, and activating it puts exactly `/w/acme/demo-ops-audit-trail` on the clipboard and briefly announces `Copied`

#### Scenario: A change with a session worktree
- **WHEN** a change's data comes from the main checkout and an agent session worktree exists for it under the dashboard home
- **THEN** its detail header shows that session worktree's path as the worktree badge

#### Scenario: Several session worktrees
- **WHEN** a change has two session worktrees, one last active yesterday and one an hour ago
- **THEN** the worktree badge shows the one active an hour ago

#### Scenario: No worktree
- **WHEN** a change lives only in the main checkout and has no session worktree
- **THEN** its detail header shows no worktree badge

#### Scenario: Long path
- **WHEN** the worktree path is longer than the facts row leaves room for
- **THEN** the badge shows the path's beginning, an ellipsis and the worktree directory's name, stays inside the header, and presents the full path on hover and to a screen reader

#### Scenario: Clipboard refused
- **WHEN** the browser refuses the clipboard write
- **THEN** the badge does not announce `Copied`
