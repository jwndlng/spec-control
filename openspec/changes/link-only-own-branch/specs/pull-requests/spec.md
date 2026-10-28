## ADDED Requirements

### Requirement: Another change's branch never links a pull request
A change's `branchMatch` is one of its candidate branches ("A pull request is linked to a change by its head branch"), so the branch of a worktree that merely carries a copy of the change along — a worktree made for another change, cut from a commit that already held this one — MUST NOT become a candidate branch of this change: the scanner gives a change a linked worktree's branch only as "Branch and worktree matching" of the `change-scanner` capability allows. Showing another change's pull request is worse than showing none, because the link decides the card's recommended step and the branch **Resolve conflicts** starts on. A change left without a `branchMatch` this way SHALL still be linked through its recorded branches and the branches the dashboard's own sessions create for it, exactly as before.

#### Scenario: A carried copy does not take the other change's pull request
- **WHEN** change `rotate-keys` of `demo-ops` is `Done` on `origin/main` and `Implementing` in a main checkout that was not pulled, it records no branch, its merged pull request `#10` has head `feat/rotate-keys`, and a session for `add-login` made a worktree on `feat/add-login` from `origin/main` whose open pull request `#20` has head `feat/add-login`
- **THEN** `#10` is shown as the pull request of `rotate-keys`, `#20` only as that of `add-login`

#### Scenario: Another change's conflict is not offered
- **WHEN** in that situation `#20` is open and GitHub reports it as conflicting
- **THEN** the card of `rotate-keys` does not recommend **Resolve conflicts**, and no session for `rotate-keys` is started on `feat/add-login`

#### Scenario: Work on another branch still links it
- **WHEN** change `rotate-keys` leads from a worktree on `wip/keys` whose branch has commits changing `openspec/changes/rotate-keys/`, and a cached open pull request `#31` has head `wip/keys`
- **THEN** `#31` is shown as the pull request of `rotate-keys`
