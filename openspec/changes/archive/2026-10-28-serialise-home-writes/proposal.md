# Proposal

## Why

Four writes into the dashboard home can lose or duplicate data, or start more GitHub queries than the specs allow,
when two of them meet.

- **A stale Settings tab undoes other writes.** Config writes are serialised (`updateConfig` in
  `src/server/config.ts`), but `PUT /api/config` (`putConfig`, `src/server/api.ts`) replaces the whole configuration
  with the client's body and keeps only `setup` from the server. Settings sends its draft with
  `withLatestRepos(draft, config)` (`src/ui/settings.tsx`), and `config` is the copy the page last received, not the
  saved one. A Settings tab opened before a clone was tracked (`confirmIntegration`), an Ignore on the overview or a
  label colour was chosen saves them away again. The setup wizard reads `GET /api/config` before each save, which
  narrows the window but does not close it. "Tracking endpoints" in `dashboard-api` promises that concurrent writes
  cannot undo each other; the serialisation alone does not deliver that when one writer works from an old copy.
- **The activity log can write an event twice.** `ActivityLog.append` (`src/server/activity/log.ts`) adds the events
  to `this.entries` at once and queues the file append. When the first queued job finds the file over 5 000 lines it
  compacts, writing `this.entries` — which already holds the events of appends queued behind it. Those jobs then
  append their events again. Reproduced: 5 000 events, then two appends without waiting in between, leaves the
  second event's id twice in the file (2 001 lines, one duplicate). The feed deduplicates nothing, so the event is
  shown twice after the next restart.
- **The pull-request watch is limited per tab, not per dashboard.** The board's watch (`watchPlan`/`armWatch`,
  `src/ui/pullRequestsState.ts`) waits a minute between its own refreshes and sends `{ repoIds, force: true }`. The
  server (`PullRequests.refresh`, `src/server/pullRequests.ts`) only joins a refresh that is still running; a `force`
  that arrives just after one ended queries again. Three visible tabs on boards of the same project start about three
  `gh pr list` rounds a minute for it. Invariant 4 and "The board watches pull requests that are not ready" mean at most
  one a minute per repository.
- **Concurrent cache writes share a temp file.** `PullRequests.persist` always writes `${path}.${pid}.tmp` and renames
  it. Two refreshes of different repositories that finish together write the same temp file, so one rename can move a
  file the other is still writing, and `pull-requests.json` is torn or loses one refresh's lists.

## What Changes

- **Config saves carry the revision they were based on.** Every response that returns the configuration carries its
  revision (an `ETag` derived from the saved content). `PUT /api/config` with an `If-Match` naming another revision is
  refused with `412` and the current configuration and revision, and nothing is written; without `If-Match` (a
  command-line client) it behaves as today. Settings and the setup wizard always send it.
- **Settings rebases instead of overwriting.** On `412` Settings applies the user's edits — every top-level setting
  that differs from the copy the draft was seeded from — onto the current configuration, with the repositories taken
  from the current one as today. When no setting the user edited was also changed elsewhere it saves that at once;
  otherwise it keeps the edits on screen over the newer values, says that settings were changed elsewhere, and saves
  only when the user saves again. The setup wizard recomputes its save from a fresh `GET /api/config` and retries once.
- **The activity log writes each event once.** Compaction writes the entries as they stood when its own job was
  queued, never events of appends queued after it, so each append job writes exactly its own events, whatever
  compacts in between.
- **Watch refreshes have a server-side minimum gap.** A refresh that names `repoIds` (the board's watch) leaves out
  every GitHub repository whose last query settled less than 60 seconds ago, `force` notwithstanding; a refresh the
  user started (Refresh, opening a view) is not limited by it.
- **Pull-request cache writes are serialised.** `persist` runs one write at a time, each from the cache as it is when it
  starts, so the last write holds every refresh's lists.

No new route, no new file in the home, no process, no network access; nothing outside `~/.spec-control/` is touched.

## Non-goals

- Field-level merging on the server: the server cannot tell which fields a client meant to change from a full config.
- Limiting a user's own Refresh: invariant 4 lets the user ask whenever they like.
- Locking across two dashboard processes on one home: the port already keeps a second instance from starting.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `dashboard-api`: `PUT /api/config` is refused with `412` when its `If-Match` names a revision other than the saved
  one; config responses carry their revision.
- `settings-page`: saving Settings never undoes a configuration change made elsewhere since the draft was seeded.
- `activity-feed`: compaction never writes an event that a later append writes again.
- `pull-requests`: a server-side minimum gap for watch refreshes; cache writes one at a time.

## Impact

- `src/server/config.ts`: a `configRevision(config)` helper.
- `src/server/api.ts`: `ETag` on every response that returns the config; the `If-Match` check in `putConfig`, inside
  the serialised write.
- `src/ui/api.ts`, `src/ui/demo/demoApi.ts`: `config()` and `saveConfig()` carry the revision; `saveConfig` reports a
  `412` with the current configuration.
- `src/ui/settings.tsx`: the draft's base revision and copy, the rebase on `412` (a pure `rebaseDraft` next to
  `withLatestRepos`).
- `src/ui/setupState.ts`, `src/ui/setupWizard.tsx`: send the revision of the fresh copy; recompute and retry once on
  `412`.
- `src/server/activity/log.ts`: compaction writes the entries captured when its job was queued.
- `src/server/pullRequests.ts`: the last query time per GitHub repository, the watch's minimum gap, and a serialised
  `persist`.
- Tests: `test/api.test.ts` (revision and `412`), `test/config.test.ts`, a new `test/settingsSave.test.ts`
  (`rebaseDraft`), `test/setupState.test.ts`, `test/activityLog.test.ts`, `test/pullRequests.test.ts`,
  `test/pullRequestsApi.test.ts`, `test/pullRequestsState.test.ts` (the watch still sends `repoIds`).
- Specs: `openspec/specs/dashboard-api/spec.md`, `openspec/specs/settings-page/spec.md`,
  `openspec/specs/activity-feed/spec.md`, `openspec/specs/pull-requests/spec.md`.

## Overlaps

- `start-editor-in-worktree` and `one-console-per-change` (in flight) change `src/server/api.ts` and `src/ui/api.ts`;
  `start-editor-in-worktree`, `add-validate-phase` and `manual-tasks-need-you` change `src/server/config.ts`. They add
  routes and config fields; this change touches `putConfig`, the config responses and a new helper, so the overlaps
  are textual. A new top-level config field is covered by the rebase without further work.
- `guard-all-api-requests` (proposed alongside) adds a check at the top of `createFetchHandler` in `src/server/api.ts`.
