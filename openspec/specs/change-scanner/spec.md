# change-scanner Specification

## Purpose
Defines how the scanner polls tracked repositories and derives each change's artifact status, task progress, dates, git activity and branch matches, with per-repository failure isolation and snapshot caching.

## Requirements

### Requirement: Scanner polls enabled repositories on an interval
The scanner SHALL scan every enabled repository each `pollIntervalSeconds` (default 60) and on explicit trigger. Repositories MUST be scanned concurrently with a bounded concurrency (default 4) and a per-repository timeout. If a scan is already in flight, a trigger MUST NOT start a second concurrent full scan.

#### Scenario: Periodic scan
- **WHEN** the dashboard is running with `pollIntervalSeconds: 60`
- **THEN** every enabled repository is rescanned at least once per 60 seconds

#### Scenario: Trigger while in flight
- **WHEN** a scan is running and `POST /api/scan` is called
- **THEN** the response is `{ started: false }` and no second scan starts

### Requirement: Artifact status is computed with the OpenSpec library
For every change directory under `openspec/changes/` (excluding `archive/`) and under `openspec/changes/archive/`, the scanner SHALL compute artifact statuses using `@fission-ai/openspec` (`resolveSchema`, `loadChangeContext`, `formatChangeStatus`) in-process. The scanner MUST NOT invoke the `openspec` CLI. Artifacts MUST be reported in schema order with status `done`, `ready` or `blocked`. Each artifact SHALL also be reported as **required** when the change's schema names it in `apply.requires`; when the schema declares no `apply.requires`, every artifact SHALL be reported as required. Being required SHALL NOT change an artifact's status: `done`, `ready` and `blocked` keep their meaning, and an artifact that is not required is still `ready` or `blocked` until it is written.

#### Scenario: Spec-driven change with proposal only
- **WHEN** a change contains only `proposal.md`
- **THEN** artifacts are reported as `proposal: done`, `design: ready`, `specs: ready`, `tasks: blocked`

#### Scenario: Required artifacts of the spec-driven schema
- **WHEN** a `spec-driven` change is scanned
- **THEN** `tasks` is reported as required and `proposal`, `specs` and `design` are reported as not required

#### Scenario: Schema without apply.requires
- **WHEN** a change uses a schema that declares no `apply.requires`
- **THEN** every one of its artifacts is reported as required

#### Scenario: Repos written by older CLI versions
- **WHEN** a repository was initialised with OpenSpec CLI 1.3.x
- **THEN** its changes are parsed and reported without error

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

### Requirement: Dates and archive state are read from disk
The scanner SHALL read `created` from `.openspec.yaml` when present, and SHALL mark a change as archived with the date parsed from its directory name `YYYY-MM-DD-<name>` when located under `changes/archive/`. If the archive directory name has no date prefix, the change is still archived with `archived` set from the directory mtime.

#### Scenario: Archived change with date prefix
- **WHEN** a change lives at `openspec/changes/archive/2026-07-20-yaml-settings/`
- **THEN** it is reported with `name: yaml-settings`, `archived: 2026-07-20`

### Requirement: Last activity comes from git with a filesystem fallback
For each non-archived change and for the 25 most recently archived changes, the scanner SHALL determine the committer date of the latest commit touching the change directory (`git log -1 --format=%cI -- <changeDir>`). For every change in a git repository, the scanner SHALL also consider the modification time of each file under the change directory that git reports as modified, added, deleted, renamed or untracked relative to `HEAD`. `lastActivityAt` SHALL be the most recent of these instants. Modification times of files that git reports as unchanged MUST NOT be considered, so that clones, checkouts and rebases do not alter `lastActivityAt`. If the repository is not a git repository, or the path has neither commits nor reported files, `lastActivityAt` MUST fall back to the newest file mtime within the change directory. Git MUST only be invoked with read-only commands and with `cwd` set to the repository.

#### Scenario: Committed change
- **WHEN** the latest commit touching `openspec/changes/foo` is dated `2026-07-20T14:26:00+02:00` and git reports no modified or untracked files under it
- **THEN** `lastActivityAt` is `2026-07-20T14:26:00+02:00`

#### Scenario: Uncommitted new change
- **WHEN** a change directory exists but has never been committed
- **THEN** `lastActivityAt` equals the newest mtime inside that directory

#### Scenario: Uncommitted edit to a committed change
- **WHEN** `openspec/changes/foo/design.md` was last committed three weeks ago and has been modified on disk two minutes ago without committing
- **THEN** `lastActivityAt` is the modification time from two minutes ago

#### Scenario: Fresh checkout does not look recent
- **WHEN** a repository was cloned one minute ago, its working tree is clean, and the latest commit touching `openspec/changes/foo` is five months old
- **THEN** `lastActivityAt` is the five-month-old commit date

