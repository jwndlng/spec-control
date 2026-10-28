# change-dependencies Specification

## Purpose

Lets a change declare which other changes of its repository must be implemented and merged before it is implemented,
and lets the dashboard derive from that declaration which changes wait, which are free to start, and why.

## Requirements

### Requirement: A change declares its dependencies in depends-on.yaml
A change MAY declare its dependencies in a file `depends-on.yaml` at the top level of its change directory
(`openspec/changes/<name>/depends-on.yaml`). The file SHALL be YAML whose `depends_on` key holds a list of change
names of the same repository; every other key SHALL be ignored. A dependency SHALL be named by its change name alone,
never by an archive directory name or a path. `depends-on.yaml` is not a schema artifact and MUST NOT be counted
towards artifact status. A change without the file, or whose file holds an empty or absent `depends_on` list, SHALL
have no dependencies.

#### Scenario: Declared dependencies
- **WHEN** `openspec/changes/add-billing-ui/depends-on.yaml` reads `depends_on: [add-billing-schema, add-billing-api]`
- **THEN** the change `add-billing-ui` depends on `add-billing-schema` and `add-billing-api`

#### Scenario: No file
- **WHEN** a change has no `depends-on.yaml`
- **THEN** it has no dependencies and is not blocked

#### Scenario: The file is not an artifact
- **WHEN** a change has only `.openspec.yaml` and `depends-on.yaml`
- **THEN** its `proposal` artifact is still not done and the change appears in `Backlog`

### Requirement: The scanner reads depends-on.yaml safely
The scanner SHALL read `depends-on.yaml` for every active change, from the checkout of the change's leading copy, on
the same rules as `prompt.md`: read-only, bounded in size, and failure-isolated so that a problem with the file never
fails the repository's scan. Every declared name SHALL be checked against the change-name rule (`^[A-Za-z0-9._-]+$`)
before it is used; a name that fails it SHALL be left out and reported as a warning on the change. A name listed twice
SHALL count once, and a change listing itself SHALL be treated as a cycle. When the file exists but cannot be read or
parsed, or `depends_on` is not a list of strings, the change SHALL carry a warning saying so and SHALL be **blocked**,
because its author meant it to wait for something. Archived changes' `depends-on.yaml` SHALL NOT be read for blocking:
an archived change is never blocked.

#### Scenario: Malformed file
- **WHEN** a change's `depends-on.yaml` is not valid YAML
- **THEN** the repository is reported with `ok: true`, the change carries a warning naming the file, and the change is blocked

#### Scenario: Invalid name in the list
- **WHEN** a change's `depends_on` lists `add-schema` and `../etc`
- **THEN** the change depends on `add-schema` only and carries a warning naming the rejected entry

#### Scenario: The leading copy decides
- **WHEN** a change's copy in a linked worktree leads and declares `depends_on: [add-schema]`, while the main checkout's copy has no `depends-on.yaml`
- **THEN** the change depends on `add-schema`

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

### Requirement: A change with an unmet dependency is blocked
An active change SHALL be **blocked** when at least one of its dependencies is not `met`, or when its
`depends-on.yaml` could not be read. Only direct dependencies SHALL decide: a change whose dependencies are all `met`
is not blocked, whatever those dependencies declared themselves. Being blocked SHALL NOT change the change's column,
sub-state, counts or any filter. A change SHALL stop being blocked on the first scan after its last unmet dependency
became `met`, with no action by the user.

#### Scenario: Chain
- **WHEN** `add-billing-api` depends on `add-billing-schema` (`waiting`) and `add-billing-ui` depends on `add-billing-api`
- **THEN** both `add-billing-api` and `add-billing-ui` are blocked, and both stay in their columns

#### Scenario: Unblocked after the user pulls
- **WHEN** `add-billing-schema`'s archive reaches the main checkout through a pull, and the next scan runs
- **THEN** `add-billing-api` is no longer blocked

#### Scenario: Archived changes are never blocked
- **WHEN** an archived change's directory holds a `depends-on.yaml` naming a change that is `waiting`
- **THEN** the archived change is not blocked

### Requirement: Dependencies are part of the change snapshot
Every active change that declares dependencies SHALL carry them in its snapshot as an ordered list of `{ name, state }`
in the order the file lists them, together with whether it is blocked. Every change, active or archived, that at
least one active change of the same repository depends on SHALL carry the names of those dependent changes as its
**required by** list, sorted by name. A change without dependencies or dependents SHALL carry neither field, so that
snapshots of repositories that do not use the convention are unchanged. All of these SHALL be derived on every scan
from the repository; the dashboard MUST NOT store them anywhere else, and MUST NOT write `depends-on.yaml` except when
creating a change (change-creation).

#### Scenario: Both directions
- **WHEN** `add-billing-ui` depends on `add-billing-api`
- **THEN** `add-billing-ui`'s snapshot lists `add-billing-api` with its state, and `add-billing-api`'s snapshot lists `add-billing-ui` as required by

#### Scenario: Repository without the convention
- **WHEN** no change of a repository has a `depends-on.yaml`
- **THEN** no change of that repository carries a dependency list, a required-by list or a blocked flag

#### Scenario: Scanning writes nothing
- **WHEN** a scan reads changes that declare dependencies, including a malformed file and a cycle
- **THEN** no file under the repository is created, modified or deleted
