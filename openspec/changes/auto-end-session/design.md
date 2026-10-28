# Design

## Context

`SessionManager.endMergedAutoMerge` (`src/server/sessions/manager.ts`) already ends a session and removes its
worktree when a completed pull-request query lists its branch's pull request merged. `src/server/api.ts` calls it
after every completed query for a repository. It only considers sessions with `autoMergeAskedAt` in a project with
`agent.autoMergeDocs`, anchors on `autoMergeAskedAt`, and uses `close(id, { removeWorktree: true })`, whose checks are
the end-session dialog's. The outcome lives in `session.autoEnded` and is shown by `autoEndedText` / `sessionBadge`
(`src/ui/sessionState.ts`) and reported as a `session-auto-ended` activity event. Resuming goes through `restart`,
which re-creates a missing worktree with `ensureWorktree` on the kept branch, but does not clear `autoEnded`.

## Goals / Non-Goals

**Goals:**
- One code path for both rules, so the two never end the same session twice or disagree about the outcome.
- Never end an agent that is still doing work the merged pull request does not contain.
- No new process, timer, query, network access or writing git command.

**Non-Goals:**
- Running the stale cleanup, deleting a branch or pulling after an automatic end — those keep their confirmations.
- A per-project switch; one global setting is enough for a behaviour that only removes what can be re-created.
- Changing the docs auto-merge rule's own conditions (it still ends the agent even with uncommitted files).

## Decisions

**D1 — Generalise `endMergedAutoMerge` rather than add a second pass.** Rename it `endMergedSessions(repoId, prs)`.
Per session it picks the rule: the auto-merge rule when the session carries `autoMergeAskedAt` and the project has
`autoMergeDocs` (unchanged anchor and conditions), else the general rule when `endMergedSessions !== false`. The
shared pieces — the `autoEnding` guard, the fork/base filter with one `defaultBranch` read per call, `close` with
`removeWorktree: true`, recording `autoEnded`, the activity event — stay as they are. Alternative: a separate method
called beside it; rejected because both would race over the same session and the same `autoEnding` set.

**D2 — Anchor on the agent's last start (`agentStartedAt`).** Set in `start()` (covers open, resume, Ship/Resolve
restart) and persisted; a record without it reads `createdAt`. `createdAt` alone would let a pull request that merged
before a resume end the resumed session; `autoMergeAskedAt` does not exist for most sessions.

**D3 — "Nothing would be lost" is checked before ending, from read-only git.** Before calling `close`, the general
rule reads the worktree's `HEAD` (`git rev-parse HEAD`) and work status (`readWorkStatus`, already used): it proceeds
only when the status is not `uncommitted` and either `HEAD === pr.headOid` or the status is `merged`. A pull request
without `headOid` can only pass through `merged`. When the check fails nothing is recorded, so the next query
re-checks; that costs one or two read-only git calls per candidate per completed query, bounded by the watch's
once-a-minute cap. Alternative: end the agent and only keep the worktree (the auto-merge rule's behaviour); rejected
because without the docs auto-merge opt-in the user may still be working in that session.

**D4 — Starting clears `autoEnded`.** `start()` clears `autoEnded` together with setting `agentStartedAt`, so the
notice disappears on resume and D2 keeps the old pull request from matching again. The candidate filter's
`!session.autoEnded` stays as the at-most-once guard between starts.

**D5 — Setting lives in `agentSessions`, defaults on.** `endMergedSessions?: boolean` beside `confirmFastForward`,
validated in `src/server/config.ts`, written only as `false` (absent = on), edited by a checkbox in the Agent sessions
section of Settings and saved with `PUT /api/config`. Default on follows the auto-fetch precedent: the setting the user
can switch off is the confirmation, and what it removes is re-created by Resume.

**D6 — Wording.** `autoEndedText` keeps "ended because #N merged"; nothing in it mentioned auto-merge, so both rules
share it. The Docs auto-merge tooltip is unchanged.

## Risks / Trade-offs

- [The user is mid-review in the session's terminal when the pull request merges] → the agent is only ended when the
  worktree is clean and on the merged head; the conversation is resumable and the worktree is re-created on Resume.
- [Squash merge with the remote branch deleted and not fetched] → `HEAD === headOid` proves it without a fetch;
  `merged` covers the fetched case.
- [A stale `pullRequests` cache read after a resume] → only completed queries trigger it, and D2 compares merge time
  with the latest start.
- [Default on surprises an existing user] → a What's new entry names the setting and where to switch it off.

## Migration Plan

No data migration: absent `endMergedSessions` means on, absent `agentStartedAt` reads `createdAt`. Rolling back to an
older binary ignores both fields.
