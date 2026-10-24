# Design

## Context

`SessionManager.resolveConflicts(id)` re-reads the session worktree's work status and refuses unless `work.conflicts` is
set. That signal comes from `merge-tree` against `origin/HEAD` as of the last fetch (`workStatus.ts`). The pull-request
cache already carries GitHub's mergeability per pull request and `pullRequestReadiness.ts` turns `conflicting` into the
`conflicts` reason — but only for display: the pull-requests spec forbids readiness and the link from affecting actions.
Sessions create their worktree with `ensureWorktree(repoPath, path, branch)`: an existing local branch is checked out,
otherwise `git worktree add -b <branch> <path> <origin/HEAD>`. `record-change-pull-request` (in flight) gives every
change a link found by its recorded branch (`spec-control.branch` / `archive-branch` in `.openspec.yaml`, branches
only), then by the exact candidate branches.

## Goals / Non-Goals

**Goals:** offer Resolve conflicts whenever either source says the change's work conflicts; run the agent on the branch
the pull request is open on, so its push updates that pull request; keep every write within the existing enumeration.

**Non-Goals:** no automatic resolution, no fetch or `gh` query started by the action, no rebase/merge/push by the
dashboard, no support for fork pull requests, no change to how the card presents the action (owned by
`one-next-action-per-stage`).

## Decisions

### D1 One rule combines the two signals

`src/shared/conflictSignal.ts` exports `conflictSignal(worktree?, pr?)` → `{ local?: { base, files, asOfFetch: true },
github?: { number, base, at } }` or undefined. `local` comes from the work status of the change's worktree on the pull
request's head branch (or of its only session worktree when there is no pull request); `github` from the linked pull
request when it is `open` (drafts included) and `mergeable === "conflicting"`, with `at` the list's
`fetchedAt`, and `pushPending: true` when the change's worktree on the head branch exists and its `HEAD` (read-only
`rev-parse`) differs from the pull request's cached head commit. Either one present means the action is offered; both are shown when both exist. The UI and the server use
the same function, so the button and the refusal never disagree.

Considered: GitHub only (loses the in-worktree case before a push) and local only (today; misses what the badge shows).
When they disagree, both are shown with their freshness and the action is still offered: the agent finds out which is
current, and a false offer costs one prompt while a missing one costs a stuck pull request. The same reasoning holds for
`pushPending`: the action stays offered, and the GitHub signal reads "GitHub reports conflicts with `<base>` — push
pending: this worktree has commits GitHub has not seen", because the local fix may simply not be pushed yet.

### D2 The session runs on the pull request's head branch

Start path, decided read-only before anything is created:

1. If a session for the change is **running**: its worktree's branch must equal the head branch (or, without a pull
   request, any branch); the prompt is submitted there, as today. Otherwise refused, naming the session and its branch.
2. If a session worktree directory of the change exists: same branch check; the agent is resumed there with the prompt
   (today's ended-session path, same record). A worktree on another branch is refused, naming it — the user removes it
   or works there.
3. Otherwise a new session record is created whose action is `archive` when the head branch is the change's archive
   branch (its recorded `archive-branch` or `chore/archive-<name>`) and `implement` otherwise, so the worktree directory
   (`archive-<change>` / `<change>`) and the work-status bookkeeping stay as they are. `ensureWorktree` gets a start
   point parameter:
   - local branch `<head>` exists → `git worktree add <path> <head>` (today's path). A local branch behind or diverged
     from `origin/<head>` is used as is; the fixed sentence (D3) tells the agent to bring it level with
     `origin/<head>` first. Refusing instead was rejected: the local branch may hold the only copy of unpushed work, and
     checking it out loses nothing.
   - else `refs/remotes/origin/<head>` exists → `git worktree add --track -b <head> <path> origin/<head>`.
   - else refused: "the branch is not known locally — fetch or pull first". The dashboard does not fetch for it.
   - `<head>` checked out in the main checkout → refused (the main checkout's branch is never changed, and git refuses
     a second checkout). Checked out in another linked worktree with no session running → adopted, as the existing
     adoption rule does for `feat/<change>`.

`--track` writes `branch.<head>.remote`/`.merge` into the repository's config. Today's session branches already get the
same two keys from git's default `branch.autoSetupMerge` (their start point `origin/HEAD` is a remote-tracking ref), so
this is part of "creating a git worktree and its branch for a session" in the never-writes enumeration — no new entry,
no new subcommand. It is spelled out so work status reads `pushed`/`unpushed` against the pull request's branch rather
than counting every commit the base lacks, and so the agent's plain `git push` updates the pull request.

The head branch, number, base and `isCrossRepository` come from the server's own cached list via the shared link rule;
the request carries only `{ repoId, change, resolveConflicts: true }`. The branch is re-validated with `isBranchName`
before any git call, and must not be the default branch.

Rejected: start a fresh `feat/<change>` session and let the agent check out the pull request's branch. The fresh branch
is created first, the agent may push it, and the change then has two branches and possibly two pull requests — the
mis-tracking `record-change-pull-request` exists to stop.

### D3 The prompt names the pull request

`resolveConflictsPrompt(agent, change, pr?)` appends, after the composed prompt and its additional instructions, a fixed
sentence built only from the server's list: "Its pull request is #<n> from <head> into <base>. If this branch is behind
origin/<head>, bring it level first, then resolve against <base> and push to <head>." Number and branch names are
re-validated before they reach the text. Without a pull request the prompt is unchanged. The sentence is not
configurable, like Merge's `mergeTargetSentence`.

### D4 Fork pull requests are refused, minimally

The projects this is used with do not take pull requests from forks, so the only requirement is not to act on the wrong
branch when one appears: a fork's `headRefName` (often `main` or `feat/<name>`) can coincide with a branch of `origin`.
The request is refused with one line — "its branch is in a fork" — and nothing else is added: no hint, no separate
display. `gh pr list --json` gains `isCrossRepository` for it: one more field on a call that already runs, a boolean, no
false refusals. Considered instead: refusing unless the cached head commit is reachable from the local or
remote-tracking branch (read-only `rev-list`, no new field). Rejected because it also refuses a legitimate pull request
whenever the last fetch predates its latest push, and needs more logic than a field. A cached entry without the field is
treated as from a fork for starting a new worktree only — refusing is the safe default until the next refresh — and does
not affect the existing-worktree paths.

### D5 Freshness is said, never hidden

The detail shows "Conflicts with `<base>` — as of your last fetch" for the local signal (pointing at Pull, as today) and
"GitHub reports conflicts with `<base>` — as of <relative time of the last pull-request refresh>" for GitHub's. The
action itself triggers neither a fetch nor a query; the automatic fetch and the board's pull-request watch are what keep
both fresh.

## Risks / Trade-offs

- [Stale GitHub cache after the agent already pushed a fix] → the action is offered once more until the next refresh;
  the watch refreshes not-ready pull requests every minute while mergeability is unknown, five minutes otherwise.
- [Local branch diverged from the remote] → checked out as is; the prompt tells the agent to reconcile first. Nothing is
  lost, and the agent's own permission prompts govern any force push.
- [A pull request whose base is not the default branch] → the local signal compares with `origin/HEAD` and may say
  nothing; GitHub's signal and the prompt's named base cover it.
- [`--track` config keys] → the same keys today's session branches already get; removed with the branch by cleanup's
  `git branch -D`.

## Migration Plan

None. Old caches lack `isCrossRepository` and are treated per D4 until the next refresh.

## Open Questions

None.
