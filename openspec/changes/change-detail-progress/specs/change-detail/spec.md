# Spec Delta

## MODIFIED Requirements

### Requirement: Detail header shows the change's state
The detail view SHALL show, above the artifacts: the change name in monospace, the repository name linking to that repository's board, a close control, and every warning the snapshot carries for the change. Below them it SHALL show its column; the relative age of its last activity, or its archive date when archived; how long it has been complete when it is in `Done` or `Synced`; its branch badge when `branchMatch` is set, whose tooltip names the worktree the data comes from and lists the other checkouts holding a copy with their branch and column; for an archive found only in a linked worktree, a badge naming the branch that holds it and stating that the main checkout does not have it yet, with a tooltip listing the checkouts still holding an active copy and how to resolve it; when agent sessions apply and a session worktree exists for the change, the work-status badge (uncommitted files, commits not pushed, `pushed` or `merged`, highlighted as stale by the same rules as before), which opens the change's Console tab; the text of its `prompt.md`, without the heading the create form writes, as plain text that scrolls when long; when the change declares dependencies, a *Depends on* list giving each dependency's name and its state in words (`met`, `waiting`, `missing`, `cycle`), headed by whether the change is blocked; and when other active changes depend on it, a *Required by* list of their names. Every name in either list that is a change in the snapshot SHALL link to that change's detail view; a `missing` name SHALL be shown as text, not a link. Status SHALL be conveyed by text as well as colour. All of these SHALL come from the existing snapshot; the detail view MUST NOT introduce facts about a change that the snapshot does not carry, and it SHALL NOT show the change's creation date or schema. Local artifact and task progress SHALL NOT appear as a bar in the header; it SHALL appear in the lifecycle timeline under its corresponding phase. For a change that is gone from the snapshot but whose worktree remains, the header SHALL show only its name, the repository and the close control.

#### Scenario: Header content
- **WHEN** a change `cloud-deployment` of repository `demo-ops` is in `Implementing` with `tasks 4/12`, created `2026-03-02`, last activity 3 days ago and `branchMatch: feat/cloud-deployment`
- **THEN** the header shows `cloud-deployment`, `demo-ops` as a link to that repository's board, a close control, `Implementing`, `updated 3d ago` and the branch badge `feat/cloud-deployment`, and shows neither the creation date, the schema, nor a progress bar

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
- **THEN** the header lists `add-billing-docs` and `add-billing-ui` under *Required by*, each linking to their detail view

#### Scenario: Missing dependency
- **WHEN** a change depends on `add-billing-scheme` and no such change exists
- **THEN** the *Depends on* list shows `add-billing-scheme — missing` as text without a link, and the header shows the warning naming it

#### Scenario: No dependencies
- **WHEN** a change declares no dependencies and nothing depends on it
- **THEN** the header shows neither list

### Requirement: Detail presents a lifecycle timeline above the file tabs
Change detail SHALL show an ordered timeline from Backlog through Drafts, Ready, Implementing, Done, and Archived above the file tabs. Phase nodes SHALL be larger than schema-derived artifact milestones. The current phase, completed steps, available next action, and pending persistence SHALL be distinct in text and appearance. Unknown or optional schema artifacts SHALL NOT fabricate completion. Draft artifact progress SHALL be shown under Drafts, and task progress SHALL be shown under Implementing. Progress controls and phase actions SHALL be centered within their checkpoints.

#### Scenario: Drafting progress
- **WHEN** proposal and specs exist but required tasks are missing
- **THEN** Drafts is current, completed artifact milestones are shown, the missing milestone is labeled, and the artifact progress bar is under Drafts

#### Scenario: Implementation progress
- **WHEN** a change has tasks and is in `Implementing`
- **THEN** its task progress bar is under Implementing, not in the detail header

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

#### Scenario: Optional design remains to draft
- **WHEN** the change is Ready but still has an unfinished optional design artifact
- **THEN** Draft artifacts is placed in the Drafts checkpoint while Implement remains available under Implementing

#### Scenario: Agent sessions disabled
- **WHEN** agent sessions are disabled
- **THEN** the timeline remains readable without presenting an enabled launch action
