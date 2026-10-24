# pull-requests Specification

## Purpose

Gives an overview of the recently opened pull requests of all tracked repositories and of each one, with their review
and check status, read from GitHub through the user's own GitHub CLI and only when the user asks for it.

## Requirements

### Requirement: Pull requests are read through the GitHub CLI, read-only
The dashboard SHALL obtain pull requests by running the GitHub CLI (`gh`) without a shell, using only `gh pr list` with JSON output and `gh api user` to learn the signed-in login. A tracked repository SHALL be queried only when it is a git repository whose `origin` remote points to `github.com`, in any of its URL forms; the repository SHALL be addressed by its `owner/name` and the `gh` process SHALL run with its working directory outside every tracked repository, so that no tracked repository is read or written by it. `gh` SHALL run with prompts disabled, no standard input and a timeout after which it is stopped and reported as failed. The dashboard SHALL rely on `gh`'s own sign-in and MUST NOT read, store, request, log or forward credentials or tokens, and any text it passes to the browser SHALL have credentials embedded in URLs masked. The dashboard MUST NOT run any other `gh` subcommand, except `gh issue list` as the `issue-import` capability specifies, and MUST NOT change anything on GitHub. Enabled repositories that share one GitHub repository SHALL cause one query, whose result applies to each of them.

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

### Requirement: GitHub is contacted only when the user asks
The pull-request query SHALL run only when the user activates a **Refresh** control on the Pull requests view or in a repository's pull-request dialog, when the user opens one of the three views that show pull requests — the Pull requests view, a repository's pull-request dialog, or a Kanban board — and the shown repositories' cached lists are older than five minutes or were never fetched, or as the **pull-request watch** of an open Kanban board ("The board watches pull requests that are not ready"). It MUST NOT run on any other timer, during or after a scan, on page load of a view that shows no pull request, on the projects overview, or as a side effect of another operation. While a refresh runs, the control SHALL show that it is running and SHALL NOT start a second one.

#### Scenario: Opening the view with a stale cache
- **WHEN** the user opens `/pull-requests` and the last fetch was 20 minutes ago
- **THEN** the cached lists are shown at once, marked with their age, and a refresh runs and replaces them when it completes

#### Scenario: Opening the view with a fresh cache
- **WHEN** the user opens `/pull-requests` two minutes after the last fetch
- **THEN** the cached lists are shown and GitHub is not contacted

#### Scenario: Explicit refresh
- **WHEN** the user activates Refresh one minute after the last fetch
- **THEN** GitHub is queried regardless of the cache's age

#### Scenario: Overview and scans stay offline
- **WHEN** the dashboard runs for an hour with the projects overview open and scans on its poll interval
- **THEN** no `gh` process is started

#### Scenario: Opening the board with a stale cache
- **WHEN** the user opens a board and the last fetch was 20 minutes ago
- **THEN** the cards show what the cache holds at once, and one refresh runs and updates them when it completes

#### Scenario: Opening the board with a fresh cache
- **WHEN** the user opens a board two minutes after the last fetch
- **THEN** the cached pull requests are shown and no `gh` process is started

#### Scenario: Moving between boards does not re-fetch
- **WHEN** the user opens the combined board, then a repository board, within five minutes of a fetch
- **THEN** GitHub is contacted once at most, and not a second time for the second board

#### Scenario: The board does not fetch on a timer
- **WHEN** a board stays open for an hour while scans run on the poll interval, and none of its cards links an open pull request that is not ready
- **THEN** no `gh` process is started after the one refresh the board's opening may have caused

#### Scenario: The Pull requests view does not watch
- **WHEN** the Pull requests view stays open for an hour and lists an open pull request whose checks are running
- **THEN** no `gh` process is started after the one refresh its opening may have caused

#### Scenario: The overview is still offline
- **WHEN** the user opens the projects overview with a cache two hours old
- **THEN** the cached counts are shown and no `gh` process is started

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

### Requirement: Unavailable and failed repositories are reported, not hidden
A repository that cannot be queried SHALL be reported as unavailable with a reason, without an error being raised: a repository that is not a git repository or has no `origin` on `github.com` ("not on GitHub"), a machine without `gh` ("GitHub CLI not installed"), and `gh` not signed in to `github.com` (the reason SHALL name `gh auth login`). A query that fails for another reason, including a timeout, SHALL be reported as failed with the reason, and the repository's previously fetched list SHALL remain shown, marked with its age. The failure of one repository SHALL NOT affect the others.

#### Scenario: gh missing
- **WHEN** the user refreshes pull requests on a machine without `gh`
- **THEN** every GitHub repository is shown as unavailable with "GitHub CLI not installed" and nothing else fails

