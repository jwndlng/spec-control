## MODIFIED Requirements

### Requirement: Board columns follow the lifecycle phases
The board SHALL place each change in exactly one column, where a column names the phase of the lifecycle the change is in. Using, in order: `Archived` if the change is archived; `Done` if `tasks.total > 0` and every task is **settled** — `tasks.done + tasks.awaiting == tasks.total`, a task awaiting validation (`[~]`) counting as settled because the agent is finished with it — whether or not the change's delta specs are already synced into the main specs, with the sub-state `validate` while `tasks.awaiting > 0` and `complete` otherwise; `Implementing` if at least one task is settled (`tasks.done + tasks.awaiting > 0`); `Ready` if every **required** artifact is done (ready to apply, nothing ticked yet); `Unknown` if the change's artifacts could not be read; `Backlog` if no artifact is done; otherwise `Drafts` (at least one artifact is done and at least one required artifact is not). An artifact is required when the change's schema names it in `apply.requires` — the artifacts OpenSpec needs before implementation starts; for `spec-driven` that is `tasks` alone, so `design` (and likewise `proposal` and `specs`) never holds a change back from `Ready`. When a schema declares no `apply.requires`, every artifact of it is required. When the change's artifact statuses do not say which artifacts are required — a snapshot recorded before they did — every artifact SHALL count as required. Which artifacts are done, and in which order they were written, SHALL NOT matter beyond that, and the board SHALL NOT name any artifact itself: every schema is placed by its own `apply.requires`.

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

#### Scenario: Every task settled, some awaiting validation
- **WHEN** a change is not archived and `tasks` is `done: 13, awaiting: 2, total: 15`
- **THEN** it appears in `Done` with the sub-state `validate`, not in `Implementing`

#### Scenario: Only awaiting tasks
- **WHEN** a change is not archived and `tasks` is `done: 0, awaiting: 1, total: 4`
- **THEN** it appears in `Implementing`, not in `Ready`

#### Scenario: Every task awaiting validation
- **WHEN** a change is not archived and `tasks` is `done: 0, awaiting: 3, total: 3`
- **THEN** it appears in `Done` with the sub-state `validate`

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
