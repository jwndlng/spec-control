## ADDED Requirements

### Requirement: Pull and fetch ignore configuration that would change what they do
The fast-forward of the pull action and of Resolve and pull SHALL be run so that it cannot stash, rebase or update a
submodule whatever the configuration says (`merge --ff-only --no-autostash` with `submodule.recurse` off), and the fetch
of the pull action and of the automatic fetch SHALL be run so that it cannot prune (`--no-prune --no-prune-tags`) or
recurse into submodules. Hooks SHALL NOT run for the fetch, the fast-forward, the leftover removal from the index or the
restoring `add`, as required by "Writing git commands run no hooks and ignore configuration that would widen them" in the
`dashboard-api` capability. A refusal caused by these options SHALL be reported like any other refusal.

#### Scenario: Autostash configured
- **WHEN** the user's configuration sets `merge.autoStash=true`, `src/app.ts` has an uncommitted edit and an incoming
  commit changes `src/app.ts`
- **THEN** the pull is refused listing `src/app.ts` as local work, the edit and the index are unchanged, there are no
  conflict markers, and `git stash list` is empty

#### Scenario: Prune configured
- **WHEN** the repository sets `fetch.prune=true` and `remote.origin.prune=true`, and the branch behind
  `origin/feat/old-work` was deleted on the remote
- **THEN** after an automatic fetch and after a pull `refs/remotes/origin/feat/old-work` still exists

#### Scenario: Hook on fetch
- **WHEN** the repository has an executable `reference-transaction` hook and an automatic fetch moves `origin/main`
- **THEN** `origin/main` moved and the hook did not run

#### Scenario: Hook on Resolve and pull
- **WHEN** the repository has an executable `post-index-change` hook and the user confirms Resolve and pull for a staged
  leftover
- **THEN** the leftover is removed from the index, the checkout is fast-forwarded, and the hook did not run

### Requirement: Blocking files are classified from a project in a subfolder
For a project in a subfolder of its git repository, the blocking files SHALL be determined, classified, copied, removed
and put back by their paths relative to the repository's top level, read and addressed the same way by every git command
and file operation involved, so that the file that is judged is the file that is touched. A path SHALL be a change
leftover candidate only when it lies in the project's own `openspec/changes/<name>/`; any other blocking path, inside or
outside the project, SHALL be local work. Blocking files SHALL be shown relative to the top level, which for a project at
the top level is unchanged.

#### Scenario: Leftover in a subfolder project
- **WHEN** the project `/w/acme/monorepo/packages/tools` has a staged `openspec/changes/add-login/.openspec.yaml` that the
  incoming commits add with the same content, and git refuses the fast-forward
- **THEN** `packages/tools/openspec/changes/add-login/.openspec.yaml` is listed as an identical change leftover, Resolve and
  pull is offered, and after confirmation the checkout is fast-forwarded

#### Scenario: Same relative path at the top level
- **WHEN** in that repository both `openspec/changes/add-login/prompt.md` at the top level and
  `packages/tools/openspec/changes/add-login/prompt.md` are staged new files the incoming commits add
- **THEN** for the project `packages/tools` the top-level file is local work, no resolution is offered, and neither file,
  the index nor the branch changes

### Requirement: Pulls and fetches are serialised per git repository
The rule of "An automatic fetch and a pull never overlap" SHALL apply per git repository, identified by its git common
directory, not per project: for several tracked projects in one git repository at most one fetch, pull or Resolve and pull
SHALL run at a time, a pull SHALL wait for an automatic fetch of any of them, a second pull or Resolve and pull SHALL be
refused as already running, and an automatic fetch that finds any of them running SHALL be skipped and retried one
interval later. Each project's automatic-fetch outcome SHALL still be reported with that project.

#### Scenario: Two projects in one repository
- **WHEN** `/w/acme/monorepo/packages/a` and `/w/acme/monorepo/packages/b` are tracked and the user pulls `a` while a pull
  of `b` runs
- **THEN** the pull of `a` is refused as already running and only one fast-forward of the checkout happens

#### Scenario: Automatic fetch of a sibling project
- **WHEN** an automatic fetch of `packages/b` falls due while the user's pull of `packages/a` runs
- **THEN** no second fetch is started, and `b`'s next automatic fetch is one interval later
