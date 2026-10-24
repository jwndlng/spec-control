## MODIFIED Requirements

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

## ADDED Requirements

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