#### Scenario: Repository on another host
- **WHEN** a tracked repository's `origin` is on `gitlab.example.test`
- **THEN** it is shown as not on GitHub and no `gh` process is started for it

#### Scenario: Failure keeps the last list
- **WHEN** a refresh of `acme/alpha-infra` times out after an earlier refresh listed 4 pull requests
- **THEN** the 4 pull requests remain shown with their age and the failure reason is available

### Requirement: Fetched lists are cached and are never an input
The last successful list per GitHub repository and its fetch time SHALL be kept in memory and in the dashboard home (`~/.spec-control/`), so that they are shown after a restart without contacting GitHub. The cache SHALL only be displayed: it MUST NOT be an input to scanning, columns, counts of changes, the activity log or any action, and deleting it SHALL lose nothing but the cached lists. Lists of repositories that are no longer enabled SHALL not be shown.

#### Scenario: After a restart
- **WHEN** the dashboard is restarted and the projects overview is opened
- **THEN** the open pull-request counts of the last fetch are shown with no `gh` process started

#### Scenario: Cache deleted
- **WHEN** the cache file is deleted and the dashboard restarted
- **THEN** repositories show that pull requests were not fetched yet, and everything else is unchanged

### Requirement: Pull requests view in the top navigation
The top navigation SHALL offer **Pull requests** after *Activity*, opening a view at `/pull-requests` that lists the pull requests of all enabled repositories. Open pull requests SHALL be listed first, newest opened first, followed by a "Recently merged or closed" group, newest merged or closed first. Each entry SHALL show the repository name with the repository's colour, `#<number>`, the title as a link to the pull request on GitHub that opens in a new browser tab, the author, the head branch in monospace, the relative age since it was opened (or merged or closed), and its state, review decision and checks summary, each conveyed with text or a symbol plus a tooltip and never by colour alone. Entries where review is requested from the signed-in user SHALL be marked. The view SHALL show when the lists were last fetched and a Refresh control, and SHALL list unavailable and failed repositories with their reasons in collapsed notices rather than as entries. A repository that is unavailable because it is not on GitHub or not a git repository is not a failure: it SHALL be summarised as information, as `<n> repository isn't on GitHub` or `<n> repositories aren't on GitHub`, and SHALL NOT be counted as a repository that could not be listed. A repository whose query failed SHALL be summarised as `<n> repository could not be listed` or `<n> repositories could not be listed`, marked as a warning. When both kinds occur, both summaries SHALL be shown, each listing only its own repositories with their reasons. When `gh` is missing or not signed in the view SHALL say so once and explain how to set it up. The view MUST work in every supported theme and MUST NOT make the browser request any host but the dashboard's own API.

#### Scenario: Reading the list
- **WHEN** `alpha-infra` has an open draft opened 2 hours ago and `beta-soc` has an approved open pull request with passing checks opened yesterday, and a pull request of `beta-soc` was merged today
- **THEN** the view lists the draft first, then the approved one, then under "Recently merged or closed" the merged one, each with repository, number, title, author, branch, age and status

#### Scenario: Review requested from me
- **WHEN** review of `beta-soc#42` is requested from the signed-in user
- **THEN** its entry carries a "review requested from you" marker

#### Scenario: Nothing to show
- **WHEN** no enabled repository has an open or recently closed pull request
- **THEN** the view says there are no recent pull requests and when that was last checked

#### Scenario: gh not signed in
- **WHEN** `gh` is installed but not signed in
- **THEN** the view explains once that `gh auth login` is needed, and lists no repository as failed

#### Scenario: Repository not on GitHub
- **WHEN** `quill-docs` has an `origin` that is not on GitHub and every other repository was listed
- **THEN** the view shows a collapsed note `1 repository isn't on GitHub` naming `quill-docs` with "not on GitHub", and
  does not say that any repository could not be listed

#### Scenario: Not on GitHub and failed together
- **WHEN** `plain-notes` is not a git repository and the query for `alpha-infra` timed out
- **THEN** the view shows `1 repository isn't on GitHub` listing `plain-notes` with "not a git repository", and, marked
  as a warning, `1 repository could not be listed` listing `alpha-infra` with "gh timed out"

### Requirement: The Pull requests view can be filtered
The view SHALL offer a repository filter, a state filter (open, recently merged or closed, all; default open and recently closed both shown), and a "review requested from me" filter. The filters SHALL combine, apply instantly on the client without contacting GitHub, and persist in the URL query string with default values omitted. With the repository filter set, the view SHALL show only that repository's pull requests and its unavailable or failed state, if any.

#### Scenario: One project
- **WHEN** the user opens `/pull-requests?repo=<id of beta-soc>`
- **THEN** only `beta-soc`'s pull requests are listed and the repository filter shows `beta-soc`

