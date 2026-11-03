# Spec Delta

## ADDED Requirements

### Requirement: Merge endpoint
`POST /api/sessions/<id>/merge` SHALL merge the ready open pull request linked to that change session's branch (or, when optional `{ proposal: true }` is passed, the ready open proposal pull request on `docs/<change>`) directly on the server via `gh pr merge <number> --repo <owner/name> --squash --match-head-commit <headOid>` and return the updated session together with `{ merged: true, number, headOid }`, refreshing the repository's pull-request cache. The endpoint SHALL work whether the session's agent is currently `running` or `exited`, without starting, resuming, or typing into an agent process. It MUST be refused with `403` when agent sessions are disabled or the repository is excluded from them, `404` for an unknown session, `409` when the session is in place, belongs to no change, has no ready open pull request with a 40-character hexadecimal `headOid` in the repository's cached pull-request list, or when `gh pr merge` is rejected by GitHub (for example because a commit was pushed since), and `503` when `gh` is not installed. The route is a mutating request under the same-origin protection.

#### Scenario: Merging a ready pull request of an exited session
- **WHEN** `POST /api/sessions/<id>/merge` is called for an exited Implement session on `feat/cache-api-calls` whose open pull request `#41` is ready at head commit `c0ffee0123456789abcdef0123456789abcdef01`
- **THEN** the server runs `gh pr merge 41 --repo acme/demo-ops --squash --match-head-commit c0ffee0123456789abcdef0123456789abcdef01`, starts no agent process, refreshes the repository's pull-request cache, and returns `200` with `{ merged: true, number: 41, headOid: "c0ffee0123456789abcdef0123456789abcdef01" }`

#### Scenario: Merging a not-ready pull request is refused
- **WHEN** `POST /api/sessions/<id>/merge` is called while `#41`'s checks are pending
- **THEN** the response is `409` and no `gh` process is started

#### Scenario: Foreign origin
- **WHEN** a page from another origin sends `POST /api/sessions/<id>/merge`
- **THEN** the response is `403` and no `gh` process is started

## MODIFIED Requirements

