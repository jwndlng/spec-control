## MODIFIED Requirements

### Requirement: Branch and worktree matching
The scanner SHALL record the repository's current branch and every checkout that `git worktree list --porcelain` reports: the main checkout, flagged as such, and each linked worktree. For each checkout it SHALL record the path, the branch when one is checked out, whether HEAD is detached, whether the worktree is locked, and whether it is prunable (its directory no longer exists). A detached worktree MUST NOT be omitted. The main checkout MUST NOT be counted as a worktree: every worktree count the scanner reports SHALL count linked worktrees only. A change whose leading copy was found in a linked worktree SHALL get `branchMatch` set to that worktree's branch only when that branch is exactly one of the change's **branch candidates** or the worktree **holds work on the change**. A worktree holds work on a change when the change's directory in that worktree has uncommitted files (modified, staged or untracked), or when a file in that directory differs between the worktree's `HEAD` and the point where `HEAD` forked from the repository's base — the default branch as the repository locally knows it: `origin/HEAD` when it exists, else the main checkout's `HEAD`. Every branch carries the changes of the commit it was cut from, so a copy that is merely carried along MUST NOT give a change another change's branch; this check SHALL use read-only git only, MUST NOT contact a remote, and when it cannot be answered (no base, a failing git command) the worktree SHALL be taken to hold no work on the change. Any other change — including one whose leading copy is in a linked worktree that fails both tests — SHALL get `branchMatch` set to the main checkout's branch when it is exactly one of the change's **branch candidates**, else to the branch of the first linked worktree that is exactly one of them, else none. A change's branch candidates are, in this order, its recorded implementation branch, its recorded archive branch ("The scan reports a change's recorded branches"), `feat/<name>` and `chore/archive-<name>`. Branches SHALL be compared exactly as written; a branch that merely contains the change name SHALL NOT match. Checkouts without a branch SHALL NOT take part in the matching.

#### Scenario: Feature branch checked out in a worktree
- **WHEN** a worktree is on branch `feat/structured-report-format` and a change `structured-report-format` exists
- **THEN** the change has `branchMatch: feat/structured-report-format`

#### Scenario: Branch name does not contain the change name
- **WHEN** change `audit-trail` exists only in a worktree on branch `wip/compliance`, which added it
- **THEN** the change has `branchMatch: wip/compliance`

#### Scenario: Another change's worktree carries the change along
- **WHEN** the main checkout of `demo-ops` was not pulled and holds change `rotate-keys` in `Implementing`, `origin/main` holds it in `Done`, no checkout is on a branch candidate of `rotate-keys`, and a session for change `add-login` created a worktree on `feat/add-login` from `origin/main` that leaves `rotate-keys` untouched
- **THEN** the leading copy of `rotate-keys` is the one in that worktree, and `rotate-keys` has no `branchMatch`

#### Scenario: Uncommitted work on another branch
- **WHEN** change `rotate-keys` leads from a worktree on `feat/add-login` whose copy of `openspec/changes/rotate-keys/tasks.md` has uncommitted edits
- **THEN** `rotate-keys` has `branchMatch: feat/add-login`

#### Scenario: Committed work on another branch
- **WHEN** change `rotate-keys` leads from a worktree on `wip/keys` that has a commit, not in `origin/main`, changing `openspec/changes/rotate-keys/tasks.md`
- **THEN** `rotate-keys` has `branchMatch: wip/keys`

#### Scenario: A carried copy still finds the change's own branch
- **WHEN** change `rotate-keys` leads from a worktree on `feat/add-login` that holds no work on it, and another linked worktree is on `feat/rotate-keys`
- **THEN** `rotate-keys` has `branchMatch: feat/rotate-keys`

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