#### Scenario: What needs my review
- **WHEN** the user enables "review requested from me"
- **THEN** only open pull requests whose review is requested from the signed-in user are listed, and the URL contains the filter

### Requirement: A pull request is linked to a change by its head branch
A cached pull request SHALL be shown as a change's pull request only when it belongs to that change's repository and it is chosen by the first of these steps that yields one:

1. **Recorded branch.** A cached pull request whose head branch is exactly the change's recorded implementation branch or recorded archive branch (change-scanner: "The scan reports a change's recorded branches") SHALL be a match.
2. **Candidate branch.** Otherwise, a cached pull request whose head branch is exactly one of the change's **candidate branches** SHALL be a match. A change's candidate branches are its recorded branches, its `branchMatch`, when it has one, and the two branches the dashboard's own agent sessions create for that change: the implementation branch `feat/<name>` and the archive branch `chore/archive-<name>`, where `<name>` is the change name exactly as written.

Branches SHALL be compared as written with no normalisation, abbreviation or containment. The candidates SHALL be the same for an active and an archived change, and the session branch names SHALL be the same ones the dashboard uses when it creates a session's branch. A change for which no step yields a match SHALL be shown without a pull request. The dashboard MUST NOT infer a link from the pull request's title, from a branch that merely contains or resembles the change name, or from any branch other than the recorded and candidate branches.

In both steps, a merged or closed pull request that was merged or closed more than one day before the change's creation date SHALL NOT be linked to that change, so a change that reuses the name of an earlier one does not inherit its pull request. A change without a creation date, and an open pull request, are not affected by this rule.

Where several cached pull requests match within the step that yields the link, exactly one SHALL be shown: an `open` one (a draft counts as open) in preference to any other, otherwise the one most recently merged, closed or opened, otherwise the one with the higher number. The choice SHALL be deterministic and SHALL be the same wherever the link is shown.

The link SHALL be derived when it is displayed, from the snapshot and the cached lists. It MUST NOT be stored in a change's snapshot, written to any cache, or recorded in the activity log, and it MUST NOT affect a change's column, sub-state, progress, counts, filters or available actions. The only things the link and its readiness may change are what the change's card and detail header display — the pull-request badge and the card's working state (`kanban-board`: "A card keeps its working state until its pull request is ready") — and which repositories a board's pull-request watch refreshes. The dashboard MUST NOT write a change's record.

#### Scenario: Exact branch match
- **WHEN** change `add-validate-phase` has `branchMatch: feat/add-validate-phase` and a cached open pull request `#125` has that head branch in the same repository
- **THEN** `#125` is shown as that change's pull request

#### Scenario: Worktree removed after the merge
- **WHEN** change `add-validate-phase` lives only in the main checkout on `main`, has no `branchMatch` because its session's worktree was removed, and a cached merged pull request `#125` has the head branch `feat/add-validate-phase`
- **THEN** `#125` is shown as that change's pull request, marked as merged

#### Scenario: Archive awaiting review
- **WHEN** change `add-validate-phase` is archived, its merged implementation pull request `#125` has the head branch `feat/add-validate-phase`, and an open pull request `#131` has the head branch `chore/archive-add-validate-phase`
- **THEN** `#131` is shown as that change's pull request

#### Scenario: Archive merged
- **WHEN** both `#125` (head `feat/add-validate-phase`, merged on 1 October) and `#131` (head `chore/archive-add-validate-phase`, merged on 2 October) are merged
- **THEN** `#131` is shown as that change's pull request

#### Scenario: No pull request for the branch
- **WHEN** a change records nothing and none of its candidate branches matches a cached pull request
- **THEN** the change is shown without a pull request

#### Scenario: Off-convention branch name
- **WHEN** a pull request's head branch is `jan/125-add-validate-phase`, the change `add-validate-phase` records nothing and has `branchMatch: feat/add-validate-phase`
- **THEN** no pull request is shown for that change

#### Scenario: Off-convention branch that is recorded
- **WHEN** change `rotate-keys` records `branch: fix/rotate-keys`, and a cached open pull request `#88` has the head branch `fix/rotate-keys`
- **THEN** `#88` is shown as that change's pull request

#### Scenario: Name containment is not a match
- **WHEN** change `add-validate` has `branchMatch: feat/add-validate` and the only cached pull requests have the head branches `feat/add-validate-phase` and `chore/archive-add-validate-phase`
- **THEN** no pull request is shown for `add-validate`

#### Scenario: Same branch in another repository
- **WHEN** a cached pull request of another tracked repository has the head branch `feat/<name>` of this change
- **THEN** it is not shown for this change