### Requirement: The dashboard never writes to tracked repositories
The dashboard MUST NOT write to a tracked repository except in response to an explicit user action — or, for the automatic fetch of (9), the repository's auto-fetch setting, which is on unless the user switched it off for that one repository, and for the automatic post-exit Ship of (10) when a managed session finishes its work — and then only as enumerated here: (1) `openspec/config.yaml`, where only the managed sections of the `context` and `rules` keys are modified (applying shared OpenSpec config profiles), as specified in the `shared-config` capability — only when neither `openspec/` nor `openspec/config.yaml` is a symbolic link, and written by renaming over it a temporary file in `openspec/` that the apply created exclusively under a name of its own and that it removes whenever that rename does not happen; (2) for agent sessions, creating a git worktree and its branch for a session (`git worktree add`, preceded by `git worktree prune`), with the worktree's directory placed under `~/.spec-control/worktrees/` and never inside the repository's working tree, and removing such a worktree with a non-forcing `git worktree remove` (preceded by `git worktree unlock`) after the user confirmed — or, for a session that carries the auto-merge record, after a pull-request query result showed that session's pull request merged while the project has docs auto-merge on, as specified in the `agent-sessions` capability — and read-only checks proved that it holds no uncommitted change and no work that exists nowhere else; (3) the pull action: `git fetch` from the repository's own remote followed by a fast-forward-only `git merge` of the main checkout's upstream, with repository hooks disabled, as specified in the `repository-pull` capability, and — only after the user confirmed Resolve and pull and the re-checks of that capability proved every blocking file to be an unchanged change leftover — removing exactly those leftover files from the main checkout's index (`git rm --cached`) and working tree immediately before the retried fast-forward, having first saved a copy of each leftover that differs under `~/.spec-control/`, and, when that fast-forward is still refused, writing those same files back with their previous content and re-staging the ones that had been staged (`git add -- <those paths>`); (4) creating a new change directory at `openspec/changes/<name>/`, only when neither `openspec/` nor `openspec/changes/` is a symbolic link, with its `.openspec.yaml` marker, an optional `prompt.md`, an optional `depends-on.yaml` and, for a change imported from a GitHub issue, an `issue.yaml`, as specified in the `change-creation` capability — the dashboard writes those files itself and MUST NOT invoke the `openspec` CLI or any other external command for it; (5) staging that new change directory, and only it, with a single `git add -- openspec/changes/<name>/` once those files are written, as specified in the `change-creation` capability — best-effort, never failing the creation, and never run for a refused create; (6) repository cleanup, as specified in the `repository-cleanup` capability, on the user's confirmation of items the user selected: removing any linked worktree of the repository with a non-forcing `git worktree remove` (preceded by `git worktree unlock` only for a worktree the dashboard created) after read-only checks proved that it holds no uncommitted change and no work that exists nowhere else, removing stale worktree records with `git worktree prune`, and deleting a local branch other than the default branch and the main checkout's branch with `git branch -D` after read-only checks proved that its work is in the default branch and that it still points at the commit the user saw — whether the user selected it in repository cleanup or confirmed it as a stale leftover in a stale change's cleanup; and, for each linked worktree the user confirmed either in the deletion dialog of that capability ("One branch and its worktree can be deleted whatever they hold") or in a stale change's cleanup of the `stale-changes` capability ("A stale change's leftovers are cleaned up on one confirmation"), after re-checking that the worktree, its branch, its commit and its uncommitted files are what the dialog showed and that no session runs in it, removing that worktree with `git worktree remove --force` (preceded by `git worktree unlock` only for a worktree the dashboard created, never forcing a lock) even though it has uncommitted changes, having first copied its uncommitted, non-ignored files under `~/.spec-control/`, and deleting its branch with `git branch -D` whatever its merge state, other than the default branch and the main checkout's branch, if it still points at the commit the user saw; (7) dismissing a change, as specified in the `change-dismissal` capability, on the user's confirmation — or, for the main checkout's change directory of a change that is archived on the default branch and that the user confirmed as a stale leftover in a stale change's cleanup of the `stale-changes` capability, with every file that differs from the archive's copy saved under `~/.spec-control/` first: deleting an active change's directory `openspec/changes/<name>/` from the main checkout — never a directory under `openspec/changes/archive/`, never a symbolic link's target, never when `openspec/`, `openspec/changes/` or the change directory itself is a symbolic link, never anything in a linked worktree — after re-checking that its content is what the confirmation showed and that no agent session for the change is running, then staging that removal, and only it, with a single `git add --all -- openspec/changes/<name>/` — best-effort, never failing the dismissal, and never run for a refused dismissal; (8) the home migration, as specified in the requirement on moving the home from its old name: once the user has started a binary that finds only the old home, running `git worktree repair` for the worktrees the dashboard itself created, with their new paths under `~/.spec-control/worktrees/`, which rewrites only the repository's administrative record of where those linked worktrees are (`.git/worktrees/<name>/gitdir`) and those worktrees' own `.git` files — it MUST NOT touch any other worktree, the main checkout's working tree, index, `HEAD` or any ref, and MUST NOT contact a remote; (9) the automatic fetch, as specified in the `repository-pull` capability, for every enabled git repository with a remote whose auto-fetch setting the user has not switched off: exactly the pull action's `git fetch` from the repository's own remote, on that setting's interval, which writes only remote-tracking refs, `FETCH_HEAD` and objects — it MUST NOT fast-forward, merge, prune, or change the main checkout's branch, index or working tree or any linked worktree; (10) deterministic session worktree operations inside a managed session worktree under `~/.spec-control/worktrees/` (never in the repository's main checkout): recording `spec-control.branch` or `spec-control.archive-branch` in the change's `.openspec.yaml` (or archived `.openspec.yaml`) by atomic temp-file rename after checking with `lstat` that no path segment is a symbolic link; moving `openspec/changes/<name>/` to `openspec/changes/archive/<YYYY-MM-DD>-<name>/` for a deterministic Archive of a synced `Done` change; deleting `openspec/changes/<name>/` for a deterministic Remove duplicate when `differingCount === 0`; running `git cherry-pick <commit>` (and `git cherry-pick --abort` on conflict) for Carry over archive; and, for Ship (manual or automatic on clean session exit), staging and committing worktree changes (`git add --all` and `git commit -m <message>`) and pushing the session branch to `origin` (`git push --set-upstream origin HEAD:refs/heads/<branch>`), with repository hooks disabled. Outside tracked repositories, the dashboard writes beyond `~/.spec-control/` in exactly three places: creating a new project (`git init`), cloning a GitHub repository (`git clone`), and creating a workspace folder in the setup wizard, as specified in those capabilities. Apart from the pull action and the main-checkout create/dismiss/stale-cleanup operations above, the dashboard MUST NOT change the main checkout's working tree, index, or branch at all. In the main checkout it MUST NOT commit, push, stash or reset under any circumstances. Apart from the pull action, the automatic fetch, and the session worktree `git push` of Ship, the only network access the dashboard makes is the pull-request query and `gh pr create` / `gh pr merge` of the `pull-requests` capability, `gh pr close` of `change-dismissal`, the issue query of `issue-import`, the repository listing and clone of `github-repositories`, and the update check of `update-notice`. Scanning, polling, discovery, previews, reading work statuses and saving any dashboard setting MUST NOT write to a tracked repository or managed worktree. Every git invocation MUST run with optional locks disabled (`GIT_OPTIONAL_LOCKS=0`). With agent sessions disabled the dashboard MUST NOT start any agent process or run any session worktree operation.

