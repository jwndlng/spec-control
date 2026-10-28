# Design

## Context

`scanChange` sets `branchMatch` per copy: the main checkout's copy runs `findBranchMatch` (main's branch, then the first
linked worktree, when exactly a candidate), a linked worktree's copy simply takes the worktree's branch. `mergeChanges`
then re-applies the same rule to the leading copy. The leading copy is the one furthest along (`compareCopies`), so when
the main checkout lags behind `origin/main`, a fresh worktree for any other change holds a copy that is ahead of main's
and leads — and brings its branch along.

## Decisions

### D1. Two tests, either suffices

A linked worktree's branch is the change's when it is exactly a branch candidate (the dashboard's own session branches or
what the agent recorded), or when the worktree holds work on the change. The first covers every branch the dashboard
creates, without git; the second covers branches named off-convention by hand (`wip/compliance` in the existing scenario),
which are only right when that branch actually did something to the change.

Rejected: comparing the worktree's copy with the main checkout's copy. The main checkout is exactly what lags in the
reproduction, so its copy differs from every fresh worktree's; that would keep the bug.

### D2. "Holds work" is read from git against the base the work status already uses

Uncommitted files come from the worktree's `dirty` list the scanner already reads for that worktree, filtered to the
change's directory. Committed work is one `git diff --name-only -z <base>...HEAD -- <changes dir>` per scanned worktree
(three dots: since the fork), answering for every change in that worktree at once; `<base>` is `baseRef` from
`src/server/sessions/base.ts` (`origin/HEAD`, else the main checkout's `HEAD`). Comparing from the fork point, not from the
base's tip, means a base that moved on after the branch was cut does not make every carried change look worked on.

Rejected: comparing with the base's tip (`git diff <base> HEAD`). Once the base moved on, every change it touched since
the fork would look worked on in every older worktree — the same false match, the other way round.

### D3. When the question cannot be answered, there is no match

No base (a repository without commits on either side), a failing `diff`, a timeout: the worktree is taken to hold no work,
and the change falls back to `findBranchMatch`. A missing badge is recoverable from the recorded and session branches; a
wrong one links another change's pull request.

### D4. The scanner decides, `mergeChanges` stops overriding

`mergeChanges` takes `lead.change.branchMatch` as is. Keeping the override would reintroduce the bug for every lead in a
worktree, and two rules for one field were how the spec text and the code drifted into agreeing on it.