#### Scenario: Open wins over merged
- **WHEN** one merged and one open pull request match a change's candidate branches
- **THEN** the open one is shown

#### Scenario: Several closed pull requests
- **WHEN** two closed pull requests match a change's candidate branches and neither is open
- **THEN** the one most recently closed is shown

#### Scenario: A reused change name
- **WHEN** change `rotate-keys` was created on 20 September, records nothing, and the only cached pull request on `feat/rotate-keys` was merged on 10 September
- **THEN** no pull request is shown for `rotate-keys`

#### Scenario: Change without a branch
- **WHEN** a change records nothing, has no `branchMatch` and no cached pull request has the head branch `feat/<name>` or `chore/archive-<name>`
- **THEN** it is shown without a pull request

#### Scenario: A recorded branch wins over a guessed branch
- **WHEN** change `rotate-keys` records `branch: fix/rotate-keys`, cached `#142` is merged with head `fix/rotate-keys`, and a cached open `#150` has head `feat/rotate-keys`
- **THEN** `#142` is shown as that change's pull request

#### Scenario: Recorded implementation and archive branches
- **WHEN** archived change `rotate-keys` records `branch: feat/rotate-keys` and `archive-branch: chore/archive-rotate-keys`, cached `#142` on the first was merged on 1 October and cached `#151` on the second is open
- **THEN** `#151` is shown as that change's pull request

#### Scenario: Recorded branch without a cached pull request
- **WHEN** change `rotate-keys` records `branch: fix/rotate-keys`, no cached pull request has that head, and cached open `#150` has head `feat/rotate-keys`
- **THEN** `#150` is shown as that change's pull request

#### Scenario: A reused recorded branch
- **WHEN** change `rotate-keys` was created on 20 September, records `branch: fix/rotate-keys`, and the only cached pull request on `fix/rotate-keys` was merged on 10 September
- **THEN** no pull request is shown for `rotate-keys`

#### Scenario: Existing change without a record
- **WHEN** change `rotate-keys` was created before recording existed, records nothing, and cached open `#150` has head `feat/rotate-keys`
- **THEN** `#150` is shown as that change's pull request

#### Scenario: The link changes nothing else
- **WHEN** a change gains a linked pull request whose checks are still running
- **THEN** its column, sub-state, progress, the counts it contributes to and the starters it offers are unchanged, and the activity log records nothing

#### Scenario: Cache deleted
- **WHEN** the pull-request cache is deleted
- **THEN** no change shows a pull request and everything else is unchanged

### Requirement: A linked open pull request has a readiness
The dashboard SHALL derive, for display only, the **readiness** of an `open` pull request (drafts included) from its cached fields: it is **ready** when it is not a draft, its checks summary is `passing` or `none`, and its mergeability is `mergeable`; otherwise it is **not ready** with exactly one reason, the first that applies in this order: `draft`, `conflicts` (mergeability `conflicting`), `checks failing`, `checks running` (checks `pending`), `mergeability unknown`. A merged or closed pull request SHALL have no readiness. The review decision SHALL NOT enter into readiness. A not-ready pull request is **in progress** when its reason is `checks running` or `mergeability unknown` — something on GitHub is still being computed — and **waiting** otherwise. The rule SHALL be one shared rule, so that the card, the detail header and the watch never disagree, and like the link it SHALL be derived on display and never stored, logged or used as an input to scanning, columns, counts, filters or actions.

#### Scenario: Green and mergeable
- **WHEN** an open, non-draft pull request has passing checks and mergeability `mergeable`
- **THEN** it is ready

#### Scenario: No checks configured
- **WHEN** an open, non-draft pull request has no checks and mergeability `mergeable`
- **THEN** it is ready

#### Scenario: Checks still running
- **WHEN** an open pull request's checks are pending and it is mergeable
- **THEN** it is not ready, its reason is `checks running`, and it is in progress

#### Scenario: Conflict outranks checks
- **WHEN** an open pull request conflicts with its base and its checks are failing
- **THEN** it is not ready, its reason is `conflicts`, and it is waiting

#### Scenario: Mergeability not computed yet
- **WHEN** an open pull request's checks pass and its mergeability is `unknown`
- **THEN** it is not ready, its reason is `mergeability unknown`, and it is in progress

#### Scenario: Approval does not matter
- **WHEN** an open pull request is green and mergeable and its review decision is `review_required`
- **THEN** it is ready

#### Scenario: Draft
- **WHEN** an open pull request is a draft with passing checks
- **THEN** it is not ready, its reason is `draft`, and it is waiting

#### Scenario: Merged
- **WHEN** a pull request is merged
- **THEN** it has no readiness

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