#### Scenario: No side effects
- **WHEN** a full scan runs across all tracked repos
- **THEN** no file under any tracked repository is created, modified or deleted

#### Scenario: Status does not refresh the index
- **WHEN** a scan runs `git status` in a repository whose index has stale stat information
- **THEN** the repository's `.git/index` file is byte-for-byte unchanged afterwards

#### Scenario: Preview and save have no side effects
- **WHEN** shared config profiles are saved and a preview is requested for every tracked repository
- **THEN** no file under any tracked repository is created, modified or deleted

#### Scenario: Apply touches exactly one file
- **WHEN** shared config profiles are applied to a repository
- **THEN** `openspec/config.yaml` is the only path under that repository that is created, modified or deleted

#### Scenario: Opening a session leaves the main checkout alone
- **WHEN** a session is opened for a change
- **THEN** the repository's checked-out branch and `git status` are unchanged, and no new file or directory appears in its working tree

#### Scenario: Reading work statuses has no side effects
- **WHEN** work statuses are read for a worktree whose index has stale stat information
- **THEN** no file in the worktree or in the repository's git directory is modified

#### Scenario: A refused session creates nothing
- **WHEN** opening a session is refused
- **THEN** no worktree and no branch is created

#### Scenario: Feature disabled means no processes
- **WHEN** agent sessions are disabled and any API request is made
- **THEN** no agent process is started and no repository is touched

#### Scenario: No network unless asked
- **WHEN** every tracked repository has auto fetch switched off, the update check is turned off, and the dashboard starts, serves the UI, runs full scans on its poll interval and reads work statuses, and nobody uses the pull action or Add from GitHub
- **THEN** no git command that contacts a remote is run, no network connection is opened, and no main checkout's index or working tree changes

#### Scenario: Pull changes only what a fast-forward changes
- **WHEN** the pull action is used on a repository
- **THEN** only its git directory and the files the fast-forward updates in its main checkout change, its checked-out branch is the same as before, and no linked worktree's files, index or branch change

