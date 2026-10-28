# Reliable rescans and a clean shutdown

## Why

Four places promise something the code does not keep when two things happen close together.

- **A rescan that is asked for during a scan is lost.** `Scanner.trigger()` returns the scan already in flight instead
  of queuing another, and that scan read the configuration and the repositories when it started. Every caller that
  promises a rescan — a configuration change that enables or adds a repository, a confirmed integration, create-change,
  dismissal, pull, cleanup, applying a shared config profile, and the automatic fetch moving a ref — silently gets a
  result from before its own change, and the board stays stale until the next poll, which can be an hour away
  (`pollIntervalSeconds`). Reproduced: enabling `beta-soc` while `demo-ops` was being scanned left a snapshot holding
  only `demo-ops`.
- **Stopping the dashboard can leave an agent running.** `SessionManager.shutdown` calls `proc.kill()` — a hang-up
  plus a two-second `SIGKILL` timer in `terminal.ts` — marks the sessions ended without waiting for `exited`, and
  `index.ts` then calls `process.exit(0)`, so the timer never fires. An agent that ignores the hang-up survives,
  reparented to PID 1, while its record says ended: the next start does not mark it interrupted, and **Resume** starts a
  second agent in the same worktree. `agent-sessions` requires "hang-up, then a forced kill" and that stopping the
  dashboard ends every agent.
- **Stopping the dashboard loses the session-ended events.** `end()` reports them through `onActivity`, whose
  `activity.append` nobody awaits; shutdown awaits only the session store before `process.exit(0)`. Reproduced: no
  `activity.jsonl` line was written for sessions ended by a stop.
- **An interrupted home migration is never finished.** `homeMigration.ts` writes `migration.json` only after the rename
  and every later step (the link at the old path, the rewrites of `config.json` and session records, `git worktree
  repair` of each session worktree). Interrupted after the rename — `Ctrl+C` before the dashboard has a signal handler,
  or the desktop app stopping it — the next start finds the new home without a record and does nothing: no link, stale
  paths in session records, worktree records in the repositories still naming the old path, which repository cleanup's
  `git worktree prune` later deletes. `dashboard-api` ("The home moves once from its old name") requires failed steps
  to be retried on the next start. (Found by reading the code; not reproduced.)

## What Changes

- **A trigger during a scan queues exactly one follow-up scan.** The scanner keeps a "dirty" flag: a trigger while a
  scan runs sets it and returns the follow-up's promise; when the running scan finishes, one more scan starts and reads
  the configuration and repositories afresh. Any number of triggers during one scan collapse into that one follow-up,
  and two scans still never run at once. `POST /api/scan` keeps its shape: `{ started: false }` now also means a
  follow-up is queued that will see everything done before the request. The UI's create loops (single and from issues)
  that kept asking until a scan started need only one request.
- **Shutdown waits for every agent, then forces the rest.** `shutdown` sends each running agent the hang-up, waits for
  its `exited` up to the existing grace period, sends `SIGKILL` to every survivor and waits a short bounded time again,
  and only then records the sessions as ended and lets the process exit. The whole wait stays well inside the ten
  seconds the desktop app allows before it kills the server.
- **Shutdown waits for the activity log.** `ActivityLog` gains `idle()`, resolving once every queued write has finished
  or failed; the shutdown in `index.ts` awaits it after the sessions have ended and before `process.exit`.
- **The migration record is written right after the rename.** `migrateHome` writes `migration.json` with every step it
  is about to run listed as pending immediately after the rename succeeds, and rewrites the record after each step, so a
  start that finds the record with steps pending resumes exactly where the interrupted one stopped. Every step is
  already safe to run twice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-scanner`: the trigger during a scan queues one follow-up scan instead of being absorbed.
- `dashboard-api`: `POST /api/scan` while a scan runs queues the follow-up; an interrupted home migration resumes.
- `agent-sessions`: stopping the dashboard waits for every agent to exit and forces those that do not.
- `activity-feed`: events recorded while the dashboard stops reach the log before it exits.

## Impact

- `src/server/scanner.ts`: `Scanner.trigger()` with the dirty flag and the follow-up promise.
- `src/ui/newChangeForm.tsx` (`createInRepos`), `src/ui/importIssuesState.ts`: one scan request after the creates
  instead of a retry loop.
- `src/server/sessions/terminal.ts`: `kill()` exposes the forced kill (or a `forceKill`) so the manager can force a
  survivor without relying on the unref'd timer; `KILL_GRACE_MS` reused.
- `src/server/sessions/manager.ts`: `shutdown()` awaits each agent's `exited` with a bound, forces the survivors, then
  ends the sessions.
- `src/server/activity/log.ts`: `idle()`.
- `src/server/index.ts`: the shutdown awaits the sessions, then `activity.idle()`, then exits.
- `src/server/homeMigration.ts`: the record written right after the rename and after each step; a `cache` step kind
  for the dropped snapshot so it is recorded too.
- `src/server/environment.ts`: the `dashboard-home` check says when this start finished, or still has steps left of, a
  migration an earlier start was stopped in.
- Tests: `test/scanner.test.ts`, `test/api.test.ts` (scan endpoint), `test/newChangeByLabel.test.ts`
  (`createInRepos`), `test/importIssuesState.test.ts`, `test/terminalSessions.test.ts` (with
  `test/fixtures/fake-agent.ts` taught to ignore `SIGHUP` on request), `test/activityLog.test.ts`,
  `test/homeMigration.test.ts`, `test/startupMigration.test.ts`, `test/environment.test.ts`, and `test/shutdown.test.ts`
  (the CLI stopped with `SIGTERM` while a session runs).
- Specs: `openspec/specs/change-scanner/spec.md`, `openspec/specs/dashboard-api/spec.md`,
  `openspec/specs/agent-sessions/spec.md`, `openspec/specs/activity-feed/spec.md`.
- No new dependency, no network, no new git subcommand, no write outside the home; invariant 1 and CLAUDE.md
  unchanged.

## Overlaps

- `serialise-home-writes` (PR #359, in flight) changes `src/server/activity/log.ts` (compaction captures the entries of
  its job) and `src/server/api.ts`; `idle()` here is a new method next to its changes and waits on the same queue, so
  the overlap is textual. It also adds an `activity-feed` requirement ("Each recorded event is written to the log
  once"); the requirement added here is separate.
- `contain-repository-reads` (PR #371, in flight) changes `src/server/scanner.ts` (reads in `scanRepo`) and
  `src/server/api.ts`, and the `change-scanner` and `dashboard-api` specs; this change touches only the `Scanner`
  class's `trigger`, so the overlap is textual.
- `harden-session-lifecycle` (in flight, branch `feat/harden-session-lifecycle`) changes
  `src/server/sessions/manager.ts` and `test/terminalSessions.test.ts`, and adds `agent-sessions` requirements; it
  does not touch `shutdown` or "Session lifecycle and control", so the overlap is textual. Whichever lands second
  rebases.
