## MODIFIED Requirements

### Requirement: Task progress is derived from tasks.md
The scanner SHALL count task checkboxes in the change's tasks artifact, recognising `- `, `* `, `+ ` and ordered-list markers, and three checkbox states: **done** (`[x]`, case-insensitive), **needs the user** (`[~]`, also called awaiting) and **open** (`[ ]`). Spacing inside the brackets SHALL NOT matter. It SHALL report `done` (the done boxes only), `awaiting` (the `[~]` boxes) and `total` (all three states together), so that `done + awaiting <= total` and a task awaiting validation is never counted as done. A marker the scanner does not recognise SHALL be counted as open, never as done. When the tasks artifact does not exist, `tasks` MUST be `null`.

Which lines are tasks SHALL be decided exactly as the `openspec` CLI the dashboard is built with decides it for its own progress and archive checks, so that `done + awaiting` and `total` agree with the CLI's completed and total counts whenever the file holds no `[~]` box: optional leading whitespace, a list marker (`-`, `*`, `+`, or one to nine digits followed by `.` or `)`), optional whitespace — none is required between the marker and the bracket — and then either a box holding at most one non-whitespace character, with any spacing inside, whose closing `]` is **not** followed by `(` or `[`, or a box holding only whitespace, which counts wherever it is followed. A bracketed single character followed by `(` or `[` — a Markdown link or reference-link bullet such as `- [x](notes.md)` or `- [A](./design.md)` — SHALL NOT be a task. The CLI's counts are the only reference: `[~]` is the one addition, and it SHALL change only which state a line counts as, never whether it counts.

`- [~]` SHALL mean that a task **needs the user**: the agent has done every part of it it can, and a person still has to verify the result or carry out a step only they can. Both cases are one state and are counted alike; the scanner does not tell them apart. The scanner only reports it; the dashboard MUST NOT write, tick or clear a checkbox in any repository.

With the counts the scanner SHALL report `awaitingTasks`, the text of the change's `[~]` tasks in file order, so that a card can say what the user has to do without its tasks artifact being opened. Each entry SHALL be the task's line after the checkbox, with surrounding whitespace removed, as plain text — never interpreted as HTML or rendered as Markdown by the scanner — and shortened to at most 200 characters, ending with an ellipsis when shortened. At most 10 entries SHALL be reported; `awaiting` stays the full count, so a consumer can say how many are not listed. A change without `[~]` tasks SHALL report no `awaitingTasks`. Like the counts, the list is derived from the repository on every scan and is never an input to a column decision beyond the counts.

#### Scenario: Mixed markers
- **WHEN** `tasks.md` contains `- [x] a`, `* [ ] b`, `1. [X] c`
- **THEN** progress is `done: 2, awaiting: 0, total: 3`

#### Scenario: Tasks awaiting validation
- **WHEN** `tasks.md` contains thirteen `- [x]` tasks and two `- [~]` tasks
- **THEN** progress is `done: 13, awaiting: 2, total: 15`

#### Scenario: What the user has to do is reported
- **WHEN** `tasks.md` contains `- [x] 1.1 Add the client`, `- [~] 1.2 Add the API token to the deployment secrets — you: set API_TOKEN in the alpha-infra project` and `- [~] 1.3 Check the retry on a slow network`
- **THEN** `awaitingTasks` is `1.2 Add the API token to the deployment secrets — you: set API_TOKEN in the alpha-infra project` and `1.3 Check the retry on a slow network`, in that order

#### Scenario: The list is bounded
- **WHEN** `tasks.md` contains twelve `- [~]` tasks, one of them 500 characters long
- **THEN** `awaiting` is `12`, `awaitingTasks` has 10 entries, and the long one is shortened to 200 characters ending with an ellipsis

#### Scenario: Awaiting is not done
- **WHEN** `tasks.md` contains `- [x] a` and `- [~] b`
- **THEN** progress is `done: 1, awaiting: 1, total: 2`, and `done` is not `2`

#### Scenario: Unknown marker
- **WHEN** `tasks.md` contains `- [-] a`
- **THEN** the task is counted as open: `done: 0, awaiting: 0, total: 1`

#### Scenario: Link bullets are not tasks
- **WHEN** `tasks.md` contains `- [x] a`, `- [ ] b`, `- [a](./a.md)`, `- [x](x.md)` and `- [1](#ref) footnote`
- **THEN** progress is `done: 1, awaiting: 0, total: 2`, the same completed and total counts the `openspec` CLI reports for that file

#### Scenario: No space after the list marker
- **WHEN** `tasks.md` contains `-[x] a` and `-[ ] b`
- **THEN** progress is `done: 1, awaiting: 0, total: 2`

#### Scenario: A whitespace-only box followed by a link
- **WHEN** `tasks.md` contains `- [ ](./notes.md) read the notes`
- **THEN** it is counted as an open task: `done: 0, awaiting: 0, total: 1`

#### Scenario: Counts agree with the CLI
- **WHEN** any tasks file without a `[~]` box is read by the scanner and by the `openspec` CLI's task counting
- **THEN** the scanner's `done` equals the CLI's completed count and its `total` equals the CLI's total

#### Scenario: Missing tasks file
- **WHEN** the change has no `tasks.md`
- **THEN** `tasks` is `null`

#### Scenario: A repository that never uses the marker is unaffected
- **WHEN** every task in a change is `- [x]` or `- [ ]`
- **THEN** `awaiting` is `0`, no `awaitingTasks` is reported, and `done` and `total` are exactly what they were before this capability knew the marker
