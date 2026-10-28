# Design

## Context

`Scanner` holds one `inFlight` promise. `trigger()` returns it unchanged when it is set, and `scanAll()` reads
`getConfig()` and the enabled repositories once, at its start. Ten callers in `api.ts`, `integration.ts` and `index.ts`
call `trigger()` after a write and expect the next snapshot to show it.

`SessionManager.shutdown()` calls the terminal's `kill()` (hang-up, then a `SIGKILL` on an unref'd two-second timer) and
then `end()` without awaiting `exited`; `index.ts` calls `process.exit(0)` as soon as `shutdown()` and the session store
are done. `end()` reports activity through `onActivity`, which appends to the activity log without awaiting it.

`migrateHome()` renames the old home, runs its steps and writes `migration.json` only at the end. On a later start a
new home without a record is "nothing to do".

## Decisions

### D1. One follow-up scan, never a queue

`trigger()` while a scan runs sets `dirty` and returns `{ started: false, done: followUp }`, where `followUp` is one
shared promise for the scan that will start when the current one settles. When `inFlight` settles and `dirty` is set,
the scanner clears `dirty` and starts that scan, which calls `getConfig()` afresh. Triggers during the follow-up set
`dirty` again and get the next one. So at most one scan runs and at most one is pending, however many triggers arrive.

The follow-up starts whether the running scan succeeded or failed, and also after `stop()` — `stop()` ends the
schedule, not a promise someone awaits; at shutdown the process exits regardless.

Rejected: aborting the running scan and starting over. A steady stream of triggers (a user creating many changes) would
then never finish a scan. Rejected: rescanning only the repositories a caller named. It needs every caller to say which,
and the enabled set is exactly what changes in the reproduced case.

### D2. The scan endpoint keeps its answer

`POST /api/scan` still answers `{ started: true }` when it started a scan and `{ started: false }` when one was running;
the latter now also queues the follow-up. The Refresh button's wait (`performRefresh`) is unchanged. `createInRepos` and
the issue import kept asking until `started` was `true` only to get a scan that began after their creates; one request
now guarantees that, so the loops become a single call. Leaving them would still work but would chain a follow-up per
attempt.

### D3. A bounded wait for the agents, then a forced kill

`shutdown()` first sends every running agent the hang-up and detaches its exit handler (as today, so the recorded
reason is the dashboard's). It then waits for all `exited` promises, each bounded by `KILL_GRACE_MS` (2 s); every agent
still alive gets `SIGKILL`, followed by a second bounded wait of one second. Only then does it end the sessions with the
reason "the dashboard was stopped". An agent still alive after `SIGKILL` (for example in uninterruptible sleep) is named
with its pid on standard error; its session is still recorded as ended, since the dashboard can do no more.

The terminal exposes the forced kill directly (`forceKill()`), so the manager does not depend on the unref'd timer
firing before `process.exit`. The worst case is about three seconds, well inside the ten the desktop app's `stopServer`
allows before it sends `SIGKILL` to the server.

Rejected: recording the sessions as `interrupted`-on-start instead. A survivor that the record calls ended is the bug;
the fix is that there is no survivor.

### D4. `ActivityLog.idle()`

`idle()` returns the log's write queue, which `enqueue` already keeps and which never rejects. `index.ts` awaits, in
this order: `sessions.shutdown()` (which awaits every `end()`, and so every `onActivity` call has queued its append),
then `activity.idle()`, then exits. Appends queued by a scan that finishes during shutdown are covered the same way.
`serialise-home-writes` keeps the queue and changes only what compaction writes, so `idle()` works with either version.

### D5. The migration record before the first step

Right after the rename, `migrateHome` writes `migration.json` with `from`, `to` and the full list of steps it will run
as pending, each with `error: "not yet attempted"`; after each step it rewrites the record with that step removed or
replaced by its failure. The retry path already runs whatever the record lists, and every step is idempotent: the link
step leaves anything at the old path alone, a rewrite of a file that no longer holds an old path writes nothing, and
`git worktree repair` of an already repaired worktree changes nothing. Dropping the cached snapshot becomes a recorded
step (`kind: "cache"`) too, so an interrupted run does not leave a snapshot naming old paths.

The record is written with the same atomic temp-and-rename as today. If that first record write fails, the migration
goes on as today and reports it, since the rename cannot be undone.

The window that remains — between the rename and the first record write — is one `writeFile` and one `rename`.
Closing it fully would need the record written into the old home before the rename; that would write into the old
home for a migration that may then be refused, so it is not done.

## Risks / Trade-offs

- A shutdown now takes up to about three seconds when an agent ignores the hang-up, where it used to exit at once and
  leave the agent behind.
- A burst of triggers costs one extra full scan after the running one; repositories are scanned with bounded
  concurrency and the per-repository timeout as before.
