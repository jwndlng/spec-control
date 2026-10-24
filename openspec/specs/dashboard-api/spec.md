# dashboard-api Specification

## Purpose
Defines the single-binary loopback server and its JSON API (state, config, discover, scan, activity), the shared-config endpoints, the cross-site protection of mutating requests, and the guarantee that the dashboard writes to tracked repositories only on an explicit user action and only to enumerated paths.

## Requirements

### Requirement: Single binary serves UI and API on loopback

The dashboard SHALL be built with `bun build --compile` into one executable named `spec-control` that serves the embedded SPA and the JSON API bound to `127.0.0.1` on the configured port (default 4711). Starting the binary SHALL print the URL and open the default browser unless `--no-open` is passed.

#### Scenario: Start
- **WHEN** the user runs `spec-control`
- **THEN** the server listens on `http://127.0.0.1:4711`, prints that URL, and the browser opens it

#### Scenario: Not reachable from the network
- **WHEN** another host on the LAN requests port 4711
- **THEN** the connection is refused

#### Scenario: Existing state carries over
- **WHEN** a user who ran an earlier `openspec-dashboard` binary starts `spec-control`
- **THEN** it moves the old home to `~/.spec-control/` once, as the home migration requirement specifies, and then uses the same configuration, sessions and worktrees as before

### Requirement: State endpoint

`GET /api/state` SHALL return the current `Snapshot` as JSON (`generatedAt`, `repos[]` with `changes[]` as defined in design.md), returning the cached snapshot until the first scan completes and an empty snapshot if no cache exists.

#### Scenario: Fresh install
- **WHEN** no repos are configured
- **THEN** `GET /api/state` returns `{ generatedAt, repos: [] }`

### Requirement: Config endpoints

`GET /api/config` SHALL return the config. `PUT /api/config` SHALL validate the body (absolute paths for `scanRoots`, `ignorePaths` and `repos[].path`, `pollIntervalSeconds >= 10`, unique repo ids, each repo `id` matching its canonical path), canonicalise all paths, persist it atomically, and return the saved config; invalid bodies MUST return `400` with a message and leave the config unchanged. A body without `ignorePaths` SHALL be accepted and saved with `ignorePaths: []`. If the set of enabled repos changed, a scan MUST be triggered. `PUT /api/config` SHALL keep the stored `setup` value whatever the body carries for it, so that a client holding an older copy of the configuration can neither end nor restart setup; only `POST /api/setup/done` clears it, and nothing sets it again.

#### Scenario: Invalid interval
- **WHEN** `PUT /api/config` is called with `pollIntervalSeconds: 1`
- **THEN** the response is `400` and the stored config is unchanged

#### Scenario: Relative ignore path is rejected
- **WHEN** `PUT /api/config` is called with `ignorePaths: ["relative/dir"]`
- **THEN** the response is `400` naming `ignorePaths.0` and the stored config is unchanged

#### Scenario: Paths are stored canonically
- **WHEN** `PUT /api/config` is called with a scan root given as `~/Workspace/alpha/` or through a symlink
- **THEN** the returned and stored config contain the canonical absolute path without a trailing separator

#### Scenario: Duplicate directory is rejected
- **WHEN** `PUT /api/config` is called with two repos whose paths resolve to the same directory
- **THEN** the response is `400` reporting a duplicate repo id

#### Scenario: Saving Settings does not change setup
- **WHEN** the stored config has `setup: "pending"` and `PUT /api/config` is called with a body without `setup`
- **THEN** the saved config still has `setup: "pending"`

#### Scenario: An old copy cannot restart setup
- **WHEN** setup was marked done and a client sends `PUT /api/config` with `setup: "pending"`
- **THEN** the saved config has no `setup` key

### Requirement: Discover endpoint

`POST /api/discover` SHALL run discovery and return `{ candidates: [...], integratable: [...], errors: [...] }`. The request MAY carry a JSON body with `scanRoots` and/or `ignorePaths`; when present they are used instead of the configured values, and each entry MUST be an absolute path after `~` expansion, otherwise the response MUST be `400` with a message. With no body the configured values are used. `candidates` SHALL contain only repositories found under the roots, outside the ignore paths, whose canonical path is not already in the saved config, each with `id`, canonical `path`, default `name` and `enabled: false`, sorted by path, and never the same directory twice. A candidate that shares its normalised `origin` remote with other known repositories SHALL carry `sameRemoteAs`, a list of `{ name, path, tracked }` for those repositories; otherwise the field is absent. `integratable` SHALL contain the git repositories found under the roots, outside the ignore paths, that hold no `openspec/config.yaml`, are not linked git worktrees, are not already in the saved config and do not contain a reported OpenSpec project, each with `id`, canonical `path` and default `name`, sorted by path and never the same directory twice; it is `[]` when there are none. `errors` SHALL list per-root problems. The endpoint MUST NOT persist anything and MUST NOT modify the in-memory config.

#### Scenario: Discover without saving
- **WHEN** `POST /api/discover` finds two new repos and the client never calls `PUT /api/config`
- **THEN** `GET /api/config` does not include the two repos

#### Scenario: Roots from the request body
- **WHEN** the saved config has no scan roots and `POST /api/discover` is called with `{ "scanRoots": ["/abs/workspace"] }`
- **THEN** the response lists the repositories under `/abs/workspace` as candidates and `GET /api/config` still returns empty `scanRoots`

#### Scenario: Ignore paths from the request body
- **WHEN** `POST /api/discover` is called with `{ "scanRoots": ["/abs/workspace"], "ignorePaths": ["/abs/workspace/mirror"] }`
- **THEN** no candidate has a path at or below `/abs/workspace/mirror` and `GET /api/config` still returns the saved `ignorePaths`

#### Scenario: Configured repos are not candidates
- **WHEN** the config already contains a repository at `/abs/workspace/a` (enabled or disabled) and discovery finds `/abs/workspace/a` and `/abs/workspace/b`
- **THEN** `candidates` contains only `/abs/workspace/b`

#### Scenario: Same directory through two roots
- **WHEN** `POST /api/discover` is called with two roots that resolve to the same directory
- **THEN** each repository below it appears once in `candidates`

#### Scenario: Shared remote is reported
- **WHEN** the config contains `/abs/a` and discovery finds `/abs/mirror/a` with the same `origin` remote
- **THEN** the candidate `/abs/mirror/a` has `sameRemoteAs` containing `{ "name": "a", "path": "/abs/a", "tracked": true }`

#### Scenario: Relative root is rejected
- **WHEN** `POST /api/discover` is called with `{ "scanRoots": ["relative/path"] }`
- **THEN** the response is `400` with a message and no walk is performed

#### Scenario: Missing root is reported, not fatal
- **WHEN** `POST /api/discover` is called with one existing and one non-existent root
- **THEN** the response is `200`, `errors` names the non-existent root, and `candidates` contains the repositories under the existing root

#### Scenario: Integratable repositories are returned
- **WHEN** `/abs/workspace/a` holds `openspec/config.yaml` and `/abs/workspace/b` is a git repository without it
- **THEN** `candidates` contains `/abs/workspace/a`, `integratable` contains `/abs/workspace/b`, and neither list contains the other's entry

#### Scenario: A container is not integratable
- **WHEN** `/abs/workspace/mono` is a git repository without the marker and `/abs/workspace/mono/pkg` holds `openspec/config.yaml`
- **THEN** `candidates` contains `/abs/workspace/mono/pkg` and `integratable` does not contain `/abs/workspace/mono`

#### Scenario: A tracked repository is in neither list
- **WHEN** the config contains `/abs/workspace/a` and discovery runs
- **THEN** `/abs/workspace/a` appears in neither `candidates` nor `integratable`

### Requirement: Scan endpoint

`POST /api/scan` SHALL trigger an immediate scan and return `{ started: true }`, or `{ started: false }` if a scan is already in flight.

#### Scenario: Trigger
- **WHEN** no scan is running and `POST /api/scan` is called
- **THEN** the response is `{ started: true }` and a new snapshot is available afterwards

