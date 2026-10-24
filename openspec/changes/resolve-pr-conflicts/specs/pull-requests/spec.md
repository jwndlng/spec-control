## MODIFIED Requirements

### Requirement: What a pull-request list contains
For each queried GitHub repository the list SHALL contain every open pull request, drafts included, and every pull request merged or closed within the last 7 days, up to 100 open and 50 recently closed ones; when a limit is reached the list SHALL say it is truncated. Each pull request SHALL carry its number, title, URL, author login, head and base branch, whether it is a draft, its state (`open`, `merged` or `closed`), when it was opened and, when applicable, merged or closed, its review decision (approved, changes requested, review required, or none), whether review is requested from the signed-in user, a summary of its checks (passing, failing, pending, or none), its mergeability as GitHub reports it (`mergeable`, `conflicting`, or `unknown` while GitHub has not computed it), the commit its head branch points at (its **head commit**, a full 40-character hexadecimal object name), and whether its head branch lives in another repository than the one queried (a pull request from a fork). For an open pull request of a GitHub repository that at least one enabled repository with docs auto-merge switched on maps to, it SHALL also carry whether it is **docs-only**: true exactly when GitHub reports at least one changed file, the list of changed file paths GitHub returned is complete — as many paths as GitHub's count of changed files — and every path lies under `openspec/` at the repository root; any other answer, a count larger than the paths returned, or a field missing or malformed SHALL make it not docs-only. The paths themselves SHALL NOT be kept, cached or sent to the browser, and for every other repository and every merged or closed pull request the changed files SHALL NOT be requested. Mergeability, the head commit, whether the head lives in another repository and the changed files SHALL be read with the same `gh pr list` calls as every other field. A cached pull request written before mergeability was read, or carrying a value the dashboard does not recognise, SHALL be treated as `unknown`; one without a head commit, or carrying a value that is not 40 hexadecimal characters, SHALL have no head commit; one without the docs-only answer SHALL be treated as not docs-only; and one without the answer whether its head lives in another repository SHALL be treated as not known to be in the same repository.

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

#### Scenario: A pull request from a fork
- **WHEN** an open pull request of `demo-ops` has its head branch in another user's fork
- **THEN** it is listed as having its head in another repository, and no `gh` subcommand other than `gh pr list` was run to learn it

### Requirement: A linked open pull request has a readiness
The dashboard SHALL derive, for display only, the **readiness** of an `open` pull request (drafts included) from its cached fields: it is **ready** when it is not a draft, its checks summary is `passing` or `none`, and its mergeability is `mergeable`; otherwise it is **not ready** with exactly one reason, the first that applies in this order: `draft`, `conflicts` (mergeability `conflicting`), `checks failing`, `checks running` (checks `pending`), `mergeability unknown`. A merged or closed pull request SHALL have no readiness. The review decision SHALL NOT enter into readiness. A not-ready pull request is **in progress** when its reason is `checks running` or `mergeability unknown` — something on GitHub is still being computed — and **waiting** otherwise. The rule SHALL be one shared rule, so that the card, the detail header and the watch never disagree, and like the link it SHALL be derived on display and never stored, logged or used as an input to scanning, columns, counts, filters or actions — with one exception: a linked open pull request whose mergeability is `conflicting` is the **GitHub signal** that offers Resolve conflicts, as the `agent-sessions` capability specifies. It changes nothing else about the change, and in particular not its column, sub-state or starters.

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

#### Scenario: A conflict offers Resolve conflicts and nothing else
- **WHEN** a change's linked open pull request is cached as `conflicting`
- **THEN** Resolve conflicts is offered for the change, and its column, sub-state, progress, counts and starters are unchanged