#### Scenario: Resolving leftovers touches only the leftovers
- **WHEN** the user confirms Resolve and pull for a repository blocked by two change leftovers while `notes.md` has an unrelated uncommitted edit
- **THEN** the only paths removed from the index and working tree before the fast-forward are those two files, `notes.md` keeps its edit, no commit, stash, reset or branch change happens, and copies are written only under `~/.spec-control/`

#### Scenario: Offering a resolution writes nothing
- **WHEN** a pull is refused because of change leftovers and the result offers Resolve and pull
- **THEN** until the user confirms, no file, index entry or ref under the repository has changed beyond the fetch

#### Scenario: Create-change touches only the new directory
- **WHEN** a change is created via `POST /api/repos/<id>/changes`
- **THEN** the only path under that repository that is created, modified or deleted is the new `openspec/changes/<name>/` directory and its files, and the only other effect is those same files being added to the repository's index

#### Scenario: Create-change stages nothing else
- **WHEN** a change is created in a repository that already has unrelated modified and untracked files
- **THEN** none of those files is staged, and no ref, branch or commit changes

#### Scenario: Failed create writes nothing
- **WHEN** `POST /api/repos/<id>/changes` is refused for any reason
- **THEN** no file, directory, index entry or git ref under that repository changes, and no git command is run

#### Scenario: Cleanup preview has no side effects
- **WHEN** a cleanup preview is computed for a repository with merged worktrees and branches
- **THEN** no file under the repository, its git directory or its worktrees is created, modified or deleted, and no ref changes

#### Scenario: Cleanup deletes only confirmed local branches
- **WHEN** the user confirms a cleanup that selects one merged branch while two other merged branches exist
- **THEN** exactly that one `refs/heads/` ref is deleted, and no other ref, including every `refs/remotes/` ref, changes

#### Scenario: Dismissal touches only the change directory
- **WHEN** a change is dismissed via `POST /api/repos/<id>/changes/<name>/dismiss` in a repository with unrelated modified and untracked files and a linked worktree holding a copy of the change
- **THEN** the only path under that repository that is deleted is `openspec/changes/<name>/` in the main checkout, the only other effect is its removal being staged, and no other file, index entry, ref, commit or linked worktree changes

#### Scenario: Refused dismissal writes nothing
- **WHEN** `POST /api/repos/<id>/changes/<name>/dismiss` is refused for any reason
- **THEN** no file, directory, index entry or git ref under that repository changes, and no git command that writes is run

#### Scenario: Discovery has no side effects
- **WHEN** discovery looks up the `origin` remote of candidates and configured repositories
- **THEN** no file under any of those repositories, including their git config, is created, modified or deleted

#### Scenario: Pull-request query leaves repositories alone
- **WHEN** the pull requests of every tracked repository are refreshed
- **THEN** no file under any tracked repository, its git directory or its worktrees is created, modified or deleted, and only `gh pr list` and `gh api user` processes were started, none of them in a tracked repository's directory

#### Scenario: The conflict check writes nothing into the repository
- **WHEN** work statuses with their conflict signal are computed for every session worktree of a repository
- **THEN** no file under that repository, including its object database, index and refs, is created, modified or deleted

#### Scenario: Creating a project writes one folder and its git directory
- **WHEN** a project `gamma-tools` is created under the workspace root `/w/acme`
- **THEN** the only new path under `/w/acme` is `/w/acme/gamma-tools`, holding only `.git` from `git init`, every tracked repository is byte-for-byte unchanged, and no git command other than `git init` was run for it

#### Scenario: Opening a project console leaves the main checkout alone
- **WHEN** a project console is opened for a tracked git repository
- **THEN** until the agent acts, the repository's checked-out branch, index, working tree and refs are unchanged, no worktree or branch is created, and the dashboard has run no git command for the session

#### Scenario: Create touches only the new change directory
- **WHEN** a change is created with a prompt and dependencies
- **THEN** the only paths created under the repository are `openspec/changes/<name>/.openspec.yaml`, `prompt.md` and `depends-on.yaml`, no existing change's files change, and the index changes only by those three files

