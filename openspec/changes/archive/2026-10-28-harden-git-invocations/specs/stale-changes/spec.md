## ADDED Requirements

### Requirement: A leftover's merge check works from a project in a subfolder
Whether a worktree or branch leftover is **merged** SHALL be decided the same way for a project in a subfolder of its git
repository as for one at the top level: every file the branch changed since it forked from the default branch, named
relative to the repository's top level and including both sides of a rename, SHALL be compared with the default branch
at that same top-level path, independently of the scan's working directory and of `diff.relative`, `diff.renames` or an
external diff driver. A leftover whose branch has a file whose content the default branch lacks SHALL be kept with that
reason, and a stale change's cleanup SHALL neither remove its worktree nor delete its branch.

#### Scenario: Unmerged work in a subfolder project
- **WHEN** the project `/w/acme/monorepo/packages/tools` has `rotate-keys` archived on `origin/main`, and the session
  worktree on `feat/rotate-keys` has one commit changing `packages/tools/src/keys.ts` that `origin/main` lacks
- **THEN** that worktree and the branch are reported as kept because they hold unmerged work, and a stale cleanup
  confirmation that names them removes neither

#### Scenario: Squash-merged work in a subfolder project
- **WHEN** in that project the same commit was squash-merged into `origin/main`
- **THEN** the worktree is a stale leftover, exactly as for a project at the top level

#### Scenario: A rename the default branch lacks
- **WHEN** `feat/rotate-keys` renamed `packages/tools/src/old.ts` to `packages/tools/src/keys.ts` and `origin/main` holds
  `keys.ts` with the same content but still holds `old.ts`
- **THEN** the branch is not merged