### Requirement: Activity endpoint
`GET /api/activity` SHALL return `{ events, nextBefore?, newestId?, newerThanSince?, summary?, metrics? }`: recorded activity newest first, with consecutive task progress of one change already collapsed. Only events the activity log keeps — those within its 7-day retention window — SHALL be returned, pointed at or counted: an event older than that MUST NOT appear in `events`, MUST NOT be the reason for a `nextBefore`, MUST NOT be `newestId`, MUST NOT count towards `newerThanSince` and MUST NOT count towards `summary` or `metrics`. It SHALL accept `limit` (1–500, default 100), `before` (an event id; only older events are returned), `repos` (comma-separated repository ids), `kinds` (comma-separated event kinds), `since` (an event id, possibly empty) and `tz` (an IANA time zone name such as `Europe/Zurich`; `UTC` when absent). `nextBefore` SHALL be present when older events matching the filters exist; `newestId` SHALL be the id of the newest recorded event regardless of filters, and absent when there is none. When `since` is given, `newerThanSince` SHALL be the number of recorded events newer than that id regardless of filters — all of them for an empty `since`. When the request has no `before`, `summary` SHALL hold the figures of the Activity view's summary tiles — `created`, `moved`, `archived`, `tasksCompleted`, `sessions` and `attention` — and `metrics` SHALL hold the Activity view's metrics — `events` (the number of events), `changes` (the number of distinct changes touched, told apart by repository id and change name), `days` (for every calendar day in `tz` from the day holding the start of the retention window up to and including the current day, oldest first, `{ day, events, changes, groups, figures, hours }` with `day` as `YYYY-MM-DD`, `groups` the number of events per kind group `{ changes, tasks, sessions, repositories }`, `figures` that day's six summary figures with the same keys and rules as `summary`, and `hours` 24 numbers, the events whose time in `tz` falls in each hour `00`–`23`; all zero for a day without events) and `repos` (for every repository with at least one counted event, `{ repoId, repoName, events, changes, groups }` with the repository name of its newest counted event and `groups` as for a day, ordered by `events` descending, then by name). Both SHALL be computed over every retained event that matches `repos` and `kinds`, independent of `limit`, and counted on recorded events rather than collapsed entries; an event SHALL count on the day and in the hour of its time in `tz`. A request with `before` SHALL carry neither `summary` nor `metrics`. Invalid parameters, an unknown time zone among them, MUST return `400` with a message. The endpoint MUST NOT modify anything, and it MUST NOT return file system paths, terminal output or prompt text.

#### Scenario: Nothing recorded
- **WHEN** no activity has been recorded
- **THEN** the response holds `"events": []`, a `summary` whose figures are all `0`, and a `metrics` with `events: 0`, `changes: 0`, no `repos`, and one entry per day of the retention window, each with `events: 0`, `changes: 0`, every group and figure `0` and 24 hours of `0`

#### Scenario: Paging
- **WHEN** 250 events exist and the client requests `limit=100`, then repeats the request with `before` set to the returned `nextBefore`
- **THEN** the first response holds the newest 100 events, a `nextBefore`, and a `summary` and `metrics` counting all 250 events, the second holds the next 100 and neither `summary` nor `metrics`, and no event appears twice

#### Scenario: Filtering
- **WHEN** the client requests `repos=<id of demo-ops>&kinds=session-started,session-ended`
- **THEN** only those kinds of events of that repository are returned, `summary` and `metrics` count only those events, `metrics.repos` lists `demo-ops` alone with only `groups.sessions` above `0`, and `newestId` is still the newest event overall

#### Scenario: Breakdown of a day
- **WHEN** today holds a change-created event at 09:10, a task progress event `1/4 → 3/4` at 14:05 and a session-started event at 14:40, all in `tz`
- **THEN** today's `metrics.days` entry has `groups` `{ changes: 1, tasks: 1, sessions: 1, repositories: 0 }`, `figures` with `created: 1`, `tasksCompleted: 2` and `sessions: 1`, and `hours` with `1` at index 9, `2` at index 14 and `0` elsewhere

#### Scenario: Days in the client's time zone
- **WHEN** an event happened at `2026-10-06T23:30:00Z` and the client requests `tz=Europe/Zurich`
- **THEN** it counts in the `metrics.days` entry for `2026-10-07`, at hour index 1; requested without `tz`, it counts in the entry for `2026-10-06`, at hour index 23

#### Scenario: Unknown time zone
- **WHEN** the client requests `tz=Mars/Olympus`
- **THEN** the response is `400` with a message

#### Scenario: Counting what is new
- **WHEN** 5 events were recorded after the event with id `X` and the client requests `limit=1&since=X`
- **THEN** the response holds the newest event and `newerThanSince: 5`

#### Scenario: Older than the retention window
- **WHEN** the log holds 3 change-moved events from the last 7 days and 2 from 8 days ago, and the client requests `limit=3&since=`
- **THEN** the response holds the 3 recent events, no `nextBefore`, `newerThanSince: 3`, a `summary` with `moved: 3` and a `metrics` with `events: 3`

#### Scenario: Everything aged out
- **WHEN** every recorded event is older than 7 days
- **THEN** the response holds no events, a `summary` whose figures are all `0`, a `metrics` with `events: 0` and no `repos`, and no `newestId`

#### Scenario: Invalid limit
- **WHEN** the client requests `limit=0`
- **THEN** the response is `400` with a message

### Requirement: Create-change endpoint
`POST /api/repos/<id>/changes` SHALL create a new OpenSpec change in the repository identified by `<id>`. The request body SHALL be JSON `{ name, prompt?, dependsOn?, issue? }`, where `name` is a valid change name (`^[A-Za-z0-9._-]+$`), `prompt` is an optional string and `dependsOn` is an optional list of at most 32 distinct valid change names, none of them equal to `name`, and `issue` is an optional `{ number, title? }` naming the GitHub issue the change is imported from, with `number` a positive integer and `title` a string of at most 256 characters; with `issue` the server writes `issue.yaml` as the `change-creation` capability specifies, deriving the GitHub repository from the repository's `origin` remote. The names in `dependsOn` need not exist: a name that does not is reported as a `missing` dependency once the change is scanned. On success the response is `201` with `{ name, staged }`, where `staged` says whether the new directory was staged in the repository's index, and the repository is rescanned. On failure the response is `400` (invalid body, invalid name, a `dependsOn` that is not such a list, or an invalid `issue`), `404` (unknown repository) or `409` (repository disabled, last scan failed, no `openspec/` parent, an active or archived change already uses that name, or an `issue` was given for a repository whose `origin` is not on `github.com`) with a JSON message. The endpoint MUST NOT write anything to the repository unless the request succeeds; a failed request MUST leave the repository byte-for-byte unchanged, its index and refs included. A failure to stage a successfully created change MUST NOT fail the request. The endpoint is mutating and MUST pass the same-origin protection.

#### Scenario: Successful create
- **WHEN** `POST /api/repos/<id>/changes` is called with `{ "name": "add-audit-trail" }` for an enabled, successfully scanned repository that has no `add-audit-trail` change
- **THEN** the response is `201` with `{ "name": "add-audit-trail", "staged": true }`, `openspec/changes/add-audit-trail/.openspec.yaml` exists in that repository and is staged in its index, and a following `GET /api/state` reflects the new change

#### Scenario: Staging failed
- **WHEN** the change is created but it could not be staged — the repository is not a git repository, or git failed
- **THEN** the response is still `201`, with `staged` false, and the change directory and its files are left in place

#### Scenario: Invalid name
- **WHEN** the request body is `{ "name": "foo/bar" }`
- **THEN** the response is `400` and nothing is written

#### Scenario: Duplicate name
- **WHEN** an active `add-audit-trail` change already exists
- **THEN** the response is `409` and nothing is written

#### Scenario: Cross-site
- **WHEN** a page on another origin posts to the endpoint
- **THEN** the response is `403` and nothing is written

#### Scenario: Create with dependencies
- **WHEN** `POST /api/repos/<id>/changes` is called with `{ "name": "add-billing-ui", "dependsOn": ["add-billing-api"] }`
- **THEN** the response is `201`, and `openspec/changes/add-billing-ui/` holds `.openspec.yaml` and a `depends-on.yaml` listing `add-billing-api`, both staged

#### Scenario: Invalid dependencies
- **WHEN** the request body's `dependsOn` contains `../etc`, contains a name twice, names the new change itself, or is not a list of strings
- **THEN** the response is `400` and nothing is written

#### Scenario: Create from an issue
- **WHEN** `POST /api/repos/<id>/changes` is called with `{ "name": "retry-webhooks", "prompt": "…", "issue": { "number": 42, "title": "Retry webhook delivery" } }` for a repository whose `origin` is `https://github.com/acme/alpha-infra.git`
- **THEN** the response is `201`, `openspec/changes/retry-webhooks/issue.yaml` records `acme/alpha-infra` and `42`, it is staged with the other files, and no `gh` process was started

#### Scenario: Invalid issue
- **WHEN** the request body's `issue` has a `number` that is not a positive integer, or a `title` longer than 256 characters
- **THEN** the response is `400` and nothing is written

### Requirement: Issue endpoint
`POST /api/repos/<id>/issues` SHALL run the issue query of the `issue-import` capability for the enabled repository `<id>` and return `{ status, github?, reason?, fetchedAt?, truncated?, issues: [...] }`, where `status` is `ok`, `unavailable` or `failed`, `github` is the repository's `owner/name` when its `origin` is on `github.com`, `reason` explains `unavailable` and `failed` with credentials masked, and `issues` holds the open issues as that capability specifies (empty unless `ok`). An unknown or disabled `<id>` SHALL be refused with `404` without starting a process. A repository that is not a git repository or not on GitHub SHALL be answered `unavailable` without starting a `gh` process. Concurrent requests for the same repository SHALL share one running query. The endpoint is a POST because it starts a process that contacts GitHub; it is a mutating request under the same-origin protection, even though it changes nothing. It SHALL NOT trigger a scan and MUST NOT write anything to disk. No GET endpoint SHALL start the issue query.

#### Scenario: Listing issues
- **WHEN** `POST /api/repos/<id of alpha-infra>/issues` is called and `gh` is signed in
- **THEN** one `gh issue list --repo acme/alpha-infra` runs outside every tracked repository and the response is `ok` with the open issues

#### Scenario: Not on GitHub
- **WHEN** the repository's `origin` is on `gitlab.example.test`
- **THEN** the response is `unavailable` with the reason "not on GitHub" and no `gh` process is started

#### Scenario: Unknown repository
- **WHEN** `<id>` matches no enabled repository
- **THEN** the response is `404` and no process is started

#### Scenario: Foreign origin
- **WHEN** a page on another origin posts to `/api/repos/<id>/issues`
- **THEN** the response is `403` and no `gh` process is started

### Requirement: The dashboard never writes to tracked repositories
The dashboard MUST NOT write to a tracked repository except in response to an explicit user action — or, for the automatic fetch of (9), the repository's auto-fetch setting, which is on unless the user switched it off for that one repository — and then only as enumerated here: (1) `openspec/config.yaml`, where only the managed sections of the `context` and `rules` keys are modified (applying shared OpenSpec config profiles); (2) for agent sessions, creating a git worktree and its branch for a session (`git worktree add`, preceded by `git worktree prune`), with the worktree's directory placed under `~/.spec-control/worktrees/` and never inside the repository's working tree, and removing such a worktree with a non-forcing `git worktree remove` (preceded by `git worktree unlock`) after the user confirmed — or, for a session whose agent the dashboard asked to enable auto-merge, after a pull-request query result showed that session's pull request merged while the project has docs auto-merge on, as specified in the `agent-sessions` capability — and read-only checks proved that it holds no uncommitted change and no work that exists nowhere else; (3) the pull action: `git fetch` from the repository's own remote followed by a fast-forward-only `git merge` of the main checkout's upstream, with repository hooks disabled, as specified in the `repository-pull` capability, and — only after the user confirmed Resolve and pull and the re-checks of that capability proved every blocking file to be an unchanged change leftover — removing exactly those leftover files from the main checkout's index (`git rm --cached`) and working tree immediately before the retried fast-forward, having first saved a copy of each leftover that differs under `~/.spec-control/`, and, when that fast-forward is still refused, writing those same files back with their previous content and re-staging the ones that had been staged (`git add -- <those paths>`); (4) creating a new change directory at `openspec/changes/<name>/` with its `.openspec.yaml` marker, an optional `prompt.md`, an optional `depends-on.yaml` and, for a change imported from a GitHub issue, an `issue.yaml`, as specified in the `change-creation` capability — the dashboard writes those files itself and MUST NOT invoke the `openspec` CLI or any other external command for it; (5) staging that new change directory, and only it, with a single `git add -- openspec/changes/<name>/` once those files are written, as specified in the `change-creation` capability — best-effort, never failing the creation, and never run for a refused create; (6) repository cleanup, as specified in the `repository-cleanup` capability, on the user's confirmation of items the user selected: removing any linked worktree of the repository with a non-forcing `git worktree remove` (preceded by `git worktree unlock` only for a worktree the dashboard created) after read-only checks proved that it holds no uncommitted change and no work that exists nowhere else, removing stale worktree records with `git worktree prune`, and deleting a local branch other than the default branch and the main checkout's branch with `git branch -D` after read-only checks proved that its work is in the default branch and that it still points at the commit the user saw — whether the user selected it in repository cleanup or confirmed it as a stale leftover in a stale change's cleanup; and, for each linked worktree the user confirmed either in the deletion dialog of that capability ("One branch and its worktree can be deleted whatever they hold") or in a stale change's cleanup of the `stale-changes` capability ("A stale change's leftovers are cleaned up on one confirmation"), after re-checking that the worktree, its branch, its commit and its uncommitted files are what the dialog showed and that no session runs in it, removing that worktree with `git worktree remove --force` (preceded by `git worktree unlock` only for a worktree the dashboard created, never forcing a lock) even though it has uncommitted changes, having first copied its uncommitted, non-ignored files under `~/.spec-control/`, and deleting its branch with `git branch -D` whatever its merge state, other than the default branch and the main checkout's branch, if it still points at the commit the user saw; (7) dismissing a change, as specified in the `change-dismissal` capability, on the user's confirmation — or, for the main checkout's change directory of a change that is archived on the default branch and that the user confirmed as a stale leftover in a stale change's cleanup of the `stale-changes` capability, with every file that differs from the archive's copy saved under `~/.spec-control/` first: deleting an active change's directory `openspec/changes/<name>/` from the main checkout — never a directory under `openspec/changes/archive/`, never a symbolic link's target, never anything in a linked worktree — after re-checking that its content is what the confirmation showed and that no agent session for the change is running, then staging that removal, and only it, with a single `git add --all -- openspec/changes/<name>/` — best-effort, never failing the dismissal, and never run for a refused dismissal; (8) the home migration, as specified in the requirement on moving the home from its old name: once the user has started a binary that finds only the old home, running `git worktree repair` for the worktrees the dashboard itself created, with their new paths under `~/.spec-control/worktrees/`, which rewrites only the repository's administrative record of where those linked worktrees are (`.git/worktrees/<name>/gitdir`) and those worktrees' own `.git` files — it MUST NOT touch any other worktree, the main checkout's working tree, index, `HEAD` or any ref, and MUST NOT contact a remote; (9) the automatic fetch, as specified in the `repository-pull` capability, for every enabled git repository with a remote whose auto-fetch setting the user has not switched off: exactly the pull action's `git fetch` from the repository's own remote, on that setting's interval, which writes only remote-tracking refs, `FETCH_HEAD` and objects — it MUST NOT fast-forward, merge, prune, or change the main checkout's branch, index or working tree or any linked worktree. Outside tracked repositories, the dashboard writes beyond `~/.spec-control/` in exactly three places. The first is creating a new project, as specified in the `project-creation` capability, on the user's confirmation: creating one new, empty directory directly inside a configured workspace root with an exclusive create — never in or below a tracked repository, an ignore path or the dashboard's home directory, and never reusing anything that exists — and running `git init` in that directory and nowhere else; it MUST NOT write any other file there, stage, commit, add a remote or delete anything it created. The second is cloning a GitHub repository, as specified in the `github-repositories` capability, on the user's confirmation: creating one new directory directly inside a configured workspace root with an exclusive create, under the same placement rules as a new project, and running `git clone` of `https://github.com/<owner>/<name>.git` — a URL the dashboard builds from a validated `owner/name` — into it, with no prompt and no hooks; when the clone fails or the user cancels it it MAY remove that directory only if it is empty, with a non-recursive remove, and it MUST NOT delete anything else, write into the clone, add or change a remote, or delete, move or empty the clone afterwards. The third is creating a workspace folder in the setup wizard, as specified in the `setup-wizard` capability, on the user's confirmation: one new, empty directory with a non-recursive, exclusive create inside an existing directory, never in or below a tracked repository, an ignore path or the dashboard's home directory, with nothing written into it and no command run. Apart from those worktree commands, that branch deletion, the pull action's removal of confirmed change leftovers and that change-directory deletion the dashboard MUST NOT delete or move anything in a tracked repository. Apart from the pull action it MUST NOT change the main checkout's working tree beyond the created and the dismissed change directories above, and MUST NOT change the main checkout's index beyond adding the created directory's files to it and staging the dismissed directory's removal, and MUST NOT contact a remote, and it MUST NOT change the main checkout's branch at all. It MUST NOT commit, push, stash or reset in a tracked repository under any circumstances, and MUST NOT create or delete a ref except the session branch created with a session's worktree and the local branches deleted by repository cleanup (including the branch of a confirmed deletion and the branches of a confirmed stale change's cleanup); it MUST NOT delete a remote-tracking ref or a remote branch. The pull action MUST NOT run except on the user's explicit request for that repository (or for all repositories): never on a timer, during a scan, on page load or as a side effect of another operation. The automatic fetch is not the pull action: it runs the pull action's fetch and nothing more, only for a repository whose auto-fetch setting is not off, only on that setting's interval (every minute when the repository has no saved setting), and never during a scan, on page load, for another repository or in the demo. Apart from the pull action and the automatic fetch, the only network access the dashboard makes is the pull-request query of the `pull-requests` capability, the issue query of the `issue-import` capability, the repository listing and the clone of the `github-repositories` capability and the update check of the `update-notice` capability. The update check is one unauthenticated `HEAD` request to this project's own GitHub releases page, made by the server itself rather than by git or `gh`, never inside or about a tracked repository, carrying nothing about the user, and never made while the user has turned it off or for a `dev` build. The pull-request, issue and repository-list queries run only the GitHub CLI's read-only `gh pr list`, `gh api user`, `gh issue list` and `gh repo list`, never any other `gh` subcommand, with their working directory outside every tracked repository, and only when the user asks for them as specified in those capabilities; they MUST NOT write to a tracked repository, run git, or change anything on GitHub. Scanning, polling, discovery and serving the UI MUST NOT start a `gh` process or a clone; a clone runs only on the user's confirmation of Add from GitHub, a setup wizard Continue or a retry, and is stopped early only on the user's Cancel or its timeout. All other filesystem writes MUST be confined to `~/.spec-control/`, apart from the new project directory and its `git init`, the cloned directory and its `git clone`, and the new workspace folder. Scanning, polling, discovery, previews, reading work statuses and saving any dashboard setting MUST NOT write to a tracked repository. Apart from the worktree commands (including the home migration's `worktree repair`), the pull action's and the automatic fetch's `fetch`, the pull action's `merge --ff-only`, leftover `rm --cached` and restoring `add`, the create-change and dismissal `add`, the cleanup's `branch -D`, the new project's `git init` and the GitHub clone's `git clone` above, git MUST only be invoked with read-only subcommands (`rev-parse`, `log`, `worktree list`, `status`, `show-ref`, `symbolic-ref`, `for-each-ref`, `rev-list`, `diff`, `config --get`, `ls-files`, `ls-tree`, `cat-file`, `merge-tree`, and `hash-object` without `-w`). `merge-tree`, which computes the conflict signal of a work status, writes the merged tree it produces into an object database; it MUST therefore be invoked with its object directory pointed at a scratch store under `~/.spec-control/` and the repository's own object database offered only as an alternate, so that it reads everything it needs and writes nothing into the repository. It MUST NOT be given a working tree, an index or a ref to update. Every git invocation MUST run with optional locks disabled (`GIT_OPTIONAL_LOCKS=0`), so that no invocation rewrites `.git/index` as a side effect — `git status` refreshes the index by default — and only the pull action's `merge --ff-only`, its leftover `rm --cached` and restoring `add`, and the create-change and dismissal `add` may write the index at all, which they do by design. When agent sessions are enabled, the dashboard MAY start the user's configured agent in a session's worktree on the user's explicit request. The same holds, in place in the folder itself, for an integration session in a repository that is not tracked yet (`repo-integration` capability) for a project console in a tracked repository's folder, which for a git repository is its main checkout (`project-console` capability), and for a change session in a git repository with no commit yet, which runs in its main checkout (`agent-sessions` capability). For none of them does the dashboard create a worktree or branch, write a file or run a git command. What that agent changes, commits or pushes is the agent's doing under its own permission prompts and is never done by the dashboard's own code. With agent sessions disabled the dashboard MUST NOT start any process that can modify a repository.

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
- **WHEN** a pull-request refresh shows the archive pull request of a session that was asked to enable auto-merge as merged, and its worktree is clean and pushed
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

### Requirement: Shared config endpoints

`GET /api/shared-config` SHALL return the stored profiles as `{ profiles: [...] }`, with an empty list when none has been saved. `PUT /api/shared-config` SHALL validate and persist them and return what was saved; invalid bodies MUST return `400` with a message and leave the stored profiles unchanged. `POST /api/shared-config/preview` with `{ "assignments": [{ "repoId", "profileIds": [...] }] }` SHALL return, per repository id, the profiles it carries now, the current file text, the text that apply would write, and a refusal reason when apply would refuse it, without writing anything. `POST /api/shared-config/apply` with the same body SHALL apply to each repository independently, where `profileIds` is the complete set of profiles that repository is to carry, return per repository `written`, `unchanged` or `refused` with a reason, and trigger a scan.

#### Scenario: Nothing saved yet
- **WHEN** `GET /api/shared-config` is called on a fresh install
- **THEN** the response is `{ profiles: [] }`

#### Scenario: Malformed assignments
- **WHEN** preview or apply is called without an `assignments` list of `{ repoId, profileIds }`
- **THEN** the response is `400` and nothing is written

#### Scenario: Partial success
- **WHEN** apply is requested for one healthy repository and one whose config is invalid YAML
- **THEN** the response is `200` with `written` for the first and `refused` with a reason for the second

### Requirement: Mutating requests are protected against cross-site requests

Every API request with a method other than `GET` SHALL be rejected with `403` unless its `Content-Type` is `application/json` and, when an `Origin` header is present, the origin is the dashboard's own (`http://127.0.0.1:<port>` or `http://localhost:<port>`). A request whose `Sec-Fetch-Site` header is `cross-site` SHALL be rejected. The server MUST NOT send CORS headers that would approve another origin. Rejected requests MUST have no side effects.

#### Scenario: Request from another web page
- **WHEN** a page on `https://example.com` sends `POST /api/shared-config/apply` to the dashboard
- **THEN** the response is `403` and no file is written

#### Scenario: Form post
- **WHEN** a `POST` arrives with `Content-Type: application/x-www-form-urlencoded`
- **THEN** the response is `403`

#### Scenario: The dashboard's own UI
- **WHEN** the UI served from `http://127.0.0.1:4711` sends `PUT /api/config` with a JSON body
- **THEN** the request is processed as before

#### Scenario: Command-line client
- **WHEN** `curl -X POST -H 'content-type: application/json'` calls `/api/scan` without an `Origin` header
- **THEN** the request is processed

### Requirement: Session endpoints

The API SHALL provide: `POST /api/sessions` with `{ repoId, change, action }` to open a session — with optional `resolveConflicts: true`, which opens it for Resolve conflicts as the `agent-sessions` capability specifies, taking the branch and pull request from the server's own scan and pull-request cache and ignoring any branch or pull-request field in the request — (returning, once the request passed the refusals listed below, the session that is already running for that repository and change if there is one, whatever action was asked for, `archive` included, and starting nothing in that case); `GET /api/sessions` returning the sessions and, for each configured agent, whether its executable was found; `GET /api/sessions/<id>`; `GET /api/sessions/<id>/worktree` reporting whether the worktree could be removed safely; `POST /api/sessions/<id>/resume`; `POST /api/sessions/<id>/close` with optional `{ removeWorktree }`, which ends the agent if it is running; and `DELETE /api/sessions/<id>` for a session that is not running. Opening MUST be refused with `403` when agent sessions are disabled or the repository is excluded from them, with `404` for an unknown repository or change, with `409` when the repository is not tracked or its last scan failed, with `400` for an invalid change name, an unknown action, an action not available in the change's stage or an agent without a prompt for it, with `503` when the agent's executable is not found, and with `500` and git's reason when the worktree cannot be created. With `resolveConflicts: true` the stage check does not apply; instead opening MUST be refused with `409` and the reason when neither conflict signal holds, when the linked pull request comes from a fork or is not known not to, when its head branch is the default branch or is checked out in the main checkout, when the branch is known neither locally nor as `origin/<branch>`, or when a session or session worktree of the change is on another branch; a session already running on the pull request's head branch is returned with the prompt submitted to it, under the rules for text sent on the user's behalf. All session routes other than `GET` are mutating and subject to the same-origin protection that applies to every mutating API request. `GET /api/state` SHALL remain unchanged.

#### Scenario: Duplicate open
- **WHEN** a session for repository `r` and change `c` is running and `POST /api/sessions` is sent again for `r` and `c`
- **THEN** the response contains the existing session and no second process is started

#### Scenario: Another action for a change that has a session
- **WHEN** a session for repository `r` and change `c` is running and `POST /api/sessions` is sent for `r` and `c` with `action: "archive"`
- **THEN** the response contains that running session, no worktree is created, no process is started and nothing is written to its terminal

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

### Requirement: The terminal is served over a same-origin WebSocket

`GET /api/sessions/<id>/terminal` SHALL upgrade to a WebSocket carrying the session's terminal: the server sends terminal output as binary frames — first what the terminal has shown so far, bounded — and one text frame `{"type":"exit"}` when the agent has ended; the client sends text frames `{"type":"input","data":…}` and `{"type":"resize","cols":…,"rows":…}`. Because a WebSocket handshake is a cross-origin-capable `GET` without a preflight, the upgrade MUST be refused with `403` unless the request is addressed to a loopback host name and carries an `Origin` header that is the dashboard's own origin; a missing `Origin` MUST be refused. A request for an unknown session MUST be refused, and a request that is not a WebSocket upgrade MUST NOT open anything. Input for a session that is not running MUST be ignored.

#### Scenario: Another web page tries to attach
- **WHEN** a page from `https://example.com` opens a WebSocket to a session's terminal
- **THEN** the handshake is refused and nothing is delivered to the agent

#### Scenario: No Origin header
- **WHEN** a client without an `Origin` header requests the terminal
- **THEN** the handshake is refused

#### Scenario: DNS rebinding
- **WHEN** the handshake is addressed to a host name other than a loopback name, even with a matching `Origin`
- **THEN** it is refused

#### Scenario: Output, input and resize
- **WHEN** the dashboard's own page attaches, sends a resize to 77 columns and then types a line
- **THEN** the agent sees a 77-column terminal, receives the line, and its output arrives as binary frames

#### Scenario: Second viewer
- **WHEN** a second viewer attaches to a running session
- **THEN** it first receives the earlier output and then the same live output as the first viewer

#### Scenario: Ended session
- **WHEN** a viewer attaches to a session that has ended
- **THEN** it receives the stored output followed by the exit frame

### Requirement: Worktree and ship endpoints

`GET /api/sessions` SHALL additionally return `worktrees`: one entry per session worktree directory of a configured repository with `repoId`, `name`, `path`, the `change` and `action` it belongs to, its `branch`, its work status, the time of its last activity, and the id of its most recent session if a record exists. When agent sessions are disabled the list SHALL be empty and no git command SHALL be run for it. `POST /api/sessions/<id>/ship` SHALL perform the Ship action and return the session; it MUST be refused with `403` when agent sessions are disabled, `409` when there is nothing to ship or another session for the change is running, and `503` when the agent's executable is not found. `POST /api/worktrees/remove` with `{ repoId, name }` SHALL remove that worktree under the clean-up rules and return whether it was removed and, if not, why; `repoId` MUST be a configured repository and `name` MUST be a single path segment of lower-case letters, digits, dots, dashes and underscores, otherwise the response is `404` or `400`; it MUST be refused with `409` while a session is running in the worktree. Both `POST` routes are subject to the same-origin protection.

#### Scenario: Worktrees in the session list
- **WHEN** agent sessions are enabled and one session worktree with an untracked file exists
- **THEN** `GET /api/sessions` returns it in `worktrees` with status `uncommitted`

#### Scenario: Path traversal
- **WHEN** `POST /api/worktrees/remove` is sent with `name` set to `../x`
- **THEN** the response is `400` and no git command is run

#### Scenario: Removing under a running session
- **WHEN** `POST /api/worktrees/remove` names the worktree of a running session
- **THEN** the response is `409` and the worktree is kept

### Requirement: Pull endpoints

`POST /api/repos/<id>/pull` SHALL run the pull action for one repository and return its result, including the blocking files and, when every one is a change leftover, what the user has to confirm to resolve them; `POST /api/pull` SHALL run it for every eligible repository with bounded concurrency and return one result per repository, a failure in one not affecting the others. `POST /api/repos/<id>/pull` with a body `{ "resolve": { "upstream": <commit>, "files": [{ "path", … }] } }` — the incoming commit and the blocking files exactly as a previous result offered them — SHALL run Resolve and pull for that repository as specified in the `repository-pull` capability instead of a fetch; the server MUST re-determine the blocking files itself and MUST NOT treat any path or content in the request as more than the claim it checks. A malformed resolve body SHALL be refused with `400` and nothing touched; a resolve whose claim no longer matches SHALL be answered with a `refused` result and nothing touched. `POST /api/pull` never resolves anything. A repository is eligible only if it is enabled in the config, its last scan succeeded and it is a git repository; the repository's path MUST come from the config and never from the request. An unknown, disabled or non-git repository SHALL be refused without running git. A second request for a repository whose pull or resolve is still running SHALL be refused with `409`. Both endpoints are mutating requests under the same-origin protection. After a pull or resolve the repository SHALL be rescanned.

#### Scenario: One repository
- **WHEN** `POST /api/repos/<id>/pull` is called for an enabled repository that is two commits behind its upstream
- **THEN** the response reports a fast-forward of 2 commits and a following `GET /api/state` reflects the repository's new state

#### Scenario: Not eligible
- **WHEN** the id belongs to a disabled repository, or to none
- **THEN** the response is an error and no git command was run

#### Scenario: Already pulling
- **WHEN** a second pull is requested for a repository while its first is still running
- **THEN** the response is `409` and only one fetch runs

#### Scenario: Pull all with one unreachable remote
- **WHEN** `POST /api/pull` runs over three repositories and one remote cannot be reached
- **THEN** the response has three results, two successful and one `failed` with a reason

#### Scenario: Resolve as offered
- **WHEN** a pull result offered Resolve and pull and the same upstream commit and files are posted back as `resolve`
- **THEN** the response reports the fast-forward and the replaced files with the locations of any copies, and no fetch was run

#### Scenario: Resolve claiming a file that is not a leftover
- **WHEN** a `resolve` body names `src/app.ts`, which has an uncommitted edit that the incoming commits change
- **THEN** the response is a `refused` result and `src/app.ts`, the index and the branch are unchanged

#### Scenario: Malformed resolve
- **WHEN** the `resolve` body has no upstream commit or a path that is absolute or contains `..`
- **THEN** the response is `400` and no git command that writes is run

#### Scenario: Foreign origin
- **WHEN** a page on another origin posts to a pull endpoint, with or without `resolve`
- **THEN** the response is `403` and nothing is fetched or removed

### Requirement: Pull request endpoints
`GET /api/pull-requests` SHALL return the cached pull-request lists without contacting any network host and without starting a process: `{ viewer?, repos: [...] }`, where `viewer` is the signed-in GitHub login when known and `repos` holds one entry per enabled repository with its `repoId`, its GitHub repository (`owner/name`) when it has one, a `status` of `ok`, `unavailable`, `failed` or `never` (not fetched yet), a `reason` for `unavailable` and `failed`, the time of the last successful fetch, and its pull requests as specified in the `pull-requests` capability. `POST /api/pull-requests/refresh` SHALL refresh the lists, with an optional JSON body `{ "repoId"?: string, "force"?: boolean }`: with `repoId` only that repository (and the other enabled repositories sharing its GitHub repository) is refreshed, otherwise every enabled repository; without `force: true` a repository whose last fetch is younger than the freshness window SHALL be left as it is. The response SHALL be the same shape as the `GET` after the refresh. An unknown or disabled `repoId` SHALL be refused with `404` without starting a process. While a refresh is running, a second refresh request SHALL wait for and return the running refresh's result rather than start a second query for the same repositories. The refresh endpoint is a mutating request under the same-origin protection. Neither endpoint SHALL trigger a scan.

#### Scenario: Reading the cache
- **WHEN** `GET /api/pull-requests` is called
- **THEN** the cached lists are returned and no `gh` process is started

#### Scenario: Refresh one repository
- **WHEN** `POST /api/pull-requests/refresh` is called with `{ "repoId": "<id of alpha-infra>", "force": true }`
- **THEN** only `alpha-infra`'s GitHub repository is queried and the response carries its fresh list alongside the other repositories' cached lists

#### Scenario: Fresh enough
- **WHEN** `POST /api/pull-requests/refresh` is called without `force` two minutes after the last successful fetch of every repository
- **THEN** no `gh` process is started and the cached lists are returned

#### Scenario: Concurrent refreshes
- **WHEN** two refresh requests for all repositories arrive while the first is still running
- **THEN** each GitHub repository is queried once and both responses carry the same result

#### Scenario: Foreign origin
- **WHEN** a page on another origin posts to `/api/pull-requests/refresh`
- **THEN** the response is `403` and no `gh` process is started

### Requirement: Prompt endpoint and fresh work status

`POST /api/sessions/<id>/prompt` with `{ action }` SHALL submit that starter's prompt to the running session under the rules for text sent on the user's behalf and return the session together with whether the prompt was submitted. Every action a change's stage allows SHALL be accepted, `archive` included, and the action the session itself was started with SHALL NOT restrict what is accepted. It MUST be refused with `403` when agent sessions are disabled, `404` for an unknown session or a change that is no longer scanned, `409` when the session is not running, and `400` for an unknown action, an action not available in the change's current stage, or an agent without a prompt for it. It is a mutating route under the same-origin protection. `GET /api/sessions/<id>/worktree` SHALL additionally return `work`, the worktree's work status read at the time of the request rather than from a cache.

#### Scenario: Prompt submitted
- **WHEN** `POST /api/sessions/<id>/prompt` targets a running session whose agent shows a text prompt
- **THEN** the response carries the session with `submitted` true and the agent received the prompt

#### Scenario: Archive accepted
- **WHEN** `POST /api/sessions/<id>/prompt` sends `archive` to the running session of a change in `Done` whose agent has an Archive prompt
- **THEN** the response carries that same session with its action `archive`, and no worktree was created and no process started

#### Scenario: Prompt only typed
- **WHEN** the agent does not show the typed prompt within the bounded time
- **THEN** the response carries the session with `submitted` false and no Enter was sent

#### Scenario: Not running
- **WHEN** `POST /api/sessions/<id>/prompt` targets an ended session
- **THEN** the response is `409` and no process is started

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/sessions/<id>/prompt`
- **THEN** the response is `403` and nothing is written to the terminal

#### Scenario: Fresh status for the end dialog
- **WHEN** a file is created in a session's worktree and `GET /api/sessions/<id>/worktree` is requested immediately
- **THEN** `work` is `uncommitted` with a count of 1

### Requirement: Change artifact endpoints
The API SHALL provide two read-only endpoints for the artifacts of one change of one tracked repository:

`GET /api/repos/<repoId>/changes/<changeName>/artifacts` SHALL return `{ change, artifacts }`, where `change` names the repository id, the change name, the schema, the absolute change directory and whether the change is archived, and `artifacts` lists, in the schema's artifact order, `{ id, status, files }` with `files` being the artifact's existing files as paths relative to the change directory, sorted, each with its size in bytes. An artifact with no file SHALL appear with an empty `files` list.

`GET /api/repos/<repoId>/changes/<changeName>/file?path=<relative path>` SHALL return `{ path, bytes, text }` for one file of that change, read as UTF-8.

Both endpoints SHALL resolve `<repoId>` against the repositories that are enabled in the dashboard config, and `<changeName>` against that repository's active and archived change directories; the change directory is always derived on the server and never taken from the request. When the snapshot says the change's data comes from a linked worktree of that repository, the endpoints SHALL read from that worktree — the same checkout the scanner read — and otherwise from the main checkout. Archived changes SHALL be readable through the same endpoints.

The responses MUST be: `400` when the change name does not match the permitted character set, or when `path` is missing, absolute, or escapes the change directory after normalisation; `404` for an unknown or disabled repository, an unknown change, or a `path` that is not an existing regular file inside the change directory; `413` when the file is larger than 1 MiB, without returning its content. A path whose resolved target — following symbolic links — lies outside the change directory MUST be refused as if it did not exist.

Both endpoints are `GET` and MUST NOT create, modify or delete anything in a tracked repository, and MUST NOT send CORS headers that let another origin read their responses.

#### Scenario: Artifact list
- **WHEN** `GET /api/repos/<id>/changes/cloud-deployment/artifacts` is called for a `spec-driven` change with a proposal and two delta specs
- **THEN** the response lists `proposal` with `proposal.md`, `specs` with both `specs/**/spec.md` paths sorted, and `design` and `tasks` with empty `files`

#### Scenario: File content
- **WHEN** `GET /api/repos/<id>/changes/cloud-deployment/file?path=proposal.md` is called
- **THEN** the response contains the file's text and its size in bytes

#### Scenario: Archived change
- **WHEN** either endpoint is called for a change that lives under `openspec/changes/archive/`
- **THEN** it answers from that archived directory

#### Scenario: Change in a linked worktree
- **WHEN** a change exists only in a linked worktree of a tracked repository and the board shows it
- **THEN** both endpoints answer from that worktree's change directory

#### Scenario: Traversal is refused
- **WHEN** `path` is `../../../../etc/passwd`, `/etc/passwd`, or `specs/../../../secrets.md`
- **THEN** the response is `400` or `404` and no file outside the change directory is read

#### Scenario: Symlink out of the change directory
- **WHEN** the change directory contains a symbolic link pointing outside it and that link is requested as `path`
- **THEN** the response is `404` and the link target is not read

#### Scenario: Unknown repository or change
- **WHEN** either endpoint is called with a repository id that is not enabled in the config, or with a change name that repository does not have
- **THEN** the response is `404`

#### Scenario: Invalid change name
- **WHEN** either endpoint is called with a change name containing a path separator or other characters outside the permitted set
- **THEN** the response is `400` and no directory is read

#### Scenario: Oversize file
- **WHEN** the requested file is larger than 1 MiB
- **THEN** the response is `413` with a message and without the file's content

#### Scenario: Reading changes nothing
- **WHEN** both endpoints are called for every change of every tracked repository
- **THEN** no file under any tracked repository is created, modified or deleted

### Requirement: Main console endpoint
`POST /api/console` SHALL open the main console and return its session: the running console session if there is one,
otherwise a newly started one running the console agent (the profile `agentSessions.consoleAgent` names, else the
default agent). It MUST be refused with `403` when agent sessions are disabled, with `503` when the console agent's
executable is not found, and with `409` when the console folder is not usable, each with a reason and without starting a
process. It is a mutating request under the same-origin protection. `GET /api/sessions` SHALL include console sessions,
marked as such and without repository, change, action or branch; resume, close, delete and the terminal WebSocket SHALL
accept a console session's id like any other. `POST /api/sessions/<id>/ship`, `POST /api/sessions/<id>/prompt` and
`GET /api/sessions/<id>/worktree` SHALL be refused with `409` for a console session, and
`POST /api/sessions/<id>/close` SHALL ignore `removeWorktree` for it. `PUT /api/config` SHALL refuse with `400` a
console folder that is not an absolute path to an existing directory outside every tracked repository, and an
`agentSessions.consoleAgent` that is not the id of a configured agent profile.

#### Scenario: Opening twice
- **WHEN** `POST /api/console` is sent while a console session is running
- **THEN** the response contains that session and no second process is started

#### Scenario: Feature disabled
- **WHEN** agent sessions are disabled and `POST /api/console` is called
- **THEN** the response is `403` and no process is started

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/console`
- **THEN** the response is `403` and no process is started

#### Scenario: Change-only routes
- **WHEN** `POST /api/sessions/<id>/ship` names a console session
- **THEN** the response is `409` and nothing is sent to its terminal

#### Scenario: Console folder inside a repository
- **WHEN** `PUT /api/config` sets the console folder to a directory inside a tracked repository
- **THEN** the response is `400` and the saved configuration is unchanged

#### Scenario: Console agent
- **WHEN** two agent profiles `claude` and `my-agent` are configured, `defaultAgent` is `claude`,
  `agentSessions.consoleAgent` is `my-agent`, and `POST /api/console` is sent
- **THEN** the returned session's agent is `my-agent`

#### Scenario: Console agent not installed
- **WHEN** the console agent's executable is not found and `POST /api/console` is sent
- **THEN** the response is `503` with a reason that names that agent, and no process is started

#### Scenario: Unknown console agent
- **WHEN** `PUT /api/config` sets `agentSessions.consoleAgent` to an id that no configured profile has
- **THEN** the response is `400` naming `agentSessions.consoleAgent` and the saved configuration is unchanged

### Requirement: Integration endpoints

`POST /api/integrations` with `{ path }` SHALL open an integration session for that integratable repository and return
it: the running integration session for that folder if there is one, otherwise a newly started one. The path MUST be an
absolute path that discovery currently reports as integratable; anything else MUST be refused with `404`, including a
path that is already a tracked repository, holds `openspec/config.yaml`, is not a git repository, is a linked worktree
or lies outside the configured roots or below an ignore path. The request MUST be refused with `403` when agent
sessions are disabled, and with `503` when no default agent is configured or the default agent's executable is not
found — each with a reason and without starting a process. A default agent without an `integrate` prompt of its own
MUST NOT be refused: the session is started with the agent-neutral default Integrate prompt. It is a mutating request
under the same-origin protection.

`GET /api/sessions` SHALL include integration sessions, marked as such, carrying the folder and no repository id,
change, action or branch; resume, close, delete and the terminal WebSocket SHALL accept an integration session's id
like any other. `POST /api/sessions/<id>/ship`, `POST /api/sessions/<id>/prompt` and
`GET /api/sessions/<id>/worktree` SHALL be refused with `409` for an integration session, and
`POST /api/sessions/<id>/close` SHALL ignore `removeWorktree` for it.

When an integration session ends, the server SHALL re-check its folder for `openspec/config.yaml` and, if it is there,
add the repository to the configuration with `enabled: true` and its default name and start a scan; `GET /api/config`
then returns it and `GET /api/state` shows it once the scan completes. If the marker is absent the configuration MUST
be unchanged.

#### Scenario: Opening an integration
- **WHEN** `POST /api/integrations` is sent with the path of a repository discovery reports as integratable
- **THEN** the response is the integration session, with the folder as its working directory and no branch

#### Scenario: Opening with an agent that has no Integrate prompt
- **WHEN** `POST /api/integrations` is sent for an integratable repository and the default agent's profile carries no `integrate` prompt
- **THEN** the response is the integration session, and the agent was started with the agent-neutral default Integrate prompt

#### Scenario: Opening twice
- **WHEN** `POST /api/integrations` is sent for a folder whose integration session is running
- **THEN** the response contains that session and no second process is started

#### Scenario: A path that is not integratable
- **WHEN** `POST /api/integrations` names a directory that already holds `openspec/config.yaml`
- **THEN** the response is `404` and no process is started

#### Scenario: Feature disabled
- **WHEN** agent sessions are disabled and `POST /api/integrations` is called
- **THEN** the response is `403` and no process is started

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/integrations`
- **THEN** the response is `403` and no process is started

#### Scenario: Change-only routes
- **WHEN** `POST /api/sessions/<id>/ship` names an integration session
- **THEN** the response is `409` and nothing is sent to its terminal

#### Scenario: Marker present when the session ends
- **WHEN** an integration session ends and `openspec/config.yaml` now exists in its folder
- **THEN** `GET /api/config` contains that repository with `enabled: true` and a scan has been started

#### Scenario: Marker absent when the session ends
- **WHEN** an integration session ends and its folder holds no `openspec/config.yaml`
- **THEN** `GET /api/config` is unchanged and the next `POST /api/discover` still lists the folder in `integratable`

### Requirement: Create-project endpoint

`POST /api/projects` with `{ root, name }` SHALL create a new project as specified in the `project-creation` capability
and return `201` with the new folder's canonical `path` and the integration session started in it. It is a mutating
request under the same-origin protection. Before anything is written the request MUST be refused, each with a reason and
without creating a folder, running git or starting a process: with `403` when agent sessions are disabled; with `400`
when `name` is not a valid folder name; with `404` when `root` is not a configured workspace root or is not an existing
directory; with `409` when the target path exists or lies in or below a tracked repository, an ignore path or the
dashboard's home directory; and with `503` when no default agent is configured or the default agent's executable or
`git` is not found. A default agent without an `integrate` prompt of its own MUST NOT be refused. When the folder was
created but `git init` failed, the response SHALL be `500` with git's error and the folder's path, and no process SHALL
have been started.

#### Scenario: Creating a project
- **WHEN** `POST /api/projects` is sent with `{ "root": "/w/acme", "name": "gamma-tools" }`, `/w/acme` is a workspace root and agent sessions are on
- **THEN** the response is `201` with `path` `/w/acme/gamma-tools` and a running integration session whose folder is that path

#### Scenario: Creating a project with an agent that has no Integrate prompt
- **WHEN** `POST /api/projects` is sent with a valid root and name and the default agent's profile carries no `integrate` prompt
- **THEN** the response is `201` and the integration session was started with the agent-neutral default Integrate prompt

#### Scenario: Existing folder
- **WHEN** `POST /api/projects` names a folder that already exists
- **THEN** the response is `409` and the existing folder is unchanged

#### Scenario: Feature disabled
- **WHEN** agent sessions are disabled and `POST /api/projects` is called
- **THEN** the response is `403`, no folder is created and no process is started

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/projects`
- **THEN** the response is `403`, no folder is created and no process is started

### Requirement: Dismiss endpoints
`GET /api/repos/<id>/changes/<name>/dismiss` SHALL return what dismissing the change would delete, as specified in the `change-dismissal` capability: whether the repository is a git repository, every file in the change's directory in the main checkout with its relative path and whether it is restorable from git or lost for good, the linked worktrees holding a copy of the change with path and branch, and a `fingerprint` of that content. It MUST NOT write anything. `POST /api/repos/<id>/changes/<name>/dismiss` with `{ "fingerprint": <string> }` SHALL re-check and delete the change directory, stage its removal, trigger a rescan of the repository and return `{ "name", "staged" }`. Both routes SHALL accept only a repository that is configured, enabled and whose last scan succeeded — otherwise `404` (unknown) or `409` (not eligible) — and a name matching the change-name pattern other than `archive` — otherwise `400`; the repository's path MUST come from the config, never from the request. A change without an active directory in the main checkout SHALL be answered with `404`, with a reason naming the linked worktree when one holds it. A missing or malformed `fingerprint` SHALL be refused with `400`; a fingerprint that no longer matches, a running agent session for the change and a dismissal of the same change already running SHALL be refused with `409`; every refusal deletes nothing and runs no writing git command. The `POST` route is subject to the same-origin protection. Neither route depends on agent sessions being enabled.

#### Scenario: Preview
- **WHEN** `GET /api/repos/demo-ops/changes/lint-rules/dismiss` is called for a change with one committed and one untracked file
- **THEN** the response lists both files, the first as restorable and the second as lost for good, with a fingerprint

#### Scenario: Dismiss
- **WHEN** `POST /api/repos/demo-ops/changes/lint-rules/dismiss` is sent with the fingerprint from the preview
- **THEN** the response is `200` with `{ "name": "lint-rules", "staged": true }`, the directory is gone and a rescan is triggered

#### Scenario: Stale fingerprint
- **WHEN** a file of the change was modified between the preview and the `POST`
- **THEN** the response is `409` and the directory is unchanged

#### Scenario: Traversal in the name
- **WHEN** the name is `..` or `archive`
- **THEN** the response is `400` and nothing is read or deleted

#### Scenario: Worktree-only change
- **WHEN** either route is called for a change that exists only in a linked worktree on `feat/cloud-deployment`
- **THEN** the response is `404` with a reason naming `feat/cloud-deployment`, and nothing is deleted

#### Scenario: Disabled repository
- **WHEN** either route is called for a disabled repository
- **THEN** the response is `409` and nothing is read or deleted

#### Scenario: Foreign origin
- **WHEN** a page on another origin posts to `/api/repos/<id>/changes/<name>/dismiss`
- **THEN** the response is `403` and nothing is deleted

### Requirement: Cleanup endpoints
`GET /api/repos/<id>/cleanup` SHALL return the repository's cleanup preview as specified in the `repository-cleanup`
capability: the base branch, and the lists of worktrees, stale worktree records and branches, each item with whether
it is removable and otherwise the reason it is kept; each branch item SHALL carry the commit it points to and, when it
is checked out in a worktree, that worktree's path. `POST /api/repos/<id>/cleanup` with
`{ "worktrees": [<path>, …], "prune": <boolean>, "branches": [{ "name", "commit" }, …] }` SHALL apply that selection
under the cleanup rules and return one outcome per requested item, then trigger a rescan of the repository. Both
routes SHALL accept only a repository that is configured, enabled, a git repository and whose last scan succeeded;
otherwise the response is `404` (unknown) or `409` (not eligible) and no git command is run. The repository's path
MUST come from the config, never from the request. A worktree path in the request that is not a linked worktree of
that repository, and a branch name that is not a valid local branch name of that repository, SHALL be reported as kept
with a reason and never passed to a removal; a malformed body SHALL be refused with `400` and nothing removed. A second
`POST` for a repository whose cleanup is still running SHALL be refused with `409`. The `POST` route is subject to the
same-origin protection. Neither route depends on agent sessions being enabled.

#### Scenario: Preview
- **WHEN** `GET /api/repos/<id>/cleanup` is called for a repository with one merged worktree
- **THEN** the response lists that worktree as removable and its branch as removable with its commit

#### Scenario: Foreign path
- **WHEN** `POST /api/repos/<id>/cleanup` names the worktree path `/tmp/elsewhere`, which is not a worktree of that
  repository
- **THEN** the response reports it as kept because it is not a worktree of the repository, and no git write command is
  run for it

#### Scenario: Option-like branch name
- **WHEN** the request names the branch `--all`
- **THEN** it is reported as kept as an invalid branch name and no branch is deleted

#### Scenario: Disabled repository
- **WHEN** either route is called for a disabled repository
- **THEN** the response is `409` and no git command is run

#### Scenario: Concurrent cleanup
- **WHEN** a second `POST` arrives while a cleanup of the same repository is running
- **THEN** the response is `409` and the first cleanup's outcome is unaffected

#### Scenario: Foreign origin
- **WHEN** a page on another origin posts to `/api/repos/<id>/cleanup`
- **THEN** the response is `403` and nothing is removed

### Requirement: Environment endpoint
`GET /api/environment` SHALL return the environment report as JSON: the time it was computed, the overall status and the
checks in their stable order, each with its identifier, label, status, what was found and, when the status is not `ok`,
its remedy. It SHALL be computed under the rules of the `environment-check` capability: no network, nothing read from or
written to a tracked repository, no credential value in the response, and `git config --get` as the only process it
starts, run with a working directory outside every tracked repository. With `view=setup` it SHALL return the setup view of the report instead, as the `environment-check` capability specifies, computed the same way; any other `view` value SHALL be refused with `400`. The report MAY be reused for at most 10 seconds, each view on its own.
The endpoint is a `GET` and therefore adds no mutating route; no other route's behaviour changes, and `GET /api/state`
SHALL remain unchanged.

#### Scenario: Report shape
- **WHEN** `GET /api/environment` is requested
- **THEN** the response is JSON with the time it was computed, an overall status and one entry per check, each with an identifier, a label and a status

#### Scenario: No credential in the response
- **WHEN** `GH_TOKEN` is set and `GET /api/environment` is requested
- **THEN** the response body does not contain that token's value

#### Scenario: The request touches no repository
- **WHEN** `GET /api/environment` is requested while repositories are tracked
- **THEN** no file under any tracked repository, including its git config and index, is created, modified or deleted, and no network connection is opened

#### Scenario: Nothing mutates
- **WHEN** `POST /api/environment` is requested
- **THEN** the response is the same as for any unknown route and no report is computed

#### Scenario: The setup view
- **WHEN** `GET /api/environment?view=setup` is requested while two agent profiles are configured and agent sessions are off
- **THEN** the response has no `agent:` check, and the `github-cli` and `git-identity` checks are not `not-needed`

### Requirement: Version endpoint
`GET /api/version` SHALL return `{ "name": "spec-control", "version": <version> }`, where `<version>` is exactly what `--version` prints for the same binary. It SHALL be answered while the server is still starting, SHALL read no configuration, start no process, touch no tracked repository and contact no network, and SHALL carry no credential, path or repository name.

#### Scenario: Release binary
- **WHEN** a binary built as `v0.9.0` is running and `GET /api/version` is requested
- **THEN** the response is `200` with `{ "name": "spec-control", "version": "v0.9.0" }`

#### Scenario: During startup
- **WHEN** `GET /api/version` is requested before the scanner and sessions are ready
- **THEN** it is answered with the same body instead of the "starting" response

#### Scenario: No side effects
- **WHEN** `GET /api/version` is requested
- **THEN** no process is started and no file under a tracked repository or under `~/.spec-control/` is written

### Requirement: Tracking endpoints

Three mutating endpoints SHALL each change one thing in the saved configuration, persist it atomically and return the saved config, under the same validation, canonicalisation and scan rules as `PUT /api/config`:

- `POST /api/repos/track` with `{ path }`: when the canonical path is a repository in the configuration, it SHALL be set `enabled: true`, keeping its name. Otherwise the path MUST be one that discovery over the saved roots and ignore paths currently reports as a candidate, and it SHALL be added with `enabled: true` and its default name, disambiguated against the configured names as for any enabled candidate. Any other path, including an integratable repository, a linked worktree, a path below an ignore path or outside the roots, MUST be refused with `404`.
- `POST /api/repos/<id>/enabled` with `{ enabled }`: SHALL set that configured repository's `enabled`, keeping its name. An unknown id MUST be refused with `404`, and an `enabled` that is not a boolean with `400`.
- `POST /api/ignore-paths` with `{ path }`: SHALL add the canonical path to `ignorePaths` unless it is there already. A path that is not absolute after `~` expansion MUST be refused with `400`. Repositories already in the configuration are not changed.

A scan SHALL be triggered whenever the set of enabled repositories changed. A refused request MUST leave the configuration unchanged. Every write to the configuration — these endpoints, `PUT /api/config` and the configuration change of a confirmed integration — SHALL be applied one at a time against the configuration as the previous write left it, so that concurrent requests cannot undo each other. These endpoints are mutating requests under the same-origin protection, and none of them reads or writes anything inside a repository apart from the read-only discovery walk.

#### Scenario: Tracking a candidate
- **WHEN** discovery reports `/abs/workspace/b` as a candidate and `POST /api/repos/track` is sent with `{ "path": "/abs/workspace/b" }`
- **THEN** the response is the config containing `/abs/workspace/b` with `enabled: true` and its default name, and a scan has been triggered

#### Scenario: Re-enabling a configured repository
- **WHEN** the config contains `/abs/workspace/a` named "Alpha" with `enabled: false` and `POST /api/repos/track` names it
- **THEN** it is `enabled: true` with the name "Alpha"

#### Scenario: Tracking something that is not a candidate
- **WHEN** `POST /api/repos/track` names a git repository without `openspec/config.yaml`
- **THEN** the response is `404` and the config is unchanged

#### Scenario: Disabling
- **WHEN** `POST /api/repos/<id>/enabled` is sent with `{ "enabled": false }` for an enabled repository
- **THEN** the repository stays in the config with `enabled: false` and its name, and a scan has been triggered

#### Scenario: Unknown repository
- **WHEN** `POST /api/repos/<id>/enabled` names an id that is not in the config
- **THEN** the response is `404` and the config is unchanged

#### Scenario: Ignoring a path
- **WHEN** `POST /api/ignore-paths` is sent with `{ "path": "~/Workspace/mirror/" }`
- **THEN** the saved `ignorePaths` contains the canonical path once, and sending it again leaves `ignorePaths` unchanged

#### Scenario: Relative ignore path
- **WHEN** `POST /api/ignore-paths` is sent with `{ "path": "mirror" }`
- **THEN** the response is `400` and the config is unchanged

#### Scenario: Two clicks at once
- **WHEN** `POST /api/repos/track` for `/abs/workspace/b` and `POST /api/repos/<id>/enabled` disabling `/abs/workspace/a` arrive concurrently
- **THEN** the saved config has `/abs/workspace/b` enabled and `/abs/workspace/a` disabled

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/repos/track`
- **THEN** the response is `403` and the config is unchanged

### Requirement: Per-repository settings endpoints
Six mutating endpoints SHALL each change one configured repository in the saved configuration, persist it atomically and return the saved config, under the same validation and canonicalisation as `PUT /api/config`, and applied one at a time with every other configuration write against the configuration as the previous write left it:

- `POST /api/repos/<id>/name` with `{ name }`: SHALL set that repository's name to the trimmed `name`, keeping everything else. A `name` that is not a string, or is empty after trimming, MUST be refused with `400`.
- `POST /api/repos/<id>/agent` with `{ enabled?, agentId?, autoMergeDocs? }`: SHALL set that repository's agent-session settings. A boolean `enabled` SHALL switch the repository's agent sessions on or off. A string `agentId` SHALL select that agent profile for the repository, and `agentId: null` SHALL clear the selection so that the default agent is used. A boolean `autoMergeDocs` SHALL switch the repository's auto-merge of docs-only pull requests on or off; `false` SHALL remove the key, so a configuration never carries `autoMergeDocs: false`. A field that is absent SHALL leave that part of the setting unchanged. An `enabled` that is neither absent nor boolean, an `agentId` that is neither absent, `null` nor a string, an `agentId` that names no configured profile, an `autoMergeDocs` that is neither absent nor boolean, and a body with none of the three fields MUST be refused with `400`.
- `POST /api/repos/<id>/labels` with `{ labels?, hiddenLabels? }`: SHALL replace that repository's custom labels and/or hidden detected labels with the given lists, under the label rules of the `project-labels` capability. An empty list SHALL remove the key, so a configuration never gains an empty list. A field that is absent SHALL leave that list unchanged. A field that is not a list of strings, a list that breaks the label rules, and a body with neither field MUST be refused with `400`.
- `POST /api/repos/<id>/forget` with an empty JSON body: SHALL remove that repository from the configuration. A repository that is enabled MUST be refused with `409`, so that only a repository the user has disabled can be forgotten.
- `POST /api/repos/<id>/pr-title-convention` with `{ convention }`: SHALL set that repository's pull request title convention. `convention: "conventional-commits"` SHALL set it, and `convention: null` SHALL remove the key so that the repository has no convention. Any other value, and a body without `convention`, MUST be refused with `400`.
- `POST /api/repos/<id>/auto-fetch` with `{ seconds }`: SHALL set that repository's auto-fetch interval. `seconds` of `15`, `30`, `300`, `600`, `900`, `1800` or `3600` SHALL set `autoFetchSeconds` to it; `seconds: 0` SHALL set `autoFetchSeconds: 0`, so that the repository is not fetched automatically; and `seconds: 60`, the default, SHALL remove the key, so that a configuration never carries `autoFetchSeconds: 60` and a repository without the key is fetched every minute. A configuration never carries another value, and never `autoFetchMinutes`. Any other value, including `null`, a string and a body without `seconds`, MUST be refused with `400`. A saved change SHALL take effect on the automatic-fetch schedule at once, as specified in the `repository-pull` capability, without itself fetching or scanning.

An unknown id MUST be refused with `404` by all six. A refused request MUST leave the configuration unchanged. None of these endpoints changes the set of enabled repositories, so none of them triggers a scan. These endpoints are mutating requests under the same-origin protection, and none of them reads or writes anything inside a repository.

#### Scenario: Renaming
- **WHEN** `POST /api/repos/<id>/name` is sent with `{ "name": "  Beta SOC " }` for a configured repository
- **THEN** the saved config has that repository named `Beta SOC` with its `enabled` and agent settings unchanged

#### Scenario: Empty name
- **WHEN** `POST /api/repos/<id>/name` is sent with `{ "name": "   " }`
- **THEN** the response is `400` and the config is unchanged

#### Scenario: Switching agent sessions off for one repository
- **WHEN** `POST /api/repos/<id>/agent` is sent with `{ "enabled": false }` for a repository with no agent settings
- **THEN** the saved config has agent sessions switched off for that repository, and opening a session for one of its changes is refused

#### Scenario: Selecting and clearing an agent
- **WHEN** `POST /api/repos/<id>/agent` is sent with `{ "agentId": "my-agent" }` and later with `{ "agentId": null }`
- **THEN** after the first the repository uses `my-agent`, and after the second it uses the default agent, with its on/off setting unchanged both times

#### Scenario: Switching auto-merge of docs-only pull requests
- **WHEN** `POST /api/repos/<id>/agent` is sent with `{ "autoMergeDocs": true }` for a repository with no agent settings, and later with `{ "autoMergeDocs": false }`
- **THEN** after the first the saved config has `agent: { enabled: true, autoMergeDocs: true }` for it, and after the second `agent: { enabled: true }`; no scan was triggered either time

#### Scenario: Auto-merge setting that is not a boolean
- **WHEN** `POST /api/repos/<id>/agent` is sent with `{ "autoMergeDocs": "yes" }`
- **THEN** the response is `400` and the config is unchanged

#### Scenario: Unknown agent
- **WHEN** `POST /api/repos/<id>/agent` is sent with `{ "agentId": "nope" }` and no profile has that id
- **THEN** the response is `400` and the config is unchanged

#### Scenario: Setting labels
- **WHEN** `POST /api/repos/<id>/labels` is sent with `{ "labels": ["client"] }` and later with `{ "labels": [] }`
- **THEN** after the first the repository carries `["client"]` with its hidden labels unchanged, and after the second it has no `labels` key; no scan was triggered

#### Scenario: Invalid labels
- **WHEN** `POST /api/repos/<id>/labels` is sent with `{ "labels": ["Infra", "infra"] }`
- **THEN** the response is `400` naming the label and the config is unchanged

#### Scenario: Setting and clearing the pull request title convention
- **WHEN** `POST /api/repos/<id>/pr-title-convention` is sent with `{ "convention": "conventional-commits" }` and later with `{ "convention": null }`
- **THEN** after the first the repository carries `prTitleConvention: conventional-commits` with its name, `enabled` state, agent settings and labels unchanged, after the second it has no `prTitleConvention` key, and no scan was triggered

#### Scenario: Unknown convention
- **WHEN** `POST /api/repos/<id>/pr-title-convention` is sent with `{ "convention": "angular" }` or with `{}`
- **THEN** the response is `400` and the config is unchanged

#### Scenario: Forgetting a disabled repository
- **WHEN** `POST /api/repos/<id>/forget` is sent for a repository with `enabled: false`
- **THEN** the saved config no longer contains it and no scan was triggered

#### Scenario: Forgetting an enabled repository
- **WHEN** `POST /api/repos/<id>/forget` is sent for a repository with `enabled: true`
- **THEN** the response is `409` and the config is unchanged

#### Scenario: Unknown repository
- **WHEN** any of the six endpoints names an id that is not in the config
- **THEN** the response is `404` and the config is unchanged

#### Scenario: Concurrent settings
- **WHEN** `POST /api/repos/<a>/name` and `POST /api/repos/<b>/agent` with `{ "enabled": false }` arrive concurrently
- **THEN** the saved config has both changes

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/repos/<id>/forget`
- **THEN** the response is `403` and the config is unchanged

#### Scenario: Setting and clearing auto fetch
- **WHEN** `POST /api/repos/<id>/auto-fetch` is sent with `{ "seconds": 15 }`, then `{ "seconds": 0 }`, then `{ "seconds": 60 }`
- **THEN** after the first the repository carries `autoFetchSeconds: 15` with its name, `enabled` state, agent settings, labels and convention unchanged, after the second `autoFetchSeconds: 0`, after the third it has no `autoFetchSeconds` key, and no request fetched or triggered a scan

#### Scenario: Unsupported interval
- **WHEN** `POST /api/repos/<id>/auto-fetch` is sent with `{ "seconds": 1 }`, `{ "seconds": "15" }`, `{ "seconds": null }`, `{ "minutes": 15 }` or `{}`
- **THEN** the response is `400` and the config is unchanged

### Requirement: Label colour endpoint

`POST /api/labels/color` with `{ label, hue }` SHALL set the colour the dashboard shows for that label on every
repository, persist the configuration atomically and return the saved config, under the same validation as
`PUT /api/config` and applied one at a time with every other configuration write against the configuration as the
previous write left it. `label` SHALL be trimmed and SHALL follow the label rules of the `project-labels` capability; it
SHALL be stored in lower case, so labels that differ only in case share one colour. A whole-number `hue` from 0 to 359
SHALL set the label's entry in `labelColors`; `hue: null` SHALL remove the entry, and removing the last entry SHALL
remove the `labelColors` key, so a configuration never gains an empty map. A `label` that is not a string or breaks the
label rules, a `hue` that is neither `null` nor a whole number from 0 to 359, a body missing either field, and a request
that would give `labelColors` more than 200 entries MUST be refused with `400` and leave the configuration unchanged.
The label need not be displayed on any repository. The endpoint does not change the set of enabled repositories, so it
SHALL NOT trigger a scan. It is a mutating request under the same-origin protection, and it reads or writes nothing
inside a repository.

#### Scenario: Setting a colour
- **WHEN** `POST /api/labels/color` is sent with `{ "label": " Client ", "hue": 290 }`
- **THEN** the saved config's `labelColors` maps `client` to `290`, every repository's labels are unchanged and no scan
  was triggered

#### Scenario: Clearing the last colour
- **WHEN** `labelColors` holds only `client` and `POST /api/labels/color` is sent with `{ "label": "client", "hue": null }`
- **THEN** the saved config has no `labelColors` key

#### Scenario: Invalid hue
- **WHEN** `POST /api/labels/color` is sent with `{ "label": "client", "hue": 12.5 }` or `{ "label": "client", "hue": 360 }`
- **THEN** the response is `400` and the config is unchanged

#### Scenario: Invalid label
- **WHEN** `POST /api/labels/color` is sent with `{ "label": "a,b", "hue": 290 }`
- **THEN** the response is `400` and the config is unchanged

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/labels/color`
- **THEN** the response is `403` and the config is unchanged

### Requirement: Project console endpoint
`POST /api/repos/<id>/console` SHALL open the project console of the tracked repository `<id>` and return its session.
If a project console of that repository is running, it SHALL return that session. Otherwise, if an integration session
for the repository's folder is running, it SHALL return that one. Otherwise it SHALL return a newly started project
console. The request MUST be refused with a reason and without starting a process in each of these cases: `403` when
agent sessions are disabled or the repository is excluded from them; `404` for an unknown repository; `409` when the
repository's folder does not exist or is not a directory, or when another in-place session runs in that folder; `503`
when the repository's agent executable is not found. It MUST NOT be refused because the repository's last scan failed.
It is a mutating request under the same-origin protection. `GET /api/sessions` SHALL include project console sessions,
marked as such, carrying the repository id and folder and no change, action or branch. Resume, close, delete and the
terminal WebSocket SHALL accept a project console session's id like any other. `POST /api/sessions/<id>/ship`,
`POST /api/sessions/<id>/resolve-conflicts`, `POST /api/sessions/<id>/prompt` and `GET /api/sessions/<id>/worktree`
SHALL be refused with `409` for a project console session, and `POST /api/sessions/<id>/close` SHALL ignore
`removeWorktree` for it. `POST /api/sessions` for a change of a tracked folder without git SHALL be refused with `409`
while that repository's project console runs.

#### Scenario: Opening a project console
- **WHEN** `POST /api/repos/<id>/console` is sent for a tracked repository with agent sessions enabled
- **THEN** the response is a project console session for that repository whose working directory is the repository's
  folder, marked as in place, with no branch

#### Scenario: Opening twice
- **WHEN** `POST /api/repos/<id>/console` is sent while that repository's project console is running
- **THEN** the response contains that session and no second process is started

#### Scenario: Setup session still running
- **WHEN** `POST /api/repos/<id>/console` is sent while an integration session for that repository's folder is running
- **THEN** the response contains that integration session and no process is started

#### Scenario: Repository excluded
- **WHEN** the repository's own agent sessions setting is disabled and `POST /api/repos/<id>/console` is called
- **THEN** the response is `403` and no process is started

#### Scenario: Unknown repository
- **WHEN** `POST /api/repos/<id>/console` names a repository id that is not configured
- **THEN** the response is `404` and no process is started

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/repos/<id>/console`
- **THEN** the response is `403` and no process is started

#### Scenario: Change-only routes
- **WHEN** `POST /api/sessions/<id>/ship` names a project console session
- **THEN** the response is `409` and nothing is sent to its terminal

### Requirement: The dashboard keeps its state in one home directory
The dashboard's home directory SHALL be `~/.spec-control/`. When the environment variable `SPEC_CONTROL_HOME` is set and not empty, its value SHALL be the home instead. When `SPEC_CONTROL_HOME` is unset or empty and the former variable `OPENSPEC_DASHBOARD_HOME` is set and not empty, its value SHALL be the home, and the dashboard SHALL print on start that `OPENSPEC_DASHBOARD_HOME` is deprecated and will stop working in a later release, naming `SPEC_CONTROL_HOME`; `OPENSPEC_DASHBOARD_HOME` SHALL be honoured at least until the release after the one that introduces `SPEC_CONTROL_HOME`. Every path this specification and the other capabilities place under `~/.spec-control/` SHALL be under the home in use. User-visible text that names the home (Settings, Help, the pull dialog, the environment check) SHALL name `~/.spec-control/` or the configured home, never `~/.openspec-dashboard/`.

#### Scenario: Default home
- **WHEN** neither variable is set and `~/.spec-control/` does not exist and neither does `~/.openspec-dashboard/`
- **THEN** the dashboard creates `~/.spec-control/` with a default `config.json` and creates nothing named `.openspec-dashboard`

#### Scenario: New variable wins
- **WHEN** `SPEC_CONTROL_HOME=/w/state/a` and `OPENSPEC_DASHBOARD_HOME=/w/state/b` are both set
- **THEN** the dashboard reads and writes only under `/w/state/a`, and prints no deprecation notice

#### Scenario: Former variable still works
- **WHEN** only `OPENSPEC_DASHBOARD_HOME=/w/state/b` is set
- **THEN** the dashboard uses `/w/state/b` as its home and prints that `OPENSPEC_DASHBOARD_HOME` is deprecated in favour of `SPEC_CONTROL_HOME`

### Requirement: The home moves once from its old name
When neither `SPEC_CONTROL_HOME` nor `OPENSPEC_DASHBOARD_HOME` is set, `~/.spec-control/` does not exist and `~/.openspec-dashboard/` exists and is not a symbolic link to `~/.spec-control/`, starting the server SHALL migrate the old home before it scans, discovers, starts any session or serves the UI. `--help` and `--version` MUST NOT migrate. The migration SHALL only start after the server has bound its port, read from the old home's `config.json`, so that it never runs while another instance of the dashboard is serving from the old home. It SHALL:

1. move the old home to `~/.spec-control/` with a single rename, so that its whole content — configuration, shared config profiles, activity log, session records, cached snapshot and pull-request lists, pull backups, scratch object store, console folder and session worktrees — moves at once and no file is copied;
2. leave a symbolic link at `~/.openspec-dashboard` pointing at `~/.spec-control`, so that paths held by anything outside the dashboard — open shells and editors, scripts, git records not yet repaired — keep resolving;
3. rewrite every absolute path the dashboard itself stored that lies under the old home — session records' worktree paths and paths in `config.json` such as a configured console folder — to the same path under the new home, writing each file atomically; and
4. for every directory under `~/.spec-control/worktrees/<repository id>/` that is a linked worktree, run `git worktree repair` with its new path in the repository its `.git` file names, so that the repository's worktree record points at the new path.

When the rename cannot be made, the dashboard SHALL leave the old home where it is, use it as its home for this run exactly as before, and print and show in the environment check why the migration did not happen; it SHALL try again on the next start. When the rename succeeded but a later step failed for some file or worktree, the dashboard SHALL go on starting, report each failure with its reason in the same places, and retry the failed steps on the next start until they succeed or the worktree directory is gone; it MUST NOT delete, recreate or force anything to recover. The migration MUST NOT touch any worktree outside the home, change any repository's main checkout, or move any file the old home did not hold. Once both homes exist as real directories, the dashboard SHALL use `~/.spec-control/` and SHALL NOT move or merge anything, and the environment check's `dashboard-home` check SHALL name the leftover old home. The migration's outcome SHALL be printed on start and recorded in the home, but MUST NOT be written to the activity log.

#### Scenario: Upgrade from an earlier binary
- **WHEN** `~/.openspec-dashboard/` holds `config.json`, 12 session records and two session worktrees of `demo-ops`, and the user starts `spec-control` for the first time
- **THEN** `~/.spec-control/` holds the same files, `~/.openspec-dashboard` is a symbolic link to it, the session records name worktree paths under `~/.spec-control/worktrees/`, `git worktree list` in `demo-ops` shows both worktrees at their new paths, and the board shows the same projects, sessions and work statuses as before

#### Scenario: Nothing to migrate
- **WHEN** `~/.spec-control/` already exists
- **THEN** starting the dashboard moves nothing and runs no `git worktree repair` beyond retrying steps a previous migration recorded as failed

#### Scenario: Another instance still running
- **WHEN** an earlier binary is still serving on port 4711 from `~/.openspec-dashboard/` and the user starts `spec-control`
- **THEN** `spec-control` fails to bind the port and exits without moving or writing anything

#### Scenario: Rename refused
- **WHEN** `~/.openspec-dashboard/` cannot be renamed, for example because it is a mount point
- **THEN** the dashboard runs from `~/.openspec-dashboard/` as before, prints why it was not moved, and the environment check says the same

#### Scenario: A repository has moved away
- **WHEN** the repository of one moved session worktree no longer exists at the path its `.git` file names
- **THEN** the other worktrees are repaired, the failure is reported naming that worktree, nothing is deleted, and the next start tries that worktree again

#### Scenario: Version check does not migrate
- **WHEN** the user runs `spec-control --version` with only `~/.openspec-dashboard/` present
- **THEN** the version is printed and `~/.openspec-dashboard/` is unchanged and `~/.spec-control/` does not exist

#### Scenario: Explicit home is never migrated
- **WHEN** `SPEC_CONTROL_HOME` or `OPENSPEC_DASHBOARD_HOME` is set
- **THEN** no migration runs and nothing under `~/.openspec-dashboard/` or `~/.spec-control/` is read or written

### Requirement: Fast-forward warning endpoint
`POST /api/agent-sessions/fast-forward-warning` with `{ show }` SHALL set `agentSessions.confirmFastForward` to the
boolean `show`, persist the configuration atomically and return the saved config, under the same validation as
`PUT /api/config` and applied one at a time with every other configuration write against the configuration as the
previous write left it. A body whose `show` is missing or not a boolean MUST be refused with `400` and leave the
configuration unchanged. The endpoint does not change the set of enabled repositories, so it SHALL NOT trigger a scan.
It is a mutating request under the same-origin protection, and it reads or writes nothing inside a repository.
`POST /api/sessions` and the prompt endpoint SHALL accept the action `fastForward` under the availability rules of the
agent-sessions capability; the confirmation is the UI's and the API SHALL NOT require it.

#### Scenario: Switching the warning off
- **WHEN** `POST /api/agent-sessions/fast-forward-warning` is sent with `{ "show": false }`
- **THEN** the saved config's `agentSessions.confirmFastForward` is `false`, every other setting is unchanged and no scan was triggered

#### Scenario: Invalid body
- **WHEN** `POST /api/agent-sessions/fast-forward-warning` is sent with `{ "show": "no" }`
- **THEN** the response is `400` and the config is unchanged

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/agent-sessions/fast-forward-warning`
- **THEN** the response is `403` and the config is unchanged

### Requirement: Setup endpoints
`GET /api/setup` SHALL return `{ pending, home, suggestedRoots, platform, folderPicker }`: whether the configuration has
`setup: "pending"`, the user's home directory, the platform the server runs on (`darwin`, `linux` or `win32`, any other
reading as `linux`), which decides the install instructions the wizard shows, whether `POST /api/setup/folder` can open
a folder dialog on this machine, and the canonical paths of the folders from a fixed list of common workspace folder names —
`Workspace`, `workspace`, `Projects`, `projects`, `Developer`, `Code`, `code`, `src`, `dev`, `repos`, `git` and `GitHub`
— that exist as directories directly in the home directory, are not a configured scan root and lie neither at nor below
an ignore path, each at most once, in the list's order. It SHALL establish this with one status lookup per name, and
`folderPicker` by looking the picker's program up on the `PATH` (and, on Linux, whether a graphical session is
announced in the environment), and MUST NOT list the home directory, descend into any folder, read a file or start a
process. `POST /api/setup/done` SHALL remove `setup` from the configuration, persist it atomically under the same
one-write-at-a-time rule as the other configuration writes, and return the saved configuration; when setup is not
pending it SHALL succeed without writing. It is a mutating request under the same-origin protection and changes nothing
else in the configuration.

#### Scenario: Suggestions
- **WHEN** the home directory holds the folders `Workspace` and `Developer` and a file named `code`, and `~/Workspace` is a configured root
- **THEN** `suggestedRoots` is `[<home>/Developer]`

#### Scenario: Case-insensitive file system
- **WHEN** the file system is case-insensitive and the home directory holds `Projects`
- **THEN** `suggestedRoots` lists it once, with its on-disk spelling

#### Scenario: Folder picker available
- **WHEN** the server runs on macOS
- **THEN** `folderPicker` is `true`

#### Scenario: No graphical session
- **WHEN** the server runs on Linux with neither `DISPLAY` nor `WAYLAND_DISPLAY` set, or with neither `zenity` nor `kdialog` on the `PATH`
- **THEN** `folderPicker` is `false`

#### Scenario: Done
- **WHEN** the config has `setup: "pending"` and `POST /api/setup/done` is sent
- **THEN** the response is the config without `setup`, `GET /api/setup` returns `pending: false`, and scan roots, repositories and agent settings are unchanged

#### Scenario: Done twice
- **WHEN** `POST /api/setup/done` is sent while setup is not pending
- **THEN** the response is `200` and `config.json` is not rewritten

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/setup/done`
- **THEN** the response is `403` and the config is unchanged

### Requirement: Setup folder picker endpoint
`POST /api/setup/folder` SHALL open the operating system's own folder dialog on the machine the server runs on and wait
for the user's choice, then answer `{ status: "chosen", path }` with the canonical absolute path of the chosen
directory, `{ status: "cancelled" }` when the user dismissed the dialog, or `{ status: "failed", reason }` when the
dialog could not be shown or answered something that is not an existing directory. The dialog SHALL be opened with one
fixed program per platform — `osascript` on macOS, `zenity` or else `kdialog` on Linux, PowerShell on Windows — started
without a shell, with an argument list that is a constant of the server: nothing from the request SHALL reach the
command line, the environment or the standard input, and the request body SHALL be ignored apart from the same-origin
checks. The dialog SHALL start in the user's home directory. Its program SHALL run with its working directory in the
dashboard home, never inside a tracked repository. While one dialog is open, another request SHALL be answered `409`
without starting a process. A dialog left open for ten minutes SHALL be closed by ending its process and answered
`cancelled`. When no folder picker is available, as `GET /api/setup` reports it, the request SHALL be answered
`{ status: "failed", reason }` without starting a process. The endpoint SHALL write nothing — no file, no configuration —
and contact no network; the chosen path SHALL be saved only when the client later saves it through
`PUT /api/config`. It is a mutating request under the same-origin protection, because it starts a process.

#### Scenario: A folder is chosen
- **WHEN** `POST /api/setup/folder` is sent and the user picks `/w/acme` in the dialog
- **THEN** the response is `{ "status": "chosen", "path": "/w/acme" }` and the configuration is unchanged

#### Scenario: The dialog is cancelled
- **WHEN** the user dismisses the dialog
- **THEN** the response is `{ "status": "cancelled" }`

#### Scenario: One dialog at a time
- **WHEN** a dialog is open and a second `POST /api/setup/folder` is sent
- **THEN** the second response is `409` and no second process is started

#### Scenario: Nothing from the request on the command line
- **WHEN** `POST /api/setup/folder` is sent with a body naming a path and a script
- **THEN** the picker is started with exactly the server's constant arguments, and the body's content appears nowhere in its arguments, environment or input

#### Scenario: No picker available
- **WHEN** the server runs on Linux without a graphical session and `POST /api/setup/folder` is sent
- **THEN** the response is `{ "status": "failed", "reason": … }` and no process is started

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/setup/folder`
- **THEN** the response is `403` and no process is started

### Requirement: GitHub repository endpoints
`POST /api/github/repos` with `{ owner? }` SHALL run the repository listing of the `github-repositories` capability for
`owner`, or for the account `gh` is signed in as when `owner` is absent, and return
`{ status, owner?, reason?, truncated?, repos: [...] }`, where `status` is `ok`, `unavailable` or `failed`, `reason`
explains `unavailable` and `failed` with credentials masked, and each of `repos` has `repo` (`owner/name`),
`description`, `private`, `archived`, `pushedAt` and `added` (whether a tracked repository has it as its `origin`). An
`owner` that is not a valid GitHub owner SHALL be refused with `400` without starting a process. It is a POST because it
starts a process that contacts GitHub, and it is a mutating request under the same-origin protection, even though it
changes nothing; it SHALL NOT trigger a scan and MUST NOT write anything to disk. No GET endpoint SHALL start the
listing.

`POST /api/github/clone` with `{ repo, root, name }` SHALL start a clone of `repo` into `<root>/<name>` as the
`github-repositories` capability specifies and respond `202` with the clone's entry once the folder is created and git
has started, without waiting for git to finish. Before anything is written the request MUST be refused, each with a
reason and without creating a folder or starting a process: with `400` when `repo` is not a valid `owner/name` or a URL
the capability accepts, or `name` is not a valid folder name; with `404` when `root` is not a configured workspace root
or is not an existing directory; with `409` when the target path exists in any form or lies in or below a tracked
repository, an ignore path or the dashboard's home directory; and with `503` when `git` is not found. A retry is a new
request for the same `repo`, `root` and `name`, and replaces the failed entry.

`GET /api/github/clones` SHALL return the clones started since the dashboard started and not dismissed, each
`{ id, repo, root, name, path, state, progress?, reason?, startedAt, finishedAt? }`, where `state` is `queued` (waiting
for one of the two clone slots; git has not started), `cloning`, `tracked` (the clone holds `openspec/config.yaml`, was
added to the configuration and a scan was triggered), `integratable` (cloned without the marker), `failed` (git refused
or the clone timed out, `reason` masked) or `cancelled`, and `progress`, present while `cloning`, is
`{ phase, percent?, receivedBytes?, updatedAt }` with `phase` one of `connecting`, `receiving`, `resolving` and
`checkout`. `POST /api/github/clones/cancel` with `{ id }` SHALL cancel a queued or running clone as the
`github-repositories` capability specifies and answer its entry once it is `cancelled`; it SHALL be refused with `409`
for a finished one and `404` for an unknown one. `POST /api/github/clones/dismiss` with `{ id }` SHALL drop a finished
entry — tracked, integratable, failed or cancelled — from that list and SHALL be refused with `409` for a queued or
running one. The list is
kept in memory only, is never an input to scanning, columns or actions, and reading it starts no process. The clone, cancel and
dismiss endpoints are mutating requests under the same-origin protection, and every configuration write a clone causes
follows the one-write-at-a-time rule.

#### Scenario: Listing the signed-in user's repositories
- **WHEN** `gh` is signed in as `jdoe` and `POST /api/github/repos` is sent with `{}`
- **THEN** the response is `ok` with `owner` `jdoe` and `jdoe`'s repositories, newest push first, and one `gh repo list` runs outside every tracked repository

#### Scenario: gh missing
- **WHEN** `gh` is not on the PATH and `POST /api/github/repos` is sent
- **THEN** the response is `unavailable` with a reason saying to install the GitHub CLI, and no process was started

#### Scenario: Cloning an OpenSpec repository
- **WHEN** `POST /api/github/clone` is sent with `{ "repo": "acme/beta-soc", "root": "/w/acme", "name": "beta-soc" }`, `/w/acme` is a workspace root and the repository holds `openspec/config.yaml`
- **THEN** the response is `202` with `state` `cloning`, and once `GET /api/github/clones` lists it as `tracked`, the config contains `/w/acme/beta-soc` with `enabled: true`

#### Scenario: A failed clone
- **WHEN** `POST /api/github/clone` names `acme/missing-repo` and git cannot clone it
- **THEN** the response is `202`, `GET /api/github/clones` then lists it as `failed` with a masked reason, and `/w/acme/missing-repo` does not exist

#### Scenario: Invalid repository
- **WHEN** `POST /api/github/clone` is sent with `{ "repo": "https://example.test/acme/beta-soc", "root": "/w/acme", "name": "beta-soc" }`
- **THEN** the response is `400`, no process is started and nothing is created

#### Scenario: Folder exists
- **WHEN** `/w/acme/beta-soc` exists and `POST /api/github/clone` targets it
- **THEN** the response is `409` and the folder is unchanged

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/github/clone` or `POST /api/github/repos`
- **THEN** the response is `403` and no process is started

#### Scenario: Progress in the list
- **WHEN** a clone is receiving objects and git last reported 45%
- **THEN** `GET /api/github/clones` lists it as `cloning` with `progress.phase` `receiving` and `progress.percent` 45

#### Scenario: Cancelling
- **WHEN** `POST /api/github/clones/cancel` is sent for a running clone into `/w/acme/beta-soc`
- **THEN** the response is its entry with `state` `cancelled`, no git process for it is left running and `/w/acme/beta-soc` does not exist

#### Scenario: Cancelling a finished clone
- **WHEN** `POST /api/github/clones/cancel` is sent for a `tracked` clone
- **THEN** the response is `409` and nothing changes on disk

#### Scenario: Cancel cross-site
- **WHEN** a page from another origin sends `POST /api/github/clones/cancel`
- **THEN** the response is `403` and the clone goes on

### Requirement: Workspace folder endpoint
`POST /api/setup/workspace-folder` with `{ path }` SHALL create the workspace folder of the `setup-wizard` capability and
respond `201` with its canonical `path`; it SHALL NOT change the configuration, which the wizard saves afterwards. It
SHALL be refused, each with a reason and without creating anything: with `400` when `path` is not absolute after `~`
expansion; with `404` when its parent does not exist or is not a directory; and with `409` when the path exists in any
form or lies in or below a tracked repository, an ignore path or the dashboard's home directory. It is a mutating
request under the same-origin protection and starts no process.

#### Scenario: Creating the folder
- **WHEN** `~/Workspace` does not exist and `POST /api/setup/workspace-folder` is sent with `{ "path": "~/Workspace" }`
- **THEN** the response is `201` with the canonical path, the folder exists and is empty, and `GET /api/config` is unchanged

#### Scenario: Already exists
- **WHEN** `~/Workspace` exists and the same request is sent
- **THEN** the response is `409` and the folder is unchanged

#### Scenario: Cross-site
- **WHEN** a page from another origin sends `POST /api/setup/workspace-folder`
- **THEN** the response is `403` and nothing is created

### Requirement: The session list reports keep-awake

`GET /api/sessions` SHALL additionally return `keepAwake: { available, enabled, active, sessions }`: `available` whether
keep-awake can work on this machine (macOS with `/usr/bin/caffeinate`), `enabled` whether the setting is on, `active`
whether the server currently prevents idle system sleep, and `sessions` the number of sessions that count as busy at
the time of the request. Answering it SHALL evaluate keep-awake with the reports read for that same request, and MUST
NOT start any process other than the one the `keep-awake` capability allows. No other route SHALL be added for it; the
setting is saved with `PUT /api/config`.

#### Scenario: Status with a busy session
- **WHEN** `GET /api/sessions` is requested on macOS with keep-awake on and one session busy
- **THEN** the response holds `keepAwake: { available: true, enabled: true, active: true, sessions: 1 }`

#### Scenario: Status when switched off
- **WHEN** `GET /api/sessions` is requested with `keepAwake: false` in the configuration and one session busy
- **THEN** the response holds `enabled: false`, `active: false` and `sessions: 1`, and no keep-awake process runs

### Requirement: Stale cleanup endpoints
`GET /api/repos/<id>/changes/<name>/stale-cleanup` SHALL return the change's stale and kept leftovers, read afresh as
specified in the `stale-changes` capability: for each worktree its path, branch, commit, uncommitted paths (at most 200,
the rest counted) and whether the acknowledgement is required; for each branch its name and commit; for the main
checkout's change directory its files with their content hashes and staged state; for each kept item the reason. With
`?ending=<session id>` of a running change session of that change, the session's worktree SHALL be evaluated as it
will be once that session has ended, so the end-session dialog can offer it; every other running session still keeps
its worktree. `POST /api/repos/<id>/changes/<name>/stale-cleanup` with
`{ "worktrees": [{ "path", "branch", "commit", "uncommitted": [<path>, …] }, …], "branches": [{ "name", "commit" }, …], "mainCheckout": { "files": [{ "path", "hash" }, …] } | null, "acknowledged": <boolean> }`
SHALL apply the cleanup of that capability to exactly those items, returning one outcome per requested item, then
trigger a rescan of the repository. The request only identifies items and what the user saw: the server SHALL recompute
the leftovers and SHALL report as kept, with a reason, any requested item that is not a current stale leftover of that
change, never passing it to a removal. Both routes SHALL accept only a configured, enabled git repository whose last
scan succeeded and a valid change name (`404` for an unknown repository, `409` when not eligible, `400` for an invalid
name or a malformed body, with no git command run). A request whose items need the acknowledgement and that does not
carry it SHALL be refused with `409` and nothing removed. A `POST` while a cleanup or deletion runs in the repository
SHALL be refused with `409`; an item whose worktree still has a running session is reported as kept, so the
end-session dialog SHALL end the session before it posts. The `POST` route is subject to the same-origin protection. Neither route depends on agent
sessions being enabled.

#### Scenario: Preview
- **WHEN** `GET /api/repos/<id>/changes/rotate-keys/stale-cleanup` is called for an archived, merged change with one
  leftover worktree holding `src/keys.ts`
- **THEN** the response lists that worktree with its branch, commit, `src/keys.ts` and the acknowledgement required

#### Scenario: An item that is not a leftover
- **WHEN** the `POST` names the worktree of `feat/report`, which belongs to no stale change
- **THEN** it is reported as kept because it is not a stale leftover of `rotate-keys`, and nothing is removed for it

#### Scenario: Missing acknowledgement
- **WHEN** the `POST` names a worktree with an uncommitted file outside the change's directories and `acknowledged` is false
- **THEN** the response is `409` and nothing is removed

#### Scenario: Foreign origin
- **WHEN** a page on another origin posts to that route
- **THEN** the response is `403` and nothing is removed

#### Scenario: Preview for a session being ended
- **WHEN** `GET /api/repos/<id>/changes/rotate-keys/stale-cleanup?ending=<id>` is called while that session runs in its
  merged worktree
- **THEN** that worktree is listed as a stale leftover, not as kept for a running session

### Requirement: A remove-duplicate session request is checked against the last scan
The session start request SHALL accept `removeDuplicate: true` together with `action: "archive"`, a tracked repository
and a validated change name, and nothing else describing the duplicate. The server SHALL refuse it with a 4xx status and
the reason when the action is not `archive`, when its own last scan reports no duplicate after archive for that change,
when a local branch `chore/archive-<name>` exists or a worktree is on it, or when a session for the change is running;
otherwise it SHALL start the session with the archive directory and differing paths of that scan. The request passes
the same-origin guard of every mutating route.

#### Scenario: Smuggled archive name
- **WHEN** a request carries `removeDuplicate: true` and an `archive` field naming another directory
- **THEN** the extra field is ignored and the prompt names the archive directory from the last scan

#### Scenario: Wrong action
- **WHEN** a request carries `removeDuplicate: true` with `action: "implement"`
- **THEN** it is refused and no session starts