#### Scenario: Change session in a repository without a commit
- **WHEN** agent sessions are enabled and the user starts **Draft artifacts** for a change of a tracked git repository that has no commit yet
- **THEN** the agent starts in the repository's main checkout, and the dashboard creates no worktree or branch, writes no file and runs no git command there for the session

#### Scenario: Merged auto-merge pull request removes only the session worktree
- **WHEN** a pull-request refresh shows the archive pull request of a session that carries the auto-merge record as merged, and its worktree is clean and pushed
- **THEN** the only change under the repository is that worktree's removal by a non-forcing `git worktree remove`, the session's local branch and every other ref are unchanged, no fetch runs, and the only processes the refresh itself started are `gh pr list` and `gh api user`

#### Scenario: The home migration re-registers only the dashboard's own worktrees
- **WHEN** the old home holds a session worktree of `demo-ops` and `demo-ops` also has a linked worktree the user created elsewhere
- **THEN** after the migration git lists the session worktree at its path under `~/.spec-control/worktrees/`, the user's worktree record is unchanged, and the main checkout's branch, index, working tree and refs are unchanged

#### Scenario: Issue query leaves repositories and GitHub alone
- **WHEN** the user opens Import from issues for a repository and refreshes its list
- **THEN** no file under any tracked repository, its git directory or its worktrees is created, modified or deleted, and only `gh issue list` processes were started for it, none of them in a tracked repository's directory

#### Scenario: Importing an issue touches only the new change directory
- **WHEN** a change is imported from an issue
- **THEN** the only paths created under the repository are `openspec/changes/<name>/.openspec.yaml`, `prompt.md` and `issue.yaml`, the index changes only by those three files, and no `gh` process is started by the create

#### Scenario: Automatic fetch writes only what a fetch writes
- **WHEN** a repository with auto fetch on is automatically fetched while its main checkout has uncommitted edits and is behind its upstream
- **THEN** its remote-tracking refs have moved, and its branch, `HEAD`, `.git/index`, working tree and linked worktrees are byte-for-byte unchanged

#### Scenario: Scans never fetch
- **WHEN** a repository has auto fetch on and a full scan, discovery and a page load run
- **THEN** none of them contacts the repository's remote; only the auto-fetch schedule does

#### Scenario: Without the setting nothing is fetched
- **WHEN** every tracked repository has auto fetch switched off and the dashboard runs for hours with the board open
- **THEN** no repository's remote is contacted

#### Scenario: The update check touches no repository
- **WHEN** an update check runs
- **THEN** no git or `gh` process is started, no file under any tracked repository changes, and the only file written is `~/.spec-control/update-check.json`

#### Scenario: Cloning writes one folder in a workspace root
- **WHEN** the user clones `acme/beta-soc` into the workspace root `/w/acme`
- **THEN** the only new path under `/w/acme` is `/w/acme/beta-soc` with the clone, every tracked repository is byte-for-byte unchanged, and the only processes started for it are one `git clone` and, after it, the read-only git commands of a scan

#### Scenario: A failed clone leaves nothing
- **WHEN** a clone into `/w/acme/beta-soc` fails and git left the folder empty
- **THEN** `/w/acme/beta-soc` does not exist and nothing else under `/w/acme` changed

#### Scenario: Listing GitHub repositories touches nothing
- **WHEN** the user opens Add from GitHub and refreshes its list
- **THEN** no file under any tracked repository, any workspace root or the dashboard home is created, modified or deleted, and only `gh repo list` and `gh api user` processes were started, none of them in a tracked repository's directory

#### Scenario: Creating a workspace folder writes one empty folder
- **WHEN** the setup wizard creates `~/Workspace`
- **THEN** `~/Workspace` is the only new path outside the dashboard home, it is empty, and no process was started for it

