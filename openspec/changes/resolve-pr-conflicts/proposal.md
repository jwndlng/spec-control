# Proposal

## Why

**Resolve conflicts** is offered only from one source: the local `merge-tree` check of a session worktree's work status.
Two common situations fall through it:

- **GitHub says the pull request conflicts, the dashboard offers nothing.** The card's pull-request badge already reads
  "Not ready: it conflicts with its base branch", but the action exists only on a session whose worktree reports a local
  conflict. When the local base is behind GitHub's (or the pull request targets another base), there is a visible
  problem and no way to act on it.
- **The session's worktree is gone.** After an end-session with worktree removal, or a cleanup, a pull request that later
  starts to conflict has no worktree, so no work status and no action. The only way out today is to start a fresh
  session, which works on the dashboard's `feat/<change>` branch — not necessarily the pull request's head branch — so
  the agent either pushes a second branch and opens a second pull request, or has to be told by hand to switch branches.
  Both are how a change ends up with the wrong pull request attached.

## What Changes

- **Two conflict signals, one action.** Resolve conflicts is offered when the local conflict signal of the change's
  session worktree says so, **or** when the change's linked open pull request has mergeability `conflicting` in the
  cached pull-request list. Each signal is shown with its source and freshness: the local one "as of your last fetch",
  GitHub's "as of the last pull-request refresh". The action never starts a `gh` query or a fetch itself.
- **Run where the pull request's branch is.** If a session worktree of the change is on the pull request's head branch,
  the prompt goes there, as today. If none exists, a session is started in a new worktree **on the pull request's head
  branch**: an existing local branch of that name is checked out as is; otherwise the branch is created from
  `origin/<head branch>`, tracking it. It is the same `git worktree add` sessions already run, with a different start
  point. Branch, pull request number and base come from the server's scan and pull-request cache, never from the request.
- **Refused when it would be wrong.** No Resolve conflicts for a pull request from a fork (one-line reason, nothing
  more), whose head branch is the default branch or is checked out in the main checkout, whose head branch is not known
  locally as `origin/<branch>` and has no local branch, when the change's existing worktree is on a different branch, or
  when a session for the change is running elsewhere.
- **A local fix not pushed yet is pointed out.** When the worktree's `HEAD` differs from the pull request's cached head
  commit, the action is still offered, with a "push pending" hint: GitHub may be reporting a conflict the worktree has
  already resolved.
- **The prompt names the pull request.** After the configured resolve-conflicts prompt, a fixed sentence names `#<n>`,
  its head branch and its base, so the agent resolves against the pull request's real base and pushes to the branch
  the pull request is already open on.
- **The pull-request list learns whether a head is in a fork** (`isCrossRepository`), one more field of the same
  `gh pr list`, used only to refuse.
- Unchanged: the dashboard merges, rebases, cherry-picks, checks out, commits and pushes nothing for this action.

## Dependencies and overlaps

- **Depends on `record-change-pull-request`.** That change records the branches a change works on
  (`spec-control: { branch, archive-branch }` in `.openspec.yaml`, written by the agent) — branches only, no pull
  request numbers — and makes linking find the pull request by the recorded branch first, then by today's exact
  candidates. "The change's linked pull request"
  here means that link. It also rewrites the requirement "A pull request is linked to a change by its head branch",
  whose last paragraph says the link may not affect a change's actions; once it has landed, this change adds the one
  exception (Resolve conflicts) to that paragraph — see tasks.
- **Overlaps `one-next-action-per-stage`.** That change makes the card show the pull-request-driven next step, of which
  Resolve conflicts is one. This change specifies the signal, the server action and the change detail; how the card
  presents it is that change's.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `agent-sessions`: Resolve conflicts takes either signal and can start a session on the pull request's head branch.
- `pull-requests`: the list says whether a head is in a fork; a conflicting linked pull request may decide whether Resolve
  conflicts is offered.
- `dashboard-api`: `POST /api/sessions` accepts `resolveConflicts: true`.

## Impact

- `src/server/pullRequests.ts`, `src/shared/types.ts`: `isCrossRepository` on `PullRequest`.
- `src/shared/conflictSignal.ts` (new): one pure rule combining the local and GitHub signals, used by server and UI.
- `src/server/sessions/manager.ts`, `src/server/sessions/worktree.ts`: start-on-head-branch path, refusals, re-checks.
- `src/server/sessions/agents.ts`, `src/shared/agentDefaults.ts` or `src/shared/types.ts`: the fixed pull-request
  sentence appended to the resolve-conflicts prompt.
- `src/server/api.ts`: `resolveConflicts` on `POST /api/sessions`.
- `src/ui/changeDetail.tsx`, `src/ui/sessionPanel.tsx`, `src/ui/api.ts`: the action and its freshness wording.
- `src/ui/helpContent.tsx`, `src/ui/changelog.ts`: help and What's new.
- Tests: `test/conflictSignal.test.ts`, session tests with the fake agent and fake `gh`, API refusal tests.
