# Proposal

## Why

Once a session's pull request has merged — an Archive pull request in particular — the session has nothing left to
do, yet today the user has to notice the merge, open the session and confirm **End session** to stop the agent and
remove its worktree. The dashboard already does exactly this on its own, but only for a session whose prompt carried
the docs auto-merge instruction in a project with Docs auto-merge on. Every other merged session keeps an idle agent
and a worktree around until the user tidies up by hand, and since an ended session can always be resumed (its branch
is kept and its worktree re-created), ending it after the merge costs nothing that cannot be undone.

## What Changes

- A change session whose own pull request is listed merged — head branch is the session's branch, same repository,
  into the default branch, merged after the session's agent was last started — is ended by the dashboard without a
  dialog when a pull-request query completes, whether or not docs auto-merge was involved, and its worktree is removed
  by a non-forcing `git worktree remove` under the existing "Worktree clean-up is offered only when safe" checks. The
  branch is kept for repository cleanup.
- Because the agent may still be working, the general rule is stricter than the auto-merge one: it acts only when the
  session's worktree holds no uncommitted change and its checked-out commit is the merged pull request's head commit
  (or its work status is `merged`). A session that has moved on is left running and untouched.
- It is decided only from a pull-request query that already ran (the user's refresh, a view that shows pull requests,
  or the board's pull-request watch) and read-only git: no new query, timer, `gh` subcommand, fetch or ref deletion.
- A new global setting in Settings → Agent sessions, **End sessions whose pull request merged**
  (`agentSessions.endMergedSessions`), on unless switched off — the setting is the confirmation, as the auto-fetch
  setting is for the automatic fetch. Switched off, only the existing docs auto-merge behaviour remains.
- A session records when its agent was last started (started, resumed or restarted). Resuming a session the dashboard
  ended clears that outcome, so the resumed session can be ended again by a later merge, and never by the one it was
  ended for.
- The panel, card and activity event already used for an auto-merge end are reused, naming the pull request; for an
  archive session whose change is then stale, the board's **Clean up leftovers…** stays the user's step.
- Nothing is ended or removed in the demo, for an in-place session, an adopted worktree or a changeless session.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agent-sessions`: a merged pull request ends any eligible session, not only one carrying the auto-merge record; the
  new setting; the agent's last start time; resuming clears an automatic end; worktree removal rules name the new
  automatic case.
- `dashboard-api`: the "never writes" requirement admits the automatic worktree removal for this setting, and
  `PUT /api/config` accepts `agentSessions.endMergedSessions`.
- `activity-feed`: the auto-ended session event covers a session ended because its pull request merged, whatever
  started the pull request.

## Impact

- `src/server/sessions/manager.ts` (`endMergedAutoMerge` generalised; recording the agent's start time; clearing
  `autoEnded` on start), `src/server/api.ts` (calls it after every completed query, as today), `src/server/config.ts`
  (validating the new setting), `src/shared/types.ts` (`agentStartedAt`, `endMergedSessions`).
- `src/ui/settings*` (the switch in Agent sessions), `src/ui/sessionState.ts` (wording of the ended notice when no
  auto-merge was involved), `src/ui/changelog.ts`.
- `CLAUDE.md` invariant 1 (the automatic removal is no longer tied to Docs auto-merge).
- Tests: `test/` session manager tests with `fake-gh` scenarios, config validation, settings UI state.