### Requirement: Branch and worktree matching
The scanner SHALL record the repository's current branch and every checkout that `git worktree list --porcelain` reports: the main checkout, flagged as such, and each linked worktree. For each checkout it SHALL record the path, the branch when one is checked out, whether HEAD is detached, whether the worktree is locked, and whether it is prunable (its directory no longer exists). A detached worktree MUST NOT be omitted. The main checkout MUST NOT be counted as a worktree: every worktree count the scanner reports SHALL count linked worktrees only. A change whose leading copy was found in a linked worktree SHALL get `branchMatch` set to that worktree's branch. Any other change SHALL get `branchMatch` set to the main checkout's branch when it is exactly one of the change's **branch candidates**, else to the branch of the first linked worktree that is exactly one of them, else none. A change's branch candidates are, in this order, its recorded implementation branch, its recorded archive branch ("The scan reports a change's recorded branches"), `feat/<name>` and `chore/archive-<name>`. Branches SHALL be compared exactly as written; a branch that merely contains the change name SHALL NOT match. Checkouts without a branch SHALL NOT take part in the matching.

#### Scenario: Feature branch checked out in a worktree
- **WHEN** a worktree is on branch `feat/structured-report-format` and a change `structured-report-format` exists
- **THEN** the change has `branchMatch: feat/structured-report-format`

#### Scenario: Branch name does not contain the change name
- **WHEN** change `audit-trail` exists only in a worktree on branch `wip/compliance`
- **THEN** the change has `branchMatch: wip/compliance`

#### Scenario: A sibling change's branch is not a match
- **WHEN** change `add-validate` lives only in the main checkout on `main`, and a linked worktree is on `feat/add-validate-phase`, the branch of another change
- **THEN** `add-validate` has no `branchMatch`

#### Scenario: Main checkout on a branch containing the name
- **WHEN** the main checkout is on `wip/add-validate-tweaks` and change `add-validate` lives only there
- **THEN** `add-validate` has no `branchMatch`

#### Scenario: Recorded branch in a worktree
- **WHEN** change `rotate-keys` lives in the main checkout and records `branch: fix/rotate-keys`, and a linked worktree is on `fix/rotate-keys`
- **THEN** the change has `branchMatch: fix/rotate-keys`

#### Scenario: Main checkout on the session branch
- **WHEN** the main checkout is on `feat/rotate-keys` and change `rotate-keys` lives only there
- **THEN** the change has `branchMatch: feat/rotate-keys`

#### Scenario: Main checkout is not a worktree
- **WHEN** a repository has its main checkout and two linked worktrees
- **THEN** three checkouts are recorded, one flagged as the main checkout, and the repository's worktree count is `2`

#### Scenario: Repository without linked worktrees
- **WHEN** a repository has only its main checkout
- **THEN** its worktree count is `0`

#### Scenario: Detached worktree
- **WHEN** a linked worktree has a detached HEAD
- **THEN** it is recorded as detached without a branch, is counted as a worktree, and is ignored by branch matching

#### Scenario: Worktree directory was deleted
- **WHEN** the directory of a linked worktree was removed without `git worktree remove`
- **THEN** the worktree is recorded as prunable and the repository is still reported with `ok: true`

#### Scenario: Locked worktree
- **WHEN** a linked worktree is locked
- **THEN** it is recorded as locked

### Requirement: Per-repository failure isolation and snapshot caching
A failure in one repository MUST NOT fail the scan; the repository is reported with `ok: false` and an `error`, retaining the changes from its last successful scan. After each scan the full snapshot SHALL be written to `~/.spec-control/cache/snapshot.json`, and on startup the cached snapshot SHALL be served until the first scan completes.

#### Scenario: One repo path was deleted
- **WHEN** an enabled repo's path no longer exists
- **THEN** that repo shows `ok: false` with an error and other repos are scanned normally

#### Scenario: Startup serves cache
- **WHEN** the dashboard starts and a cached snapshot exists
- **THEN** `GET /api/state` returns the cached snapshot immediately, and the fresh one once the first scan finishes

### Requirement: Change directory names are validated before use
The scanner MUST only process change directories whose name matches `^[A-Za-z0-9._-]+$` (after stripping the archive date prefix) and MUST skip and report any other name, so that no untrusted path segment reaches a git invocation.

#### Scenario: Unexpected directory name
- **WHEN** a directory named `foo;rm -rf` exists under `openspec/changes/`
- **THEN** it is skipped and listed in the repository's warnings

### Requirement: Repository last-updated time covers the whole openspec directory
For each successfully scanned repository the scanner SHALL set `lastUpdatedAt` to the most recent of: the committer date of the latest commit touching the repository's `openspec/` directory, and the modification time of any file under `openspec/` that git reports as modified, added, deleted, renamed or untracked relative to `HEAD` (listing untracked files individually). A deleted file SHALL count with the modification time of its nearest existing parent directory. Modification times of unchanged files MUST NOT be considered. For a repository that is not a git repository, `lastUpdatedAt` SHALL be the newest file mtime under `openspec/`. The field SHALL cover all content under `openspec/`, including `specs/`, `config.yaml` and archived changes, not only change directories. When a repository's scan fails, its previous `lastUpdatedAt` SHALL be retained. Determining the value MUST use only read-only git commands, at most one status and one log invocation per repository per scan, and a failure of those commands MUST NOT fail the repository's scan.

#### Scenario: Spec edited outside any change
- **WHEN** `openspec/specs/auth/spec.md` is modified on disk and no change directory was touched for a month
- **THEN** the repository's `lastUpdatedAt` is the modification time of that spec file

#### Scenario: Only committed history
- **WHEN** the working tree is clean and the latest commit touching `openspec/` is dated `2026-09-01T10:00:00+02:00`
- **THEN** `lastUpdatedAt` is `2026-09-01T10:00:00+02:00`

