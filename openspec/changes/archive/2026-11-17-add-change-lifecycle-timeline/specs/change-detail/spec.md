## ADDED Requirements

### Requirement: Detail presents a lifecycle timeline above the file tabs
Change detail SHALL show an ordered timeline from Backlog through Drafts, Ready, Implementing, Done, and Archived above the file tabs. Phase nodes SHALL be larger than schema-derived artifact milestones. The current phase, completed steps, available next action, and pending persistence SHALL be distinct in text and appearance. Unknown or optional schema artifacts SHALL NOT fabricate completion.

#### Scenario: Drafting progress
- **WHEN** proposal and specs exist but required tasks are missing
- **THEN** Drafts is current, completed artifact milestones are shown, and the missing milestone is labeled

#### Scenario: Archive pending delivery
- **WHEN** an archive exists locally but its PR is still open
- **THEN** Archived is locally complete and its persistence is labeled pending with a PR link

#### Scenario: Alternate schema and validation
- **WHEN** the framework has different artifact names or a validation milestone
- **THEN** milestones derive from that schema and validation state instead of a hardcoded proposal/design/specs sequence

### Requirement: The timeline carries the next lifecycle action
The timeline SHALL present the available Draft artifacts, Implement, or Archive action at its corresponding phase, using the existing server eligibility and session handoff rules. It SHALL expose one primary next action, explain unavailable actions, and route blocked delivery to its recovery action. The detail view SHALL NOT duplicate these lifecycle controls in its console toolbar.

#### Scenario: Ready to implement
- **WHEN** the change is Ready and implementation is available
- **THEN** Implement is the timeline's primary action and launching it uses the existing agent selection and confirmed session handoff

#### Scenario: Agent sessions disabled
- **WHEN** agent sessions are disabled
- **THEN** the timeline remains readable without presenting an enabled launch action

### Requirement: Maintenance actions are progressively disclosed
Resume, Clean up, Delete record, and Open in editor SHALL be available from a labeled session actions menu for the selected session when applicable. Their eligibility and confirmations SHALL be retained. The visible worktree path SHALL have an adjacent keyboard-accessible copy icon with success/failure feedback; detail SHALL NOT show a separate Copy cd text button.

#### Scenario: Ended session
- **WHEN** a resumable ended session is selected
- **THEN** Resume is available in its actions menu without competing with the lifecycle action

#### Scenario: Copy path
- **WHEN** the user activates the icon beside a worktree path
- **THEN** exactly the absolute path is copied, success is announced only after a successful clipboard write, and no command runs

#### Scenario: Small screen and keyboard
- **WHEN** detail is viewed at narrow width or navigated by keyboard
- **THEN** timeline labels, artifact tabs, menus, and copy controls remain reachable with visible focus and no page-wide horizontal overflow

## MODIFIED Requirements

### Requirement: The console tab offers the change's next step
The Console tab SHALL be the place the dashboard offers a change's next step while its session runs. For the selected
session it SHALL offer the starters of the change's current stage whose prompt would go into that very session — Draft
and Implement for a session in the change's own worktree — labelled and described as sending the prompt to the running
session, and MUST NOT ask the user for a further key press. When the prompt was typed but not submitted, the tab SHALL
say so as it does for any other text sent on the user's behalf. Archive SHALL open its own session as before, and no
starter SHALL be offered for a session that a prompt cannot reach.

For a running **Draft artifacts** session on `docs/<change>` the tab SHALL offer Draft as sent into that session and
every other starter the stage allows but Fast-forward as **ending the proposal session and starting** that action —
labelled and described so, never as sending the prompt to this session — so the tab always offers the change's next
step. Activating one SHALL open the action asking to end the proposal session first (`agent-sessions`: "The proposal
session gives way to the next step") and then show the new session. When the proposal worktree's work status is
`uncommitted` or `unpushed`, it SHALL first ask one confirmation saying that the proposal is not pushed yet and that its
worktree and branch are kept; for any other work status it SHALL ask nothing, since ending it loses nothing.

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

#### Scenario: Proposal finished, Implement next
- **WHEN** the Draft session of `rotate-keys` runs on `docs/rotate-keys`, its proposal is pushed, the change has moved to
  `Ready`, and its Console tab is open
- **THEN** the split button shows **Implement**, described as ending the proposal session and starting Implement;
  activating it asks nothing, ends that session, starts Implement on `feat/rotate-keys` and shows it in the tab

#### Scenario: Proposal not pushed yet
- **WHEN** the same holds but the `docs-rotate-keys` worktree has uncommitted files
- **THEN** activating **Implement** first asks for confirmation, saying the proposal is not pushed and its worktree is kept,
  and cancelling ends nothing

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

The lifecycle controls described in this requirement SHALL be placed in the timeline, and SHALL NOT be duplicated in the console toolbar. Existing eligibility, session reuse, and handoff behavior SHALL apply.

### Requirement: The detail header shows and copies the change's worktree path
The detail header's facts row SHALL show, when the change has a worktree, a worktree badge: a folder glyph and the
worktree's absolute path in monospace. The worktree SHALL be, in this order: the linked worktree the change's data comes
from (the snapshot's `checkout`, when it is not the main checkout); otherwise the change's session worktree under the
dashboard home, and of several the one with the most recent activity. A change whose data comes from the main checkout
and that has no session worktree, a change of a repository that is not a git repository, and a change gone from the
snapshot SHALL show no worktree badge. The badge MUST NOT extend beyond its container: a path that does not fit SHALL
be shortened before its last segment with an ellipsis so that its end — the worktree directory's own name — stays readable,
and the full path SHALL be its tooltip.

Activating the adjacent copy icon SHALL write the worktree's absolute path to the clipboard, and nothing else: no `cd`, no quoting,
no whitespace. It SHALL then show for a short while that the path was copied, announced as `Copied`; when the clipboard
refuses the write, it SHALL NOT claim success. Its accessible name SHALL say what it copies (`Copy worktree path
<path>`). The copy icon SHALL be reachable with the keyboard, SHALL NOT open the Console tab, start a session or otherwise
act on the change, and is drawn as quietly as the branch badge. It is derived from the snapshot and the session
worktree list the view already has: showing or copying it writes nothing to any repository, runs no git command and
contacts no other host.

#### Scenario: A change in a linked worktree
- **WHEN** `audit-trail` of `demo-ops` is `Implementing` in a linked worktree at `/w/acme/demo-ops-audit-trail` on `feat/audit-trail`
- **THEN** its detail header shows a worktree badge reading `/w/acme/demo-ops-audit-trail`, and activating its adjacent copy icon puts exactly `/w/acme/demo-ops-audit-trail` on the clipboard and briefly announces `Copied`

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
