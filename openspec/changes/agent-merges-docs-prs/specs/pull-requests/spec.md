## MODIFIED Requirements

### Requirement: What a pull-request list contains
For each queried GitHub repository the list SHALL contain every open pull request, drafts included, and every pull request merged or closed within the last 7 days, up to 100 open and 50 recently closed ones; when a limit is reached the list SHALL say it is truncated. Each pull request SHALL carry its number, title, URL, author login, head and base branch, whether it is a draft, its state (`open`, `merged` or `closed`), when it was opened and, when applicable, merged or closed, its review decision (approved, changes requested, review required, or none), whether review is requested from the signed-in user, a summary of its checks (passing, failing, pending, or none), its mergeability as GitHub reports it (`mergeable`, `conflicting`, or `unknown` while GitHub has not computed it), and the commit its head branch points at (its **head commit**, a full 40-character hexadecimal object name). For an open pull request of a GitHub repository that at least one enabled repository with docs auto-merge switched on maps to, it SHALL also carry whether it is **docs-only**: true exactly when GitHub reports at least one changed file, the list of changed file paths GitHub returned is complete — as many paths as GitHub's count of changed files — and every path lies under `openspec/` at the repository root; any other answer, a count larger than the paths returned, or a field missing or malformed SHALL make it not docs-only. The paths themselves SHALL NOT be kept, cached or sent to the browser, and for every other repository and every merged or closed pull request the changed files SHALL NOT be requested. Mergeability, the head commit and the changed files SHALL be read with the same `gh pr list` calls as every other field. A cached pull request written before mergeability was read, or carrying a value the dashboard does not recognise, SHALL be treated as `unknown`; one without a head commit, or carrying a value that is not 40 hexadecimal characters, SHALL have no head commit; and one without the docs-only answer SHALL be treated as not docs-only.

#### Scenario: Merged last week and last month
- **WHEN** a repository has a pull request merged 3 days ago and one merged 30 days ago
- **THEN** the first is listed as merged and the second is not listed

#### Scenario: Check summary
- **WHEN** an open pull request has one failing and three passing checks
- **THEN** its checks summary is failing

#### Scenario: Truncated
- **WHEN** a repository has 140 open pull requests
- **THEN** 100 are listed and the list says it is truncated

#### Scenario: Conflicting pull request
- **WHEN** GitHub reports an open pull request's mergeability as `CONFLICTING`
- **THEN** it is listed with mergeability `conflicting`, and no `gh` subcommand other than `gh pr list` was run to learn it

#### Scenario: A cache from an earlier version
- **WHEN** the cache holds a pull request without mergeability
- **THEN** it is shown with mergeability `unknown` and nothing fails

#### Scenario: Docs-only pull request
- **WHEN** `demo-ops` has docs auto-merge on and its open pull request `#88` changes `openspec/specs/secrets/spec.md` and `openspec/changes/archive/2026-10-20-rotate-keys/proposal.md`
- **THEN** `#88` is listed as docs-only with its head commit, the two paths are not part of the list or the cache, and no `gh` subcommand other than `gh pr list` was run to learn it

#### Scenario: A file outside openspec
- **WHEN** an open pull request of a repository with docs auto-merge on changes `openspec/changes/rotate-keys/tasks.md` and `src/keys.ts`
- **THEN** it is listed as not docs-only

#### Scenario: More files than GitHub returned
- **WHEN** GitHub reports 140 changed files for an open pull request but returns 100 paths, all under `openspec/`
- **THEN** it is listed as not docs-only

#### Scenario: Changed files only where they are used
- **WHEN** pull requests are refreshed for `alpha-infra`, which has docs auto-merge off and shares no GitHub repository with a project that has it on
- **THEN** its `gh pr list` calls do not request changed files, and its pull requests are not docs-only

### Requirement: The board watches pull requests that are not ready
While a Kanban board is open and the browser tab showing it is visible, and at least one card on it links an open pull request that is not ready or whose **merge is pending**, the board SHALL refresh the pull-request lists of exactly the repositories of those cards on its own — the **pull-request watch** — ignoring the five-minute freshness window. A pull request's merge is pending while it is open and a session of the card's change records that a Merge prompt was sent for that pull request's number and its current head commit (`agent-sessions`: "A ready docs-only pull request is handed to its agent to merge"); a pending merge SHALL count as in progress, whatever its readiness, and SHALL end when the pull request is merged or closed or its head commit changes. The next watch refresh SHALL be due 60 seconds after the previous refresh settled while at least one watched pull request is in progress, and five minutes after it while every watched pull request is only waiting. The watch SHALL stop as soon as no card on the board links an open pull request that is not ready or whose merge is pending, when the user leaves the board, and while the tab is hidden; when the tab becomes visible again it SHALL resume on the same schedule, counted from the last refresh. A watch refresh SHALL share the one-refresh-at-a-time rule with every other refresh: when a refresh is already running the watch SHALL NOT start another. It SHALL refresh only enabled repositories whose pull requests can be queried, and a repository that is unavailable (not on GitHub, `gh` missing or not signed in) SHALL NOT be watched. Lists that are synthetic (the demo) SHALL never be watched. The watch SHALL use the same read-only query as every other refresh and MUST NOT change anything on GitHub or in any repository.

#### Scenario: Watching running checks
- **WHEN** a board is open and visible and one card links open pull request `#125` of `alpha-infra` whose checks are running
- **THEN** about a minute after the last refresh `alpha-infra`'s pull requests are queried again, and no other repository is queried by the watch

#### Scenario: Waiting on a conflict slows down
- **WHEN** the only not-ready pull request on an open board conflicts with its base
- **THEN** the watch queries its repository again five minutes after the last refresh, not every minute

#### Scenario: Ready ends the watch
- **WHEN** a watch refresh finds that `#125`'s checks now pass and it is mergeable, no Merge prompt was sent for it, and no other card links a not-ready pull request
- **THEN** no further `gh` process is started while the board stays open

#### Scenario: A pending merge keeps the watch going
- **WHEN** a watch refresh finds the docs-only pull request `#88` of `demo-ops` ready, and the dashboard sends its session a Merge prompt for `#88` at its head commit
- **THEN** about a minute after that refresh `demo-ops`'s pull requests are queried again, and again each minute until `#88` is listed as merged or closed or with another head commit

#### Scenario: A new push ends the pending merge
- **WHEN** a Merge prompt was sent for `#88` at one head commit, and a refresh lists `#88` open with another head commit and its checks passing
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