#### Scenario: New untracked change directory
- **WHEN** an untracked directory `openspec/changes/new-idea/` contains `proposal.md` edited ten minutes ago
- **THEN** `lastUpdatedAt` is that file's modification time, even if the directory's own mtime is older

#### Scenario: Non-git repository
- **WHEN** the repository is not a git repository
- **THEN** `lastUpdatedAt` is the newest file mtime under `openspec/`

#### Scenario: Git status fails
- **WHEN** `git status` times out for a repository
- **THEN** the repository is still reported with `ok: true` and `lastUpdatedAt` from the latest commit touching `openspec/`

### Requirement: Spec sync state is derived from the repository
For each non-archived change whose tasks are all complete (`tasks.total > 0` and `tasks.done == tasks.total`), the scanner SHALL report `specsSynced`, stating whether the change's delta specs are already reflected in the repository's main specs. For every delta spec file `specs/<capability>/spec.md` in the change, compared with `openspec/specs/<capability>/spec.md`, the delta is synced when: every ADDED requirement exists in the main spec by name; every MODIFIED requirement exists and its full block equals the delta's block ignoring differences in surrounding, trailing and repeated blank whitespace; every REMOVED requirement is absent; and for every RENAMED pair the new name exists and the old name does not. `specsSynced` SHALL be `true` only when every delta file is synced, and SHALL be `true` for a change with no delta spec files or only empty deltas. A missing main spec SHALL count as not synced when the delta adds or modifies requirements. The state MUST be derived only by reading files in the repository: the scanner MUST NOT write a marker, invoke git, or invoke the `openspec` CLI for it. If the delta or main spec cannot be read or parsed, `specsSynced` SHALL be `false` and the problem SHALL be listed in the change's warnings without failing the repository's scan. For changes that are archived or whose tasks are not all complete, `specsSynced` SHALL be omitted.

#### Scenario: Delta not applied yet
- **WHEN** a complete change adds requirement `Two-factor login` to capability `auth` and `openspec/specs/auth/spec.md` has no such requirement
- **THEN** `specsSynced` is `false`

#### Scenario: Delta applied
- **WHEN** the same change's added requirement is present in `openspec/specs/auth/spec.md`, and its modified requirement `Session timeout` has the same text there as in the delta
- **THEN** `specsSynced` is `true`

#### Scenario: Modified requirement still has the old text
- **WHEN** the delta modifies `Session timeout` and the main spec still contains the previous wording
- **THEN** `specsSynced` is `false`

#### Scenario: Removal and rename
- **WHEN** the delta removes `Legacy export` and renames `Login` to `Sign in`, and the main spec has no `Legacy export`, has `Sign in` and has no `Login`
- **THEN** `specsSynced` is `true`

#### Scenario: New capability whose main spec does not exist
- **WHEN** the delta adds requirements to capability `billing` and `openspec/specs/billing/spec.md` does not exist
- **THEN** `specsSynced` is `false`

#### Scenario: No delta specs
- **WHEN** a complete change has no `specs/` directory
- **THEN** `specsSynced` is `true`

#### Scenario: Agrees with the OpenSpec tool
- **WHEN** a change's deltas have been applied to the main specs by `openspec archive`
- **THEN** evaluating those deltas against the resulting main specs yields `specsSynced: true`

#### Scenario: Unparseable delta
- **WHEN** a delta spec file cannot be parsed
- **THEN** `specsSynced` is `false`, the change carries a warning, and the repository is still reported with `ok: true`

#### Scenario: Change still in progress
- **WHEN** a change has `tasks` `done: 3, total: 12`
- **THEN** `specsSynced` is omitted and no spec files are read for it

### Requirement: Repository snapshots report the carried shared-config profiles
When at least one shared config profile exists, the scanner SHALL set each successfully scanned repository's `sharedConfig` to `{ unreadable, applied }`, where `applied` lists the profiles its `openspec/config.yaml` carries, each with the state `in-sync`, `outdated` or `orphaned`, derived from the text of that file and the stored profiles. The scanner MUST derive it by reading that one file only, MUST NOT write anything, and a failure to read or parse the file MUST yield `unreadable: true` rather than failing the repository's scan. While no profile exists, the field SHALL be omitted. When a repository's scan fails, its previous value SHALL be retained.

#### Scenario: State in the snapshot
- **WHEN** profile `base` exists and a repository's config carries an identical managed section for it
- **THEN** that repository's snapshot has `sharedConfig.applied: [{ id: "base", state: "in-sync" }]`

#### Scenario: No profiles
- **WHEN** no profile exists
- **THEN** no repository snapshot contains `sharedConfig`

#### Scenario: Broken config file
- **WHEN** a repository's `openspec/config.yaml` is not valid YAML
- **THEN** the repository is reported with `ok: true` and `sharedConfig.unreadable: true`