#### Scenario: A confirmed branch deletion touches only that worktree and branch
- **WHEN** the user confirms the deletion of a worktree on `feat/report` that has an uncommitted edit, while another linked worktree and the main checkout also have uncommitted edits
- **THEN** that worktree's directory and the branch `feat/report` are gone, its edited file has a copy under `~/.spec-control/branch-backups/`, the other worktree, the main checkout's branch, `.git/index` and working tree and every `refs/remotes/` ref are unchanged, and no remote is contacted

#### Scenario: A stale change's cleanup removes only what it listed
- **WHEN** the user confirms the cleanup of a stale change whose leftovers are one worktree on `feat/rotate-keys` with an uncommitted file and the branch `chore/archive-rotate-keys`, while another worktree on `feat/report` exists
- **THEN** the uncommitted file has a copy under `~/.spec-control/branch-backups/`, that worktree and both listed branches are gone, the worktree on `feat/report`, the main checkout's branch, `.git/index` and working tree and every `refs/remotes/` ref are unchanged, and no remote is contacted

#### Scenario: No write passes through a symbolic link
- **WHEN** `openspec/changes` in `demo-ops` is a symbolic link to `/w/acme/shared-changes`, and the user creates a change, dismisses a change and applies shared config profiles there
- **THEN** the create and the dismissal are refused with `409`, the apply still writes `openspec/config.yaml` in place, and nothing under `/w/acme/shared-changes/` is created, modified or deleted

#### Scenario: Apply leaves no temporary file
- **WHEN** an apply to `demo-ops` fails after its temporary file was written
- **THEN** `openspec/` holds exactly the files it held before the apply

#### Scenario: Deterministic Ship leaves the main checkout alone
- **WHEN** `POST /api/sessions/<id>/ship` commits, pushes, and opens a pull request from a managed session worktree
- **THEN** the repository's main checkout working tree, index, and checked-out branch are byte-for-byte unchanged

### Requirement: Session endpoints

The API SHALL provide: `POST /api/sessions` with `{ repoId, change, action }` to open a session — with optional `resolveConflicts: true`, `carryOverArchive: true`, or `removeDuplicate: true`, taking the branch, pull request, stranded archive commit, or duplicate archive directory from the server's own scan and pull-request cache and ignoring any extra fields in the request — (returning, once the request passed the refusals listed below, the session that is already running for that repository and change if there is one, whatever action was asked for, `archive` included, and starting nothing in that case). When `action` is `"archive"` and the operation can be completed deterministically on the server without an LLM (a `Done` change with `subState: "complete"` and `specsSynced !== false`, a `carryOverArchive` whose `git cherry-pick` succeeds cleanly with only `openspec/` paths, or a `removeDuplicate` with `differingCount === 0`), `POST /api/sessions` SHALL create the archive worktree on `chore/archive-<change>`, perform the archive move, cherry-pick, or duplicate removal, record `spec-control.archive-branch`, commit, push, and open the pull request directly on the server without starting an agent process, and return `201` with the completed session record (`status: "exited"`, `exitCode: 0`) and `shipped: true`. When LLM work is required (`specsSynced === false`, `subState === "validate"`, a cherry-pick conflict, or `differingCount > 0`), `POST /api/sessions` SHALL start the agent process in the worktree as before. The API SHALL also provide: `GET /api/sessions` returning the sessions and, for each configured agent, whether its executable was found; `GET /api/sessions/<id>`; `GET /api/sessions/<id>/worktree` reporting whether the worktree could be removed safely; `POST /api/sessions/<id>/resume`; `POST /api/sessions/<id>/close` with optional `{ removeWorktree }`, which ends the agent if it is running; and `DELETE /api/sessions/<id>` for a session that is not running. Opening MUST be refused with `403` when agent sessions are disabled or the repository is excluded from them, with `404` for an unknown repository or change, with `409` when the repository is not tracked or its last scan failed, with `400` for an invalid change name, an unknown action, an action not available in the change's stage or (when an agent process is started) an agent without a prompt for it, with `503` when an agent process must be started and its executable is not found, and with `500` and git's reason when the worktree cannot be created. All session routes other than `GET` are mutating and subject to the same-origin protection that applies to every mutating API request. `GET /api/state` SHALL remain unchanged.

