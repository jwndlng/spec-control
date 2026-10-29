# Proposal

## Why

A change's `branchMatch` decides which pull request its card links, which step the split button recommends and which
branch **Resolve conflicts** starts a session on. Today every copy of a change found in a linked worktree gives the change
that worktree's branch (`scanner.ts`, `branchMatch: … ctx.isMain ? findBranchMatch(…) : ctx.branch`, and again in
`mergeChanges.ts`, `lead.checkout.isMain ? … : lead.checkout.branch`). But a worktree's branch belongs only to the change
it was made for; every other change in it is just carried along from the commit the branch was cut from.

Reproduced: the main checkout of `demo-ops` was not pulled. Change `rotate-keys` is `Implementing` there and `Done` on
`origin/main`; its merged pull request `#10` is on `feat/rotate-keys`, it records no branch, and its worktree is gone. A
session for `add-login` creates `feat/add-login` from `origin/main`. Now the furthest-along copy of `rotate-keys` is the
one in the `add-login` worktree, so `rotate-keys` gets `branchMatch: feat/add-login`, its candidate branches include
`add-login`'s branch, and the link picks `add-login`'s open `#20` over the merged `#10` (open beats merged). If `#20`
conflicts, `rotate-keys` recommends **Resolve conflicts**, and starting it would run a `rotate-keys` session on
`feat/add-login`. The `pull-requests` capability links by head branch precisely so that another change's pull request is
never shown; the `change-scanner` text ("A change whose leading copy was found in a linked worktree SHALL get
`branchMatch` set to that worktree's branch") mandates the bug.

## What Changes

- **A worktree's branch is a change's only when it is its own.** A change whose leading copy is in a linked worktree gets
  that worktree's branch only when the branch is one of the change's branch candidates (recorded implementation or archive
  branch, `feat/<name>`, `chore/archive-<name>` — the test `findBranchMatch` already makes), or when the worktree holds
  work on the change: uncommitted files in its directory, or a file in its directory that differs between the worktree's
  `HEAD` and where `HEAD` forked from the base (`origin/HEAD`, else the main checkout's `HEAD` — the same base work status
  uses). Otherwise the change is matched like any other: the main checkout's branch or a linked worktree's branch when it
  is exactly a candidate, else none.
- **One place decides.** `mergeChanges` takes the leading copy's `branchMatch` as the scanner computed it instead of
  overriding it with the copy's checkout branch.
- **The link follows.** `pull-requests` gains a requirement that a carried copy never links another change's pull
  request; the link rule itself is unchanged.
- No new git subcommand (`diff` and `status` are already read-only ones the scanner uses), no network, no write.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `change-scanner`: "Branch and worktree matching" — a linked worktree's branch only for its own change or for a change it
  holds work on.
- `pull-requests`: a carried copy never links another change's pull request.

## Impact

- `src/server/scanner.ts`: `branchMatch` for a worktree copy — candidate test, else the work test, else `findBranchMatch`
  across all checkouts; one `diff --name-only <base>...HEAD -- <changes dir>` per scanned worktree, with the worktree's
  `dirty` list it already reads.
- `src/server/mergeChanges.ts`: use the leading copy's `branchMatch`; drop the comment that a worktree copy is always on
  that worktree's branch.
- `src/server/source.ts` (and the `RepoSource` interface, plus any test double of it): a read-only "change directories
  touched since the fork from the base" query; `src/server/sessions/base.ts` `baseRef` reused, not duplicated.
- `src/ui/changelog.ts`: a What's new entry.
- Tests: `test/worktreeScan.test.ts` (real temp git repositories: the reproduction, uncommitted work, committed work, a
  carried copy with the change's own worktree elsewhere), `test/mergeChanges.test.ts` (lead in a worktree without a match),
  `test/pullRequestLink.test.ts` and `test/conflictActionState.test.ts` (the reproduction's link and Resolve conflicts).
- Specs: `openspec/specs/change-scanner/spec.md`, `openspec/specs/pull-requests/spec.md`.
- No CLAUDE.md change: no invariant's wording depends on this.

## Overlaps

- `contain-repository-reads` (PR #371, `feat/contain-repository-reads`) changes `src/server/scanner.ts`,
  `src/server/source.ts` and `test/scanner.test.ts` (bounded reads) and modifies other `change-scanner` requirements; the
  overlap is textual, in different functions. Land either first.
- `add-validate-phase` modifies `change-scanner`'s "Task progress is derived from tasks.md", not this requirement.
- `serialise-home-writes` (PR #359) adds `pull-requests` requirements about the cache, not about linking.
- `accurate-activity-events` (proposed alongside) touches `src/server/scanner.ts`'s `scanWorktrees` (a flag for unread
  worktrees) — a neighbouring function of the same file.