### Requirement: Changes are read from every checkout of a repository
For a git repository the scanner SHALL read active changes (`openspec/changes/*` excluding `archive/`) from the main checkout and from every linked worktree that `git worktree list` reports for it, wherever that worktree is located on disk. When the tracked project sits in a subdirectory of its git repository, it SHALL be read from that same subdirectory of each worktree, never from the worktree's top level. A worktree SHALL be skipped when it is prunable, is bare, or has no `openspec/changes` directory there. Archived changes SHALL be read from the main checkout and, by directory name only, from those same worktrees; an archive of a worktree that the main checkout does not have under the same name with the same or a later date is a *pending archive*, and only pending archives are read further. Main specs shown by the dashboard SHALL be read from the main checkout only. Every per-change fact — artifact status, task progress, warnings, `lastActivityAt` and `specsSynced` — SHALL be computed for a copy within the checkout it was found in: git commands run with that checkout as working directory, uncommitted modifications in that checkout count towards `lastActivityAt`, the checkout's own `openspec/config.yaml` supplies the fallback schema, and spec sync is judged against that checkout's `openspec/specs/`. Change directory names found in worktrees SHALL pass the same validation as those in the main checkout. Worktree paths MUST come only from `git worktree list` of a tracked repository. Reading worktrees MUST remain read-only and MUST NOT use any git subcommand beyond those already allowed. Linked worktrees SHALL still not be offered as repositories by discovery.

#### Scenario: Change that exists only in a worktree
- **WHEN** change `audit-trail` exists, uncommitted, only in a linked worktree of a tracked repository
- **THEN** it appears in that repository's changes with the artifact status and task progress read from that worktree

#### Scenario: Worktree outside the repository directory
- **WHEN** a linked worktree of the repository lives under a directory unrelated to the repository's path
- **THEN** its active changes are read like those of any other worktree

#### Scenario: Uncommitted edit in a worktree drives last activity
- **WHEN** `tasks.md` of a change in a worktree was modified two minutes ago without committing
- **THEN** the change's `lastActivityAt` is that modification time

#### Scenario: Spec sync is judged in the change's own checkout
- **WHEN** a complete change in a worktree has delta specs that are already merged into that worktree's `openspec/specs/` but not into the main checkout's
- **THEN** `specsSynced` is `true`

#### Scenario: Archive that exists only in a worktree
- **WHEN** a worktree on an archive branch contains `openspec/changes/archive/2026-09-20-audit-trail/` while the main checkout still has `audit-trail` as an active change
- **THEN** that archive is read as a pending archive, with its facts computed in that worktree

#### Scenario: Archives come from main only
- **WHEN** a worktree's `openspec/changes/archive/` holds the same forty archives as the main checkout's
- **THEN** each is reported once, from the main checkout, and none of them is read from the worktree

#### Scenario: Project in a subdirectory of its repository
- **WHEN** the tracked project is `services/billing` inside a repository that has its own top-level `openspec/`, and a worktree has progress on a change under its `services/billing/openspec/changes/`
- **THEN** that progress is reported, and nothing from any top-level `openspec/` appears among the project's changes

#### Scenario: Non-git repository
- **WHEN** a tracked repository is not a git repository
- **THEN** its changes are read from its own directory exactly as before

### Requirement: Copies of a change are merged into one change
All active copies of the same change name across a repository's checkouts SHALL be reported as one change. Its data SHALL be that of the leading copy, chosen by comparing in order: lifecycle stage (`unknown` before `backlog` before `drafts` before `ready`, `implementing`, `done`), number of done artifacts, number of done tasks, latest `lastActivityAt`, then the main checkout before linked worktrees and finally the path, so that the choice is deterministic. The change SHALL report the checkout of the leading copy (`path`, `branch` when it has one, and whether it is the main checkout) and the other checkouts that hold a copy, each with its column — leaving out linked worktrees whose copy shows the same progress as the main checkout's copy, since every branch carries the main branch's committed changes along and such a copy says nothing new. A pending archive leads over every active copy of the same name: the change SHALL be reported once, as archived with that archive's date, with the worktree holding the archive as its checkout and every active copy — the main checkout's included — among its other checkouts with its column; of several pending archives of one name the latest date leads. As the one exception, active copies whose `created` date is later than the pending archive's date SHALL be reported as a separate, active change. A pending archive without any active copy SHALL be reported as archived as well. An active copy in a linked worktree SHALL be ignored when the main checkout has an archived change of the same name, unless the copy's `created` date is later than that archive's date. The repository's `lastUpdatedAt` SHALL be no earlier than the latest `lastActivityAt` among its merged changes.

#### Scenario: Further along in a worktree
- **WHEN** `audit-trail` is in `Drafts` in the main checkout and has `tasks` `done: 4, total: 12` in a worktree on `feat/audit-trail`
- **THEN** one change `audit-trail` is reported in `Implementing` with `4/12`, its checkout is that worktree, and the main checkout is listed among its other checkouts as `Drafts`

#### Scenario: Worktrees that merely carry the change along
- **WHEN** `audit-trail` is in `Drafts` in the main checkout, in `Implementing` in one worktree, and unchanged in `Drafts` in three other worktrees cut from the main branch
- **THEN** the change's other checkouts list only the main checkout

#### Scenario: Stale copy behind main
- **WHEN** `audit-trail` has all tasks done in the main checkout and an older copy in `Drafts` in a worktree
- **THEN** the change is reported from the main checkout and the worktree is listed among its other checkouts

#### Scenario: Finished change is not resurrected
- **WHEN** the main checkout has `openspec/changes/archive/2026-09-20-audit-trail/` and a worktree cut before the archive still has `openspec/changes/audit-trail/` created on `2026-09-10`
- **THEN** `audit-trail` is reported only as archived