#### Scenario: Duplicate open
- **WHEN** a session for repository `r` and change `c` is running and `POST /api/sessions` is sent again for `r` and `c`
- **THEN** the response contains the existing session and no second process is started

#### Scenario: Another action for a change that has a session
- **WHEN** a session for repository `r` and change `c` is running and `POST /api/sessions` is sent for `r` and `c` with `action: "archive"`
- **THEN** the response contains that running session, no worktree is created, no process is started and nothing is written to its terminal

#### Scenario: Deterministic archive of a synced Done change
- **WHEN** `POST /api/sessions` is sent with `{ repoId, change: "rotate-keys", action: "archive" }` for a `Done` change with `subState: "complete"` and `specsSynced: true`
- **THEN** the server moves `openspec/changes/rotate-keys/` to `openspec/changes/archive/<YYYY-MM-DD>-rotate-keys/` in the archive worktree, records `archive-branch`, commits, pushes, opens the pull request, starts no agent process, and returns `201` with the completed session record

#### Scenario: Feature disabled
- **WHEN** agent sessions are disabled and `POST /api/sessions` is called
- **THEN** the response is `403`, no worktree is created and no process is started

#### Scenario: Session routes are same-origin only
- **WHEN** a page from another origin sends `POST /api/sessions`
- **THEN** the response is `403` and no session is opened

#### Scenario: Deleting a running session
- **WHEN** `DELETE /api/sessions/<id>` targets a running session
- **THEN** the response is `409` and the session keeps running

#### Scenario: Resolve conflicts for a change without a worktree
- **WHEN** `POST /api/sessions` is sent with `{ repoId, change, resolveConflicts: true }` for a change whose linked open pull request is cached as `conflicting`, from a head branch known as `origin/<branch>`, and no session worktree of the change exists
- **THEN** a session is started in a new worktree on that head branch and returned

#### Scenario: Resolve conflicts with nothing to resolve
- **WHEN** `POST /api/sessions` is sent with `resolveConflicts: true` for a change with no conflict signal
- **THEN** the response is `409` with the reason, and no worktree is created and no process is started

### Requirement: Worktree and ship endpoints

`GET /api/sessions` SHALL additionally return `worktrees`: one entry per session worktree directory of a configured repository with `repoId`, `name`, `path`, the `change` and `action` it belongs to, its `branch`, its work status, the time of its last activity, and the id of its most recent session if a record exists. When agent sessions are disabled the list SHALL be empty and no git command SHALL be run for it. `POST /api/sessions/<id>/ship` (with an optional JSON body `{ title?: string }`) SHALL perform the deterministic Ship action directly on the server in the session's worktree — recording the branch in `.openspec.yaml`, committing any uncommitted changes, pushing the branch to `origin`, and creating or reusing the pull request on GitHub — without starting, resuming, or typing into an agent process, and return the session together with `{ shipped: true, pullRequestUrl?, pullRequestNumber?, autoMergeInstructionIncluded }`; it MUST be refused with `403` when agent sessions are disabled, `409` when the session is in place or there is nothing to ship (`merged`, `clean`, or `missing`), and `500` with the masked git or `gh` reason when committing, pushing, or opening the pull request fails. `POST /api/worktrees/remove` with `{ repoId, name }` SHALL remove that worktree under the clean-up rules and return whether it was removed and, if not, why; `repoId` MUST be a configured repository and `name` MUST be a single path segment of lower-case letters, digits, dots, dashes and underscores, otherwise the response is `404` or `400`; it MUST be refused with `409` while a session is running in the worktree. Both `POST` routes are subject to the same-origin protection.

