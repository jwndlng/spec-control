# Spec Delta

## ADDED Requirements

### Requirement: Pull requests are created and merged through the GitHub CLI
When Spec Control opens a pull request during a deterministic Ship or automatic Ship, or merges a ready pull request during a manual Merge or automatic docs-only merge, it SHALL invoke the GitHub CLI (`gh`) without a shell, with its working directory in the dashboard home outside every tracked repository, prompts disabled, no standard input, a bounded timeout, and credential-masked error reporting:

- To open a pull request: `gh pr create --repo <owner/name> --head <branch> --base <defaultBranch> --title <title> --body <body>`, where `<owner/name>`, `<branch>`, and `<defaultBranch>` are validated on the server. If an open pull request for `<branch>` in `<owner/name>` already exists, Spec Control SHALL reuse that pull request instead of creating a duplicate.
- To merge a pull request: `gh pr merge <number> --repo <owner/name> --squash --match-head-commit <headOid>`, where `<number>` is a positive integer and `<headOid>` is the full 40-character hexadecimal head commit from the repository's pull-request list. Spec Control MUST NOT pass `--delete-branch` or `--auto`.

After creating or merging a pull request, Spec Control SHALL refresh that GitHub repository's cached pull-request list so the board, change detail, and session panel reflect the new or merged pull request immediately.

#### Scenario: Creating a pull request on Ship
- **WHEN** Spec Control ships branch `feat/rotate-keys` of `demo-ops` (`acme/demo-ops`) against `main` with title `feat(openspec): rotate-keys` and no open pull request exists for `feat/rotate-keys`
- **THEN** `gh pr create --repo acme/demo-ops --head feat/rotate-keys --base main --title "feat(openspec): rotate-keys" --body …` runs outside every tracked repository without a shell, and `acme/demo-ops`'s pull-request list is refreshed

#### Scenario: Reusing an already open pull request on Ship
- **WHEN** Spec Control ships branch `feat/rotate-keys` of `demo-ops` after pushing a new commit and open pull request `#88` already has head `feat/rotate-keys`
- **THEN** no `gh pr create` process is started, and `#88` remains the change's open pull request

#### Scenario: Merging a ready pull request with head-commit guard
- **WHEN** Spec Control merges ready pull request `#88` of `acme/demo-ops` at head commit `c0ffee0123456789abcdef0123456789abcdef01`
- **THEN** `gh pr merge 88 --repo acme/demo-ops --squash --match-head-commit c0ffee0123456789abcdef0123456789abcdef01` runs without `--delete-branch` or `--auto`, and `acme/demo-ops`'s pull-request list is refreshed

## MODIFIED Requirements

### Requirement: Pull requests are read through the GitHub CLI, read-only
The dashboard SHALL obtain pull requests by running the GitHub CLI (`gh`) without a shell, using only `gh pr list` with JSON output and `gh api user` to learn the signed-in login. A tracked repository SHALL be queried only when it is a git repository whose `origin` remote points to `github.com`, in any of its URL forms; the repository SHALL be addressed by its `owner/name` and the `gh` process SHALL run with its working directory outside every tracked repository, so that no tracked repository is read or written by it. `gh` SHALL run with prompts disabled, no standard input and a timeout after which it is stopped and reported as failed. The dashboard SHALL rely on `gh`'s own sign-in and MUST NOT read, store, request, log or forward credentials or tokens, and any text it passes to the browser SHALL have credentials embedded in URLs masked. Refreshing or listing pull requests MUST NOT run any other `gh` subcommand and MUST NOT change anything on GitHub; the only other `gh` subcommands the dashboard may run are `gh issue list` (`issue-import`), `gh repo list` (`github-repositories`), `gh pr close` (`change-dismissal`), and `gh pr create` and `gh pr merge` (`Pull requests are created and merged through the GitHub CLI`). Enabled repositories that share one GitHub repository SHALL cause one query, whose result applies to each of them.

#### Scenario: HTTPS and SSH remotes
- **WHEN** one tracked repository's `origin` is `https://github.com/acme/alpha-infra.git` and another's is `git@github.com:acme/beta-soc.git`
- **THEN** they are queried as `acme/alpha-infra` and `acme/beta-soc`