#### Scenario: Name reused after archiving
- **WHEN** the main checkout has `audit-trail` archived on `2026-09-20` and a worktree has an active `audit-trail` created on `2026-10-02`
- **THEN** both are reported: the archived change and the new active one

#### Scenario: Identical copies
- **WHEN** the same change is at the same stage with the same progress and last activity in the main checkout and in two worktrees
- **THEN** the main checkout is the leading copy, on every scan

#### Scenario: Repository activity in a worktree only
- **WHEN** the only recent activity of a repository is an uncommitted edit to a change in a worktree, ten minutes ago
- **THEN** the repository's `lastUpdatedAt` is that time

#### Scenario: Archived in a worktree, still active in main
- **WHEN** the main checkout has `audit-trail` at `Implementing` with `5/6` and a worktree on `chore/archive-audit-trail` has `openspec/changes/archive/2026-09-20-audit-trail/`
- **THEN** one change `audit-trail` is reported, archived on `2026-09-20`, its checkout is that worktree, and the main checkout is listed among its other checkouts as `Implementing`

#### Scenario: Name reused after a pending archive
- **WHEN** a worktree has `audit-trail` archived on `2026-09-20` and the main checkout has an active `audit-trail` created on `2026-10-02`
- **THEN** both are reported: the archived change from the worktree and the active one

#### Scenario: Further drafted in a worktree
- **WHEN** `audit-trail` is in `Drafts` with 1 of 4 artifacts written in the main checkout and with 3 of 4 written in a worktree
- **THEN** the worktree's copy leads, and the change is reported in `Drafts` with `3/4` artifacts

### Requirement: Reading worktrees is bounded and isolated
The scanner SHALL read a repository's worktrees with bounded concurrency and SHALL read at most 12 worktrees per repository, preferring those whose `openspec/changes` directory was modified most recently; when worktrees are left out, the repository's warnings SHALL say how many. A worktree that cannot be read, or whose reading fails or times out, SHALL be skipped with a repository warning naming it, and MUST NOT fail the repository's scan or affect changes read from other checkouts. All of it SHALL run within the repository's scan timeout. The repository's snapshot SHALL list the paths of the linked worktrees that have an `openspec/changes` directory but were not read, as the same paths its changes' checkouts carry — left out by the limit, or skipped because reading failed or timed out — so that a change missing from that scan can be told from a change that is gone (`activity-feed`: "A worktree left unread is not activity"); the list SHALL be omitted when every such worktree was read. It SHALL NOT change what the board shows.

#### Scenario: Worktree directory was deleted by hand
- **WHEN** git reports a worktree as prunable because its directory no longer exists
- **THEN** it is skipped, the repository is reported with `ok: true`, and changes from other checkouts are unaffected

#### Scenario: One worktree fails
- **WHEN** reading one worktree throws while two others are readable
- **THEN** the repository's warnings name the failing worktree, its path is listed among the worktrees not read, and the changes from the main checkout and the other two worktrees are reported

#### Scenario: More worktrees than the cap
- **WHEN** a repository has 15 linked worktrees with changes
- **THEN** the 12 with the most recently modified `openspec/changes` are read, the warnings say that 3 were not, and the paths of those 3 are listed among the worktrees not read

#### Scenario: Every worktree read
- **WHEN** a repository's scan reads all of its linked worktrees
- **THEN** its snapshot lists no worktree as not read

### Requirement: The default branch and whether the main checkout is on it are reported
For each successfully scanned git repository the scanner SHALL report `defaultBranch` — the branch that `refs/remotes/origin/HEAD` points to, or, when that ref does not exist, `main` if such a local branch exists, otherwise `master` if it exists — and `onDefaultBranch`, which is `true` when the main checkout's current branch is that branch and `false` otherwise, including when HEAD is detached. When no default branch can be determined both SHALL be omitted. Determining them MUST use only read-only git commands and MUST NOT contact a remote, and a failure to determine them MUST NOT fail the repository's scan. When a repository's scan fails, the previous values SHALL be retained.

#### Scenario: On the default branch
- **WHEN** `origin/HEAD` points to `origin/main` and the main checkout is on `main`
- **THEN** the repository reports `defaultBranch: "main"` and `onDefaultBranch: true`

#### Scenario: On a feature branch
- **WHEN** `origin/HEAD` points to `origin/main` and the main checkout is on `feat/redesign`
- **THEN** the repository reports `defaultBranch: "main"` and `onDefaultBranch: false`

#### Scenario: Default branch is not called main
- **WHEN** `origin/HEAD` points to `origin/trunk` and the main checkout is on `trunk`
- **THEN** the repository reports `defaultBranch: "trunk"` and `onDefaultBranch: true`

#### Scenario: No origin/HEAD
- **WHEN** the repository has no `refs/remotes/origin/HEAD`, a local branch `master` and no `main`, and the checkout is on `develop`
- **THEN** the repository reports `defaultBranch: "master"` and `onDefaultBranch: false`

#### Scenario: Detached HEAD
- **WHEN** the main checkout has a detached HEAD
- **THEN** `onDefaultBranch` is `false`

#### Scenario: Cannot tell
- **WHEN** the repository has no `origin/HEAD` and neither a `main` nor a `master` branch
- **THEN** neither field is reported and the scan succeeds

