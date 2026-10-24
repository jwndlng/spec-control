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

### Requirement: A pull request is linked to a change by its head branch
A cached pull request SHALL be shown as a change's pull request only when it belongs to that change's repository and it is chosen by the first of these steps that yields one:

1. **Recorded branch.** A cached pull request whose head branch is exactly the change's recorded implementation branch or recorded archive branch (change-scanner: "The scan reports a change's recorded branches") SHALL be a match.
2. **Candidate branch.** Otherwise, a cached pull request whose head branch is exactly one of the change's **candidate branches** SHALL be a match. A change's candidate branches are its recorded branches, its `branchMatch`, when it has one, and the two branches the dashboard's own agent sessions create for that change: the implementation branch `feat/<name>` and the archive branch `chore/archive-<name>`, where `<name>` is the change name exactly as written.

Branches SHALL be compared as written with no normalisation, abbreviation or containment. The candidates SHALL be the same for an active and an archived change, and the session branch names SHALL be the same ones the dashboard uses when it creates a session's branch. A change for which no step yields a match SHALL be shown without a pull request. The dashboard MUST NOT infer a link from the pull request's title, from a branch that merely contains or resembles the change name, or from any branch other than the recorded and candidate branches.

In both steps, a merged or closed pull request that was merged or closed more than one day before the change's creation date SHALL NOT be linked to that change, so a change that reuses the name of an earlier one does not inherit its pull request. A change without a creation date, and an open pull request, are not affected by this rule.

Where several cached pull requests match within the step that yields the link, exactly one SHALL be shown: an `open` one (a draft counts as open) in preference to any other, otherwise the one most recently merged, closed or opened, otherwise the one with the higher number. The choice SHALL be deterministic and SHALL be the same wherever the link is shown.

The link SHALL be derived when it is displayed, from the snapshot and the cached lists. It MUST NOT be stored in a change's snapshot, written to any cache, or recorded in the activity log, and it MUST NOT affect a change's column, sub-state, progress, counts or filters. The only things the link and its readiness may change are what the change's card, detail header and Console tab display — the pull-request badge, the card's working state (`kanban-board`: "A card keeps its working state until its pull request is ready") and which action the split button recommends, plus the pull request's own action in its menu (`kanban-board`: "A change's actions are one split button") — which repositories a board's pull-request watch refreshes, and **Resolve conflicts**, the one action the link may affect (`agent-sessions`: "Resolve conflicts asks the agent to make the branch mergeable again"): a linked open pull request that GitHub reports as conflicting offers it, its head branch decides which session the prompt goes to or which branch a new session starts on, and the server refuses it when neither conflict signal holds or the session works on another branch than that head. Every other available action, and every other refusal of a session start, SHALL be decided without the link. The dashboard MUST NOT write a change's record.

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

#### Scenario: Resolve conflicts follows the recorded branch
- **WHEN** change `rotate-keys` records `branch: fix/rotate-keys`, has no session worktree, and cached open `#88` with head `fix/rotate-keys` is reported as conflicting
- **THEN** Resolve conflicts is offered for `rotate-keys` and starts its session on `fix/rotate-keys`, and the change's column, sub-state, progress and counts are unchanged

#### Scenario: Other actions ignore the link
- **WHEN** a change gains a linked open pull request that GitHub reports as conflicting
- **THEN** the server offers and refuses every action other than Resolve conflicts exactly as without the link
