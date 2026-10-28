# Proposal

## Why

The UI can act on, or show, something other than what the user last saw:

- **Apply can write a file the preview never showed.** In the shared-config panel (`src/ui/sharedConfig.tsx`),
  `pending = pendingAssignments(rows, profiles)` is recomputed on every render from the live snapshot. **Preview**
  sends the pending list of that moment; the dialog's **Apply** sends whatever is pending at the click. A poll while
  the dialog is open that turns another repository's carried section `outdated` — or tracks a new repository — adds it:
  the preview listed `[alpha-infra]`, Apply sends `[demo-ops, alpha-infra]`, and `demo-ops`'s `openspec/config.yaml` is
  written without its diff ever being shown. The server's `applyTo` (`src/server/sharedConfig.ts`) re-reads the file,
  which is right, but writes whatever it computes for the assignments it is given, so a file edited, or a profile saved
  in another tab, after the preview is also written unseen. That breaks `shared-config`'s "Apply is explicit, per
  repository, and previewed" and is one of invariant 1's enumerated writes.
- **The activity feed can show an answer to an old request.** `load()` in `src/ui/activity.tsx` runs on every filter
  change and every new snapshot with no cancellation, so a slower earlier response overwrites a newer one — the feed
  shows all repositories while the filter says `demo-ops` — and reports that answer's newest entry as seen. **Load
  older** appends its page to whichever list is shown when it arrives, possibly another filter's.
- **The board can step back to an older scan.** `loadState` in `src/ui/app.tsx` (initial load and the poll) and the
  refresh's `onSnapshot` set the snapshot without comparing `generatedAt`; a poll that was in flight when the user
  pressed Refresh can restore the pre-refresh board for a poll interval.

## What Changes

- **The preview is frozen.** The dialog keeps the assignments it was produced for and Apply sends exactly those.
  Changing the selection needs a new preview.
- **The server refuses what the user did not see.** The preview returns a server-computed `digest` of each
  repository's current text and result; Apply sends it back, and the server writes a repository only when the digest of
  what it reads and computes now matches. Otherwise that repository is `refused` ("changed since the preview"), and the
  others are applied independently as today.
- **The feed takes only its latest answer**, with a request sequence number as `githubState.ts` already does: a
  superseded answer, a late **Load older** page and their newest entry are dropped.
- **The board never takes an older snapshot**: a snapshot whose `generatedAt` is earlier than the shown one is
  discarded, on every path that sets it.

## Non-goals

- Locking `openspec/config.yaml` between preview and apply, or merging an edit made in between: a changed file is
  refused and the user previews again.
- Sending file text from the browser: the server still computes everything it writes.
- Cancelling the fetches themselves (`AbortController`): dropping a late answer is enough.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `shared-config`: Apply writes exactly what was previewed.
- `dashboard-api`: "Shared config endpoints" — `digest` in the preview and the apply body.
- `activity-feed`: the feed shows the answer to its latest request.
- `kanban-board`: an older snapshot never replaces a newer one.

## Order and overlaps

- No in-flight change on `origin/main` touches `src/ui/sharedConfig.tsx`, `src/server/sharedConfig.ts`,
  `src/ui/activity.tsx` or the shared-config routes.
- `one-console-per-change` and `start-editor-in-worktree` touch `src/ui/api.ts` for other routes; the edits here are
  the two shared-config signatures only.

## Impact

- `src/ui/sharedConfig.tsx` — `preview()` keeps the assignments with the previews; `PreviewDialog`'s Apply sends those
  with their digests; `apply()` no longer reads `pending`.
- `src/ui/sharedConfigState.ts` — a pure helper pairing previewed assignments with their digests (testable).
- `src/server/sharedConfig.ts` — `previewDigest(before, after)`, `digest` on the preview, `applyTo` comparing it.
- `src/server/api.ts` — `selection()` accepts an optional `digest` per assignment; apply passes it on.
- `src/shared/types.ts` — `SharedConfigPreview.digest`, `SharedConfigAssignment.digest?`.
- `src/ui/api.ts` — the apply signature; the demo's API stand-in (`src/ui/demo/`) returns and accepts a digest.
- `src/ui/activity.tsx`, `src/ui/activityState.ts` — a latest-request guard (pure helper) for `load` and `loadOlder`.
- `src/ui/app.tsx`, `src/ui/autoRefresh.ts` — a pure `newerSnapshot(shown, next)` check used by `loadState` and the
  refresh's `onSnapshot`.
- Tests: `test/sharedConfig.test.ts` (digest, refusal on changed file or profiles), `test/sharedConfigApi.test.ts`
  (apply with stale and missing digest, partial success), `test/sharedConfigUi.test.ts` (frozen assignments),
  `test/activityState.test.ts` (latest-request guard), `test/autoRefresh.test.ts` (older snapshot discarded).
- `src/ui/changelog.ts` — What's new entry.
- Invariant 1 is unchanged — the same path and managed sections, now written only as previewed; no new git command,
  network access or write.