### Requirement: The scanner reports the presence and text of a change's prompt.md
For each change directory the scanner SHALL report whether the change has a top-level `prompt.md` file, and when it does, the file's text (bounded to a reasonable size for a tooltip). `prompt.md` is not a schema artifact and MUST NOT be counted towards artifact status. The field SHALL be reported for changes read from every checkout (main and linked worktrees) and for archived changes alike, on the same rules as other per-change facts. A failure to read the file MUST NOT fail the repository's scan; the change is reported without the prompt text and with a warning.

#### Scenario: Change with a prompt
- **WHEN** a change contains a `prompt.md` with the text "Log every mutation"
- **THEN** the change's snapshot reports the presence of the prompt and includes its text

#### Scenario: Change without a prompt
- **WHEN** a change has no `prompt.md`
- **THEN** the change's snapshot has no prompt text and reports its absence

#### Scenario: Prompt does not affect artifact status
- **WHEN** a change has only `.openspec.yaml` and `prompt.md`
- **THEN** the change's `proposal` artifact is still not done and the change appears in `New`

#### Scenario: Unreadable prompt
- **WHEN** a change's `prompt.md` cannot be read
- **THEN** the repository is reported with `ok: true`, the change carries a warning, and its prompt text is absent

### Requirement: Working-tree status is reported for every checkout
For the main checkout and each linked worktree of a git repository the scanner SHALL report a working-tree status: the number of modified items (tracked files that differ from `HEAD`, staged or not, including renamed and unmerged files), the number of untracked items (an untracked directory counts as one item), the upstream branch when one is configured, and the number of commits the checkout is ahead of and behind that upstream. For a checkout without an upstream — including a detached HEAD — in a repository that has at least one remote-tracking ref, the scanner SHALL instead report the number of commits reachable from `HEAD` that are on no remote-tracking ref, capped at 100. Each checkout's number of unpushed commits SHALL be the ahead count when an upstream exists, that local-only count when it does not but remote-tracking refs exist, and SHALL be omitted when the repository has no remote-tracking refs. A branch without commits SHALL be reported without error. A prunable worktree MUST NOT be inspected and SHALL carry no status. All values are relative to the last fetch: the scanner MUST NOT contact a remote or fetch. The status MUST be obtained only with the read-only git subcommands already permitted, with optional locks disabled, and MUST NOT modify the index or any file of any checkout. The snapshot MUST contain counts only — never the names, paths or contents of changed files. The working-tree status SHALL NOT alter how `lastActivityAt` and `lastUpdatedAt` are determined.

#### Scenario: Clean checkout
- **WHEN** a linked worktree on `feat/report` has no local changes and is level with its upstream `origin/feat/report`
- **THEN** its status is `modified: 0`, `untracked: 0`, `upstream: origin/feat/report`, `ahead: 0`, `behind: 0`, and its unpushed count is `0`

#### Scenario: Uncommitted work
- **WHEN** a checkout has one edited tracked file, one staged new file, one renamed file and an untracked directory holding 40 files
- **THEN** its status is `modified: 3` and `untracked: 1`

#### Scenario: Ahead and behind the upstream
- **WHEN** a checkout has 2 commits its upstream lacks and lacks 5 commits its upstream has
- **THEN** its status is `ahead: 2`, `behind: 5`, and its unpushed count is `2`

#### Scenario: Branch that was never pushed
- **WHEN** a worktree is on a branch without an upstream, holding 3 commits that are on no remote-tracking ref, and the repository has remote-tracking refs
- **THEN** its status has no upstream and no ahead or behind count, and its unpushed count is `3`

#### Scenario: Repository without a remote
- **WHEN** a repository has no remote-tracking refs
- **THEN** no checkout of it reports an unpushed count

#### Scenario: Detached checkout with local commits
- **WHEN** a detached worktree holds 1 commit that is on no remote-tracking ref
- **THEN** its unpushed count is `1`

#### Scenario: Branch without commits
- **WHEN** a checkout is on a branch that has no commits yet and contains two untracked files
- **THEN** its status is `untracked: 2` and the repository is reported with `ok: true`

#### Scenario: Prunable worktree is not inspected
- **WHEN** a linked worktree is prunable
- **THEN** no git command runs in its path and it carries no status

#### Scenario: Scanning leaves every checkout untouched
- **WHEN** a repository with a dirty linked worktree is scanned
- **THEN** the index file and the working-tree files of the main checkout and of every linked worktree are byte-identical before and after the scan

#### Scenario: No file names in the snapshot
- **WHEN** a checkout has a modified file `secret-plan.md`
- **THEN** the snapshot contains the count but the string `secret-plan.md` appears nowhere in it

### Requirement: Checkout inspection is bounded and failure-isolated
The scanner SHALL inspect the checkouts of a repository with a bounded concurrency and within the repository's existing scan timeout. It SHALL always inspect the main checkout and SHALL inspect at most 12 linked worktrees per repository; further linked worktrees SHALL still be listed, marked as not inspected and without a status. When the status of a checkout cannot be determined — the command fails or times out — that checkout SHALL be reported with an unknown status, and this MUST NOT fail the repository's scan nor affect the status of its other checkouts. Only paths reported by `git worktree list` for a tracked repository SHALL be used as the working directory of such a command. When a repository's scan fails, its previously recorded checkouts and their statuses SHALL be retained. A repository that is not a git repository SHALL report no checkouts.

