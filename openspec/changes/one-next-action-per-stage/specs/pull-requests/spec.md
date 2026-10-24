## MODIFIED Requirements

### Requirement: A pull request is linked to a change by its head branch
A cached pull request SHALL be shown as a change's pull request when it belongs to that change's repository and its head branch is exactly one of the change's **candidate branches**, compared as written with no normalisation, abbreviation or containment. A change's candidate branches are its `branchMatch`, when it has one, and the two branches the dashboard's own agent sessions create for that change: the implementation branch `feat/<name>` and the archive branch `chore/archive-<name>`, where `<name>` is the change name exactly as written. The candidates SHALL be the same for an active and an archived change, and the session branch names SHALL be the same ones the dashboard uses when it creates a session's branch. A change whose candidate branches match no cached pull request SHALL be shown without one. The dashboard MUST NOT infer a link from the pull request's title, from a branch that merely contains or resembles the change name, or from any branch other than the candidates.

A merged or closed pull request that was merged or closed more than one day before the change's creation date SHALL NOT be linked to that change, so a change that reuses the name of an earlier one does not inherit its pull request. A change without a creation date, and an open pull request, are not affected by this rule.

Where several cached pull requests match, across all of the change's candidate branches, exactly one SHALL be shown: an `open` one (a draft counts as open) in preference to any other, otherwise the one most recently merged, closed or opened, otherwise the one with the higher number. The choice SHALL be deterministic and SHALL be the same wherever the link is shown.

The link SHALL be derived when it is displayed, from the snapshot and the cached lists. It MUST NOT be stored in a change's snapshot, written to any cache, or recorded in the activity log, and it MUST NOT affect a change's column, sub-state, progress, counts, filters or available actions. The only things the link and its readiness may change are what the change's card, detail header and Console tab display — the pull-request badge, the card's working state (`kanban-board`: "A card keeps its working state until its pull request is ready") and which action the split button recommends, plus the pull request's own action in its menu (`kanban-board`: "A change's actions are one split button") — and which repositories a board's pull-request watch refreshes. The server's available actions for a change, and every refusal of a session start, SHALL be decided without the link.

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
- **WHEN** none of a change's candidate branches matches a cached pull request
- **THEN** the change is shown without a pull request

#### Scenario: Off-convention branch name
- **WHEN** a pull request's head branch is `jan/125-add-validate-phase` and the change `add-validate-phase` has `branchMatch: feat/add-validate-phase`
- **THEN** no pull request is shown for that change

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
- **WHEN** change `rotate-keys` was created on 20 September and the only cached pull request on `feat/rotate-keys` was merged on 10 September
- **THEN** no pull request is shown for `rotate-keys`

#### Scenario: Change without a branch
- **WHEN** a change has no `branchMatch` and no cached pull request has the head branch `feat/<name>` or `chore/archive-<name>`
- **THEN** it is shown without a pull request

#### Scenario: The link changes nothing else
- **WHEN** a change gains a linked pull request whose checks are still running
- **THEN** its column, sub-state, progress, the counts it contributes to and its available actions are unchanged, the activity log records nothing, and only its split button's main part shows that the pull request is waiting

#### Scenario: Cache deleted
- **WHEN** the pull-request cache is deleted
- **THEN** no change shows a pull request and everything else is unchanged