#### Scenario: Worktrees in the session list
- **WHEN** agent sessions are enabled and one session worktree with an untracked file exists
- **THEN** `GET /api/sessions` returns it in `worktrees` with status `uncommitted`

#### Scenario: Deterministic Ship on an ended session
- **WHEN** `POST /api/sessions/<id>/ship` is called on an ended session whose worktree has status `uncommitted`
- **THEN** the server records the branch in `.openspec.yaml`, commits, pushes, opens a pull request via `gh pr create`, starts no agent process, and returns `200` with `shipped: true`

#### Scenario: Path traversal
- **WHEN** `POST /api/worktrees/remove` is sent with `name` set to `../x`
- **THEN** the response is `400` and no git command is run

#### Scenario: Removing under a running session
- **WHEN** `POST /api/worktrees/remove` names the worktree of a running session
- **THEN** the response is `409` and the worktree is kept

### Requirement: A remove-duplicate session request is checked against the last scan
The session start request SHALL accept `removeDuplicate: true` together with `action: "archive"`, a tracked repository
and a validated change name, and nothing else describing the duplicate. The server SHALL refuse it with a 4xx status and
the reason when the action is not `archive`, when its own last scan reports no duplicate after archive for that change,
when a local branch `chore/archive-<name>` exists or a worktree is on it, or when a session for the change is running;
otherwise it SHALL either remove the identical duplicate and ship the archive branch deterministically when
`differingCount === 0` or start the session with the archive directory and differing paths of that scan when
`differingCount > 0`. The request passes the same-origin guard of every mutating route.

#### Scenario: Smuggled archive name
- **WHEN** a request carries `removeDuplicate: true` and an `archive` field naming another directory
- **THEN** the extra field is ignored and the server uses the archive directory from the last scan

#### Scenario: Wrong action
- **WHEN** a request carries `removeDuplicate: true` with `action: "implement"`
- **THEN** it is refused and no session starts

### Requirement: Writing git commands run no hooks and ignore configuration that would widen them
Every git command the dashboard runs that writes to a tracked repository or a managed session worktree, as enumerated in
"The dashboard never writes to tracked repositories" — the pull action's and the automatic fetch's `fetch`, the
fast-forward `merge`, the leftover `rm --cached` and restoring `add`, the create-change and dismissal `add`, `branch -D`,
`worktree add`, `remove`, `unlock`, `prune` and `repair`, and the session worktree's `add`, `commit`, `push`, and
`cherry-pick` — SHALL run with `core.hooksPath` pointed at an empty folder under the dashboard home and with automatic
maintenance off, so that no hook of the repository, of the user's global hooks folder or of a git template runs. Where a
configuration setting of the system, the user or the repository would make such a command do more than its requirement
allows, the command SHALL be given the command-line option that overrides it, as specified per command in the
`repository-pull` capability and with `--no-verify` on `git commit` and `git push`. These are options and `-c` settings
of the subcommands already enumerated; they MUST NOT add a subcommand. `git init` of a new project and the GitHub clone
keep their own requirements.

#### Scenario: A reference-transaction hook
- **WHEN** a tracked repository has an executable `reference-transaction` hook that appends to a log file, and the user
  pulls it, an automatic fetch runs, a session worktree is created, committed, pushed and later removed, and a cleanup
  deletes a merged branch
- **THEN** the log file is empty and every one of those actions has its usual outcome

#### Scenario: A global hooks folder
- **WHEN** the user's global configuration sets `core.hooksPath` to a folder holding an executable `post-index-change`
  hook, and the user creates a change and then dismisses another
- **THEN** the hook never runs, and both directories are staged as before

#### Scenario: No new subcommand
- **WHEN** every git invocation of a pull, a Resolve and pull, a cleanup, a stale cleanup, and a deterministic Ship is recorded
- **THEN** each writing invocation's subcommand is one of those already enumerated, preceded only by `-c` settings
