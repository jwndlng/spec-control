## MODIFIED Requirements

### Requirement: Each dependency has a state
For every dependency of an active change the scanner SHALL report one state, derived from the repository's merged
changes only:
- `met` — the repository's main checkout holds that change archived, or holds an active copy of it in `Done` (either
  sub-state). This means "implemented and merged", as of the main checkout's state: it reflects the user's last pull
  and MUST NOT contact a remote. For a repository without git, the folder itself is the main checkout. When the
  repository's merged changes hold an active change of that name, that change alone decides: the dependency is `met`
  only when the main checkout holds it in `Done`, or holds an archive of that name dated on or after that active
  change's creation date. An archive dated before it belongs to an earlier change that reused the name and MUST NOT
  make the dependency `met` — the same rule by which the scanner tells a new change reusing a name from a leftover of
  the archived one.
- `cycle` — not `met`, and following dependencies that are not `met` from that change leads back to the dependent
  change.
- `missing` — not `met`, not part of a cycle, and the repository has no active or archived change of that name in any
  checkout.
- `waiting` — any other case: the change exists but is not implemented and merged yet, including when it is in `Done`
  or archived only on a linked worktree's branch.

A dependency that is `missing` or part of a `cycle` SHALL also be reported as a warning on the dependent change, so it
is visible wherever warnings are.

#### Scenario: Archived in the main checkout
- **WHEN** `add-billing-ui` depends on `add-billing-schema`, and the main checkout holds `openspec/changes/archive/2026-09-30-add-billing-schema/`
- **THEN** that dependency is `met`

#### Scenario: Done in the main checkout, not archived yet
- **WHEN** `add-billing-schema` has every task done in the main checkout's copy and is not archived
- **THEN** a dependency on `add-billing-schema` is `met`

#### Scenario: Done only on a branch
- **WHEN** `add-billing-schema` is in `Done` in a linked worktree on `feat/add-billing-schema` and in `Implementing` in the main checkout
- **THEN** a dependency on `add-billing-schema` is `waiting`

#### Scenario: Archived only on a branch
- **WHEN** `add-billing-schema` is archived only in a linked worktree and the main checkout does not hold that archive
- **THEN** a dependency on `add-billing-schema` is `waiting`, unless the main checkout's own active copy is in `Done`

#### Scenario: A reused name is not met by its old archive
- **WHEN** `add-billing-ui` depends on `add-billing-schema`, the main checkout holds `openspec/changes/archive/2026-09-01-add-billing-schema/`, and a new active `add-billing-schema` created `2026-10-01` is in `Drafts`
- **THEN** that dependency is `waiting` and `add-billing-ui` is blocked

#### Scenario: A reused name is met once it is done
- **WHEN** in that situation the new `add-billing-schema` reaches `Done` in the main checkout
- **THEN** that dependency is `met`

#### Scenario: Unknown name
- **WHEN** `add-billing-ui` depends on `add-billing-scheme` and no change of that name exists, active or archived
- **THEN** that dependency is `missing` and `add-billing-ui` carries a warning naming it

#### Scenario: Cycle
- **WHEN** `alpha` depends on `beta`, `beta` depends on `gamma` and `gamma` depends on `alpha`, and none is `met`
- **THEN** each of the three reports its dependency as `cycle` and carries a warning naming the cycle

#### Scenario: A met change breaks the cycle
- **WHEN** `alpha` depends on `beta` and `beta` depends on `alpha`, and `beta` is archived in the main checkout
- **THEN** `alpha`'s dependency on `beta` is `met` and no cycle is reported
