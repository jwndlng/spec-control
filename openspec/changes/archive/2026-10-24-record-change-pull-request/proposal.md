# Proposal

## Why

A change's pull request is never recorded anywhere. The dashboard guesses it again on every display from branch names —
the change's `branchMatch`, `feat/<name>` and `chore/archive-<name>` — and the guess goes wrong in both directions:

- **The wrong pull request is shown.** For a change that lives in the main checkout, the scanner sets `branchMatch` to
  the first branch whose name *contains* the change name (`findBranchMatch` in `src/server/scanner.ts`). Change
  `add-validate` therefore gets `branchMatch: feat/add-validate-phase` while that sibling change has a worktree, and the
  exact comparison in `linkedPullRequest` then faithfully links `add-validate-phase`'s pull request to it. The
  pull-requests spec forbids containment ("Name containment is not a match"), but the containment happens one step
  earlier, where the spec still allows it.
- **The right pull request is missed.** When the agent pushes under a branch the dashboard did not name — it renamed
  `feat/<name>` to `fix/<name>`, or shipped from a branch it created itself — no candidate matches and the change shows
  no pull request at all, although the agent opened one and said so.

Nothing in the repository says which pull request belongs to a change, so the dashboard cannot do better than guess.
Two follow-up changes need a reliable answer too: `resolve-pr-conflicts` has to know which branch to recreate a
worktree on, and `stale-means-archived-and-merged` has to know which branch's work must be in the default branch.

## What Changes

- **The change records its pull request's branch.** A change's `.openspec.yaml` gains one namespaced map,
  `spec-control:`, with the head branch of its implementation pull request (`branch`) and, once archived through a pull
  request of its own, that one's head branch (`archive-branch`). No pull request numbers: the branch is enough to link
  exactly, and it is known before the push, so nothing has to be kept in sync afterwards. OpenSpec reads the file with a non-strict
  schema and only ever rewrites it when the change is created, so the map survives the change's whole life, including
  the move into `archive/`.
- **The agent writes it, never the dashboard.** Whenever the dashboard asks an agent to open a pull request — Ship,
  Fast-forward's ship step, and the docs auto-merge archive instruction — it appends a fixed **record instruction**:
  record the branch in the change's `.openspec.yaml` and include it in the commit with the work, before pushing. No extra
  commit after the pull request is opened. The record travels with the branch and reaches the default branch with the merge, so the
  repository stays the source of truth. No entry is added to invariant 1: the dashboard writes nothing for this.
- **The record wins over every guess.** A change's pull request is, in order: a pull request on a recorded branch, else
  today's exact candidates. Off-convention branches are followed once they are recorded. Existing changes are not
  backfilled; they keep the exact candidates.
- **No containment anywhere.** `branchMatch` for a change in the main checkout becomes an exact match against the
  change's candidate branches (recorded branches, `feat/<name>`, `chore/archive-<name>`) instead of "contains the
  change name". A change in a linked worktree keeps that worktree's branch, as today.
- The record is read by the OpenSpec module (invariant 3) and reported in a framework-neutral field on the change. It
  is an input to the pull-request link only — not to columns, counts, actions or the activity log.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `pull-requests`: the link prefers a recorded branch over the guessed candidates.
- `change-scanner`: `branchMatch` is an exact match; the scan reports a change's recorded branches.
- `spec-frameworks`: the OpenSpec module reads the `spec-control:` map and supplies the record instruction.
- `agent-sessions`: Ship, Fast-forward and the archive auto-merge instruction carry the record instruction.

## Impact

- `src/server/frameworks/openspec/marker.ts`, `src/server/frameworks/openspec/index.ts`: read and validate the map;
  supply the record instruction text.
- `src/server/frameworks/framework.ts`: an optional `recordInstruction` and the neutral `recorded` field on
  `FrameworkChange`.
- `src/server/scanner.ts` (`findBranchMatch`), `src/server/mergeChanges.ts`: exact matching; carry `recorded` through
  the merge of copies.
- `src/shared/types.ts`: `ChangeRecord` and `recorded?` on `ChangeSnapshot`.
- `src/shared/pullRequestLink.ts`: the new link order; `src/ui/pullRequests.tsx`, `src/ui/pullRequestsState.ts`: pass
  `recorded` through the `Pick`s.
- `src/server/sessions/agents.ts`, `src/server/sessions/manager.ts`: append the record instruction to Ship, Fast-forward
  and the archive auto-merge instruction.
- `src/ui/helpContent.tsx`, `src/ui/changelog.ts`: help and What's new.
- Tests: `test/pullRequestLink.test.ts`, `test/scanner.test.ts`, `test/agents.test.ts`, a marker parsing test, and the
  fixtures they need (`test/fixtures/`, generated with made-up names).
- Follow-ups that build on the record: `resolve-pr-conflicts`, `stale-means-archived-and-merged`. `one-next-action-per-stage`
  does not depend on it.