#### Scenario: Two clones of one project
- **WHEN** two enabled repositories both have `origin` `github.com/acme/alpha-infra`
- **THEN** `acme/alpha-infra` is queried once and both repositories show its pull requests

#### Scenario: Remote needs a login gh does not have
- **WHEN** `gh` would ask for authentication
- **THEN** nothing prompts, the query fails within the timeout or at once, and the reason is reported

#### Scenario: Refreshing pull requests lists no issues
- **WHEN** the user refreshes pull requests
- **THEN** only `gh pr list` and `gh api user` processes are started, and no `gh issue list`

### Requirement: The board watches pull requests that are not ready
While a Kanban board is open and the browser tab showing it is visible, and at least one card on it links an open pull request that is not ready or whose **merge is pending**, the board SHALL refresh the pull-request lists of exactly the repositories of those cards on its own — the **pull-request watch** — ignoring the five-minute freshness window. A pull request's merge is pending while it is open and a session of the card's change records that a merge was requested or attempted for that pull request's number and its current head commit (`agent-sessions`: "A ready docs-only pull request is handed to its agent to merge"); a pending merge SHALL count as in progress, whatever its readiness, and SHALL end when the pull request is merged or closed or its head commit changes. The next watch refresh SHALL be due 60 seconds after the previous refresh settled while at least one watched pull request is in progress, and five minutes after it while every watched pull request is only waiting. The watch SHALL stop as soon as no card on the board links an open pull request that is not ready or whose merge is pending, when the user leaves the board, and while the tab is hidden; when the tab becomes visible again it SHALL resume on the same schedule, counted from the last refresh. A watch refresh SHALL share the one-refresh-at-a-time rule with every other refresh: when a refresh is already running the watch SHALL NOT start another. It SHALL refresh only enabled repositories whose pull requests can be queried, and a repository that is unavailable (not on GitHub, `gh` missing or not signed in) SHALL NOT be watched. Lists that are synthetic (the demo) SHALL never be watched. The watch query itself SHALL use the same read-only `gh pr list` query as every other refresh, after which the server runs its ready docs-only auto-merge check on the refreshed list.

#### Scenario: Watching running checks
- **WHEN** a board is open and visible and one card links open pull request `#125` of `alpha-infra` whose checks are running
- **THEN** about a minute after the last refresh `alpha-infra`'s pull requests are queried again, and no other repository is queried by the watch

#### Scenario: Waiting on a conflict slows down
- **WHEN** the only not-ready pull request on an open board conflicts with its base
- **THEN** the watch queries its repository again five minutes after the last refresh, not every minute

#### Scenario: Ready ends the watch
- **WHEN** a watch refresh finds that `#125`'s checks now pass and it is mergeable, no merge is pending for it, and no other card links a not-ready pull request
- **THEN** no further watch refresh is scheduled while the board stays open

#### Scenario: A pending merge keeps the watch going
- **WHEN** a watch refresh finds the docs-only pull request `#88` of `demo-ops` ready, and a merge for `#88` at its head commit is in flight or recorded on its session while `#88` is still listed as open
- **THEN** about a minute after that refresh `demo-ops`'s pull requests are queried again, and again each minute until `#88` is listed as merged or closed or with another head commit

#### Scenario: A new push ends the pending merge
- **WHEN** a merge was recorded for `#88` at one head commit, and a refresh lists `#88` open with another head commit and its checks passing
- **THEN** `#88` is no longer a pending merge, and is watched only if it is not ready

#### Scenario: Hidden tab
- **WHEN** the tab showing the board is hidden for ten minutes while `#125`'s checks are running
- **THEN** no `gh` process is started in that time, and a refresh runs once the tab is visible again and the minute since the last refresh has passed

#### Scenario: Leaving the board
- **WHEN** the user moves from the board to the projects overview while `#125`'s checks are running
- **THEN** the watch stops and no further `gh` process is started

#### Scenario: One refresh at a time
- **WHEN** a watch refresh is due while a refresh the user started is still running
- **THEN** no second refresh starts

#### Scenario: Demo
- **WHEN** the demo shows a card whose pull request's checks are running
- **THEN** nothing is ever refreshed for it
