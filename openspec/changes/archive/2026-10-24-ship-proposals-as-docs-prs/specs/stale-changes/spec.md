## MODIFIED Requirements

### Requirement: A change's branches are named exactly
Wherever stale detection looks for branches of a change, the change's **branches** SHALL be exactly:
- the implementation branch and the archive branch recorded in the change's metadata, when recorded
  (`spec-control.branch` and `spec-control.archive-branch` in `.openspec.yaml`);
- the dashboard's own session branches for it, `feat/<name>`, `chore/archive-<name>` and the proposal branch
  `docs/<name>` a Draft session works on in a project with docs auto-merge;
- the branch of every dashboard session record for that change in that repository.

The metadata is read from the change's own directory in the checkout the board shows it from or, for a change archived
on the default branch, from that archive directory on the default branch, with read-only git. A remote-tracking branch
matches when its name without the remote's prefix is one of them. Branch names SHALL be compared exactly as written, with
no containment, abbreviation or normalisation. A recorded name that is not a valid branch name SHALL be ignored.

#### Scenario: Recorded branches
- **WHEN** the change `rotate-keys` records `branch: fix/rotate-keys` and `archive-branch: chore/archive-rotate-keys`
- **THEN** its branches are `fix/rotate-keys`, `chore/archive-rotate-keys`, `feat/rotate-keys` and `docs/rotate-keys`

#### Scenario: Containment is not a match
- **WHEN** the change `auth` records nothing and the repository has `feat/auth-v2`
- **THEN** `feat/auth-v2` is not one of `auth`'s branches

#### Scenario: The proposal branch
- **WHEN** the change `rotate-keys` is archived and merged on the default branch, and its proposal session's worktree on `docs/rotate-keys` was kept
- **THEN** `docs/rotate-keys` is one of its branches, and that worktree is offered as a stale leftover like any other of its branches