#### Scenario: More worktrees than the cap
- **WHEN** a repository has 15 linked worktrees
- **THEN** all 15 are listed, 12 of them with a status, and 3 marked as not inspected

#### Scenario: Status fails for one worktree
- **WHEN** the status command fails in one of three linked worktrees
- **THEN** that worktree is reported with an unknown status, the other two and the main checkout carry their status, and the repository is reported with `ok: true`

#### Scenario: Status times out
- **WHEN** the status command does not return within the command timeout for a worktree
- **THEN** that worktree is reported with an unknown status and the scan of the repository completes

#### Scenario: Failed scan keeps the previous values
- **WHEN** a repository was scanned successfully with two worktrees and its next scan fails
- **THEN** it is reported with `ok: false` and still lists those two worktrees with their last known status

#### Scenario: Non-git repository
- **WHEN** a tracked repository is not a git repository
- **THEN** it reports no checkouts and no work-in-progress summary

### Requirement: Repository work-in-progress summary
For every successfully scanned git repository the scanner SHALL report a work-in-progress summary consisting of: the number of linked worktrees; the number of checkouts, main checkout included, with uncommitted changes (modified plus untracked items greater than zero); the number of checkouts with an unpushed count greater than zero; the number of stale (prunable) worktrees; and the number of checkouts whose status is unknown. The summary SHALL be derived solely from the recorded checkouts, so that it never disagrees with them. It SHALL be omitted for a repository that is not a git repository, and SHALL be retained from the last successful scan when a repository's scan fails. A snapshot cached by a version that did not record the summary SHALL still load, with the summary absent.

#### Scenario: Mixed states
- **WHEN** a repository has a clean main checkout and three linked worktrees: one with uncommitted changes, one clean with 2 unpushed commits, one prunable
- **THEN** its summary is `worktrees: 3`, `uncommitted: 1`, `unpushed: 1`, `stale: 1`, `unknown: 0`

#### Scenario: Dirty main checkout without worktrees
- **WHEN** a repository has no linked worktrees and its main checkout has modified files
- **THEN** its summary is `worktrees: 0`, `uncommitted: 1`, `unpushed: 0`, `stale: 0`, `unknown: 0`

#### Scenario: One checkout with both
- **WHEN** a single worktree has uncommitted changes and unpushed commits
- **THEN** it counts once under `uncommitted` and once under `unpushed`

#### Scenario: Uninspected and unknown checkouts
- **WHEN** one worktree's status is unknown and another was not inspected because of the cap
- **THEN** `unknown` is `1`, and neither of them counts as uncommitted or unpushed

#### Scenario: Snapshot from an older version
- **WHEN** the cached snapshot was written by a version without working-tree status
- **THEN** it is served on startup without error and its repositories carry no summary until the first scan completes

### Requirement: Repository snapshots report a git repository with no commit to branch from
For each successfully scanned git repository the scanner SHALL report `noCommit: true` when the repository has nothing
to branch a session from: `HEAD` names no commit and `refs/remotes/origin/HEAD` does not exist. Otherwise the field SHALL
be omitted, and it SHALL always be omitted for a repository that is not a git repository. Determining it MUST use only
read-only git commands already permitted, MUST NOT contact a remote, and a failure to determine it MUST NOT fail the
repository's scan; when it cannot be determined the field SHALL be omitted. When a repository's scan fails, the previous
value SHALL be retained.

#### Scenario: Freshly initialised repository
- **WHEN** the tracked repository `/w/acme/fresh-app` was created with `git init`, has an `openspec/` tree and no commit,
  and has no remote
- **THEN** its snapshot reports `isGit: true` and `noCommit: true`, and the scan otherwise succeeds

#### Scenario: Repository with a commit
- **WHEN** the tracked repository `/w/acme/demo-ops` has at least one commit on its checked-out branch
- **THEN** its snapshot carries no `noCommit`

#### Scenario: Folder without git
- **WHEN** a tracked folder has an `openspec/` tree but no `.git`
- **THEN** its snapshot reports `isGit: false` and carries no `noCommit`

### Requirement: The scan reports a change's recorded branches
For every active and archived change, the scan SHALL report the change's **record** as its framework module reads it
(spec-frameworks: "OpenSpec changes record their pull request's branch in `.openspec.yaml`"): optionally an
implementation branch and an archive branch. A change without a record,
or of a framework that reads none, SHALL report none. Where copies of a change are merged into one, the record SHALL be
the leading copy's, or — when the leading copy has none — the main checkout's copy's.

