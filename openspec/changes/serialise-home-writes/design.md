# Design

## Context

`updateConfig` already applies config writes one at a time against the config the previous write left. Every writer
except `PUT /api/config` computes its change from that current config. `PUT` is the one write whose content comes from
a client's copy — Settings' draft, or a setup wizard step computed from a `GET` it made moments before. The setup
wizard's Projects step changes `repos` through `PUT`, and Settings changes `ignorePaths` that Ignore on the overview
also changes, so no field of the config belongs to `PUT` alone.

## Decisions

### D1. Optimistic concurrency on `PUT /api/config`, not a server-side merge

The revision of a configuration is a short hash of its saved JSON (`configRevision` in `src/server/config.ts`). It
needs no counter, survives a restart, and two equal configs have the same revision. Every response whose body is the
configuration — `GET` and `PUT /api/config`, the tracking, per-repository, label-colour and fast-forward-warning
endpoints, setup done — carries it as `ETag`. `PUT /api/config` with `If-Match` compares, inside the serialised write,
against the revision of the config the previous write left; a mismatch answers `412 { error, config }` with the
current `ETag` and writes nothing. Without `If-Match` the request is applied as today, so `curl` keeps working and a
deliberate overwrite stays possible.

Rejected: the server merging "server-owned" fields (`repos`, `ignorePaths`, `labelColors`) from its own copy. The
wizard writes `repos` through `PUT` and Settings writes `ignorePaths`, so the server would either drop a client's
intended change or keep restoring a stale one; it cannot tell which from a whole config. Rejected: a three-way merge
on the server with the client sending its base — the client is the one that knows what the user edited.

### D2. Settings rebases its draft on the newer configuration

Settings keeps the copy its draft was seeded from (`base`) and its revision. On `412`, `rebaseDraft(draft, base,
current)` takes, for every top-level key, the draft's value where the draft differs from `base` (the user edited it)
and the current value otherwise; `repos` always come from `current` with `withLatestRepos`' profile rule, and `setup`
stays the server's. If none of the keys the user edited differs between `base` and `current`, the result is saved at
once with `current`'s revision — nothing to decide. Otherwise the rebased draft is shown with a notice that settings
were changed elsewhere meanwhile; the draft's base becomes `current`, and the user's next Save sends it. Comparison is
by value (JSON-equal), per top-level key; `agentSessions` is compared as a whole, so an Agent sessions edit in Settings
and a fast-forward-warning change elsewhere count as a conflict and the user sees it rather than one silently winning.

The setup wizard computes each save from a fresh `GET`; on `412` it gets the current config, recomputes the same step's
save from it and retries once, then reports the error as any other.

### D3. Activity compaction writes what its job owns

`append` keeps updating `this.entries` at once, so the feed shows new events immediately. The job it queues captures
`const upTo = this.entries` at enqueue time (the array is replaced, never mutated in place), and if that job compacts
it writes `upTo`, pruned for age, instead of whatever `this.entries` has become. Appends queued behind it append their
own events afterwards, exactly once. `lines` after a compaction is the number of entries written. The start-up
compaction in `load` is queued before any append and is unaffected. Rejected: mutating `entries` inside the job —
reads would lag behind detected events until the write ran.

### D4. The watch's minimum gap lives on the server

The server records, per GitHub repository, when its last query settled (`lastQueriedAt`, success or failure, memory
only). A refresh that names `repoIds` — only the board's watch does — drops every GitHub repository queried less than
`WATCH_MIN_GAP_MS` (60 s) ago from what it queries, `force` notwithstanding, and answers with the cached lists for it.
Refreshes with `repoId` or neither (Refresh, opening a view) are not affected; they already follow the freshness window
unless the user forces them. The per-tab schedule in `src/ui/pullRequestsState.ts` stays as it is; the server rule only
makes sure that several tabs together cannot exceed it. Rejected: a new `watch: true` field — `repoIds` already marks
the watch, and making the limit depend on a field a client may omit would undo it.

### D5. One cache write at a time

`persist` is chained on a promise like `ActivityLog.enqueue`, each write serialising the cache as it is when the write
starts, so the last of several concurrent writes contains every refresh's lists. The temp file stays
`${path}.${pid}.tmp`, which is safe once only one write uses it at a time.
