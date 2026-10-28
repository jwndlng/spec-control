## ADDED Requirements

### Requirement: Writing git commands run no hooks and ignore configuration that would widen them
Every git command the dashboard runs that writes to a tracked repository, as enumerated in "The dashboard never writes
to tracked repositories" — the pull action's and the automatic fetch's `fetch`, the fast-forward `merge`, the leftover
`rm --cached` and restoring `add`, the create-change and dismissal `add`, `branch -D`, and `worktree add`, `remove`,
`unlock`, `prune` and `repair` — SHALL run with `core.hooksPath` pointed at an empty folder under the dashboard home and
with automatic maintenance off, so that no hook of the repository, of the user's global hooks folder or of a git
template runs. Where a configuration setting of the system, the user or the repository would make such a command do
more than its requirement allows, the command SHALL be given the command-line option that overrides it, as specified per
command in the `repository-pull` capability. These are options and `-c` settings of the subcommands already enumerated;
they MUST NOT add a subcommand. `git init` of a new project and the GitHub clone keep their own requirements.

#### Scenario: A reference-transaction hook
- **WHEN** a tracked repository has an executable `reference-transaction` hook that appends to a log file, and the user
  pulls it, an automatic fetch runs, a session worktree is created and later removed, and a cleanup deletes a merged
  branch
- **THEN** the log file is empty and every one of those actions has its usual outcome

#### Scenario: A global hooks folder
- **WHEN** the user's global configuration sets `core.hooksPath` to a folder holding an executable `post-index-change`
  hook, and the user creates a change and then dismisses another
- **THEN** the hook never runs, and both directories are staged as before

#### Scenario: No new subcommand
- **WHEN** every git invocation of a pull, a Resolve and pull, a cleanup and a stale cleanup is recorded
- **THEN** each writing invocation's subcommand is one of those already enumerated, preceded only by `-c` settings