The record SHALL be an input to the pull-request link (pull-requests: "A pull request is linked to a change by its head
branch") and to `branchMatch` only. It MUST NOT change a change's stage, column, sub-state, progress, counts, available
actions or the activity log, and the scan MUST NOT write it.

#### Scenario: A recorded change in a worktree
- **WHEN** change `rotate-keys` leads from a worktree whose `.openspec.yaml` records `branch: fix/rotate-keys`, and the main checkout's copy records nothing
- **THEN** the change reports the implementation branch `fix/rotate-keys`

#### Scenario: Record only on the main checkout
- **WHEN** the leading copy of `rotate-keys` records nothing and the main checkout's copy records `branch: fix/rotate-keys`
- **THEN** the change reports the implementation branch `fix/rotate-keys`

#### Scenario: The record changes no column
- **WHEN** a change gains a record in a worktree without any other edit
- **THEN** its column, progress and counts are unchanged

### Requirement: Repository files are read bounded and inside their checkout
Every file the scanner reads from a tracked repository — `openspec/config.yaml` (also for its carried shared-config
profiles), each change's `.openspec.yaml`, its tasks file, `prompt.md`, `depends-on.yaml` and `issue.yaml`, its delta
`spec.md` files, the main `openspec/specs/<capability>/spec.md` files and a project-local `schema.yaml` — SHALL be read
through one bounded read. That read SHALL resolve every symbolic link on the path and refuse the file when its real
path is not inside the real path of the change directory (for a change's own files) or of the checkout being read (for
`config.yaml`, main specs and schemas); it SHALL open the file without blocking and without following a final link,
refuse anything the opened file is not a regular file — a named pipe, socket or device — before reading a byte, and
refuse a file larger than 1 MiB, except that `prompt.md` is truncated at its limit and `depends-on.yaml` and
`issue.yaml` keep their own limits. It MUST NOT read more bytes than the limit plus one. A refused or failed read SHALL
be reported as a warning on the change (for `config.yaml`, on the repository) naming the file, and SHALL NOT fail the
repository's scan, delay it beyond the time a read of a regular file of that size takes, or affect other changes. The
scanner MUST NOT read a repository file in any other way.

#### Scenario: Marker linked to an endless device
- **WHEN** `openspec/changes/lint-rules/.openspec.yaml` in `demo-ops` is a symbolic link to `/dev/zero`
- **THEN** the scan of `demo-ops` completes within its timeout with `ok: true`, `lint-rules` carries a warning about
  `.openspec.yaml`, its other facts are read with the project's schema, and the dashboard's memory use does not grow by
  more than that file's limit

#### Scenario: Tasks file is a named pipe
- **WHEN** a change's `tasks.md` is a named pipe that no process writes to
- **THEN** every poll of the repository completes, the change reports `tasks: null` with a warning that `tasks.md` is not
  a regular file, and no file descriptor stays open between polls

#### Scenario: Delta spec linked outside the repository
- **WHEN** `openspec/changes/rotate-keys/specs/auth/spec.md` is a symbolic link to `/w/acme/elsewhere/spec.md`
- **THEN** that file is not read, the change's spec sync is reported as not synced with a warning, and nothing of the
  target's content reaches the snapshot

#### Scenario: Oversized config
- **WHEN** `openspec/config.yaml` is a regular file of 3 MiB
- **THEN** it is not read, the repository carries a warning naming the file and the 1 MiB limit, and its changes are
  read with the default schema

#### Scenario: Link inside the change keeps working
- **WHEN** a change's `tasks.md` is a symbolic link to `notes/tasks.md` in the same change directory
- **THEN** its tasks are counted as before

### Requirement: The dashboard's own change files are read only in place
`prompt.md`, `depends-on.yaml` and `issue.yaml` SHALL be read only when the entry in the change directory is itself a
regular file — not a symbolic link, wherever it points. An entry of one of those names that is anything else SHALL be
ignored with a warning on the change, exactly as an unreadable file: `prompt.md` is reported absent, `depends-on.yaml`
holds the change back as unreadable, and `issue.yaml` gives no source issue.

#### Scenario: Prompt linked out of the repository
- **WHEN** `openspec/changes/lint-rules/prompt.md` is a symbolic link to `/w/acme/elsewhere/hosts`
- **THEN** the change has no prompt text, carries a warning about `prompt.md`, and neither the state endpoint nor
  `snapshot.json` contains any of the target's text

#### Scenario: Dependencies linked elsewhere
- **WHEN** a change's `depends-on.yaml` is a symbolic link to a file in another change
- **THEN** the change carries the warning that `depends-on.yaml` could not be read and is blocked, as for an unreadable
  file

### Requirement: Schema names and tracked task files stay inside the project
A schema name taken from a change's `.openspec.yaml` or from `openspec/config.yaml` SHALL be used only when it is a
single plain path segment: characters from `A-Z`, `a-z`, `0-9`, `.`, `_` and `-`, not starting with `.`, and not `.` or
`..`. Any other name SHALL be reported as a warning and treated as an unknown schema. A project-local schema SHALL be
read only from `openspec/schemas/<name>/schema.yaml` of the checkout, with the bounded read. The tasks file a schema
names with `apply.tracks` SHALL be read only when it resolves inside the change directory; otherwise the change SHALL
report `tasks: null` and a warning, and no file outside the change directory SHALL be opened for it.

#### Scenario: Schema name climbs out
- **WHEN** a change's `.openspec.yaml` says `schema: ..` or `schema: ../../shared`
- **THEN** the change carries a warning about its schema name, its artifacts are reported as for an unknown schema, and
  no `schema.yaml` outside `openspec/schemas/` is opened

#### Scenario: Tracked tasks outside the change
- **WHEN** a project-local schema declares `apply.tracks: ../../../outside.md`
- **THEN** the change reports `tasks: null` with a warning and the file is not read
