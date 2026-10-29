# Design

## Context

`repoId(path)` is 12 hex characters of the sha1 of `canonicalPath(path)`, and `canonicalPath` resolves symbolic links
and the on-disk casing with `realpathSync.native`. The configuration schema canonicalises `repos[].path` as it parses
and then requires `id === repoId(path)`; `migrateConfig` on load sets `id: repoId(path)` for every entry. So the id is a
function of what the file system says *now* about a path, and the stored id stops matching as soon as the answer
changes for the same directory.

Records keyed by the id: session records (`sessions/<id>/meta.json` hold `repoId`), session worktrees under
`worktrees/<repoId>/`, activity events (`repoId`), the cached snapshot, and in the browser the per-project group,
filter and detail state.

## Decisions

### D1. Store the id; derive it only when a repository is added

The id is computed once, from the canonical path at the moment the repository enters the configuration, and is then
data like the name. Validation checks only its format and uniqueness; `migrateConfig` keeps every well-formed stored
id and computes one only for an entry without it. The stored path keeps being re-canonicalised on every load and write,
so it follows the folder's on-disk spelling while the id stays.

Rejected: **validate lexically against the stored path.** It fixes the running server's writes, but the next load
canonicalises the path and recomputes the id anyway, which is the orphaning this change exists to stop; and the stored
path would keep a spelling the file system no longer has.

Rejected: **re-canonicalise and re-id inside `updateConfig`, carrying the old id's records along.** The session
worktrees live under `worktrees/<id>/`; moving them means `git worktree repair` in the repository, a write invariant 1
does not list and that this bug does not justify. The activity log is append-only history and would have to be
rewritten; browser state keyed by the id cannot be moved by the server at all. Every new id-keyed record added later
would need its own carrying code.

### D2. One directory, one id — enforced by canonical path

What "one directory never has two ids" needs is that two entries never name one directory. Validation refuses a
configuration in which two repositories' paths canonicalise to the same directory (the existing `Duplicate directory is
rejected` case, now reported as such instead of as a duplicate id). Loading merges such entries as it does today and
keeps the winning entry's id. Every place that asks "is this path already configured" compares
`canonicalPath(r.path)` with the canonical request path: `postTrackRepo` (today it compares `repoId(path)`),
`confirmIntegration` (already does), and discovery's known set (already does).

### D3. A write cannot re-point an id

With the hash check gone, `PUT /api/config` could otherwise send an existing id with another repository's path and so
attach that id's sessions and worktrees to a different repository. `updateConfig` therefore checks the next
configuration against the one it replaces, inside the serialised write, before `saveConfig`:

- an id present in both must name the same directory: `canonicalPath(previous.path) === canonicalPath(next.path)`,
  both evaluated now — which holds after a case-only rename (the old spelling resolves to the new one) and after the
  folder was replaced by a link to it, and also for a path that no longer exists (both normalise to the same string);
- an id that is new must be `assignRepoId(path, ids of the previous configuration)`.

A refusal is a `ConfigValidationError` naming `repos.<i>.id`, so `PUT /api/config` answers `400` as for any other
invalid body and the stored configuration is unchanged. The six single-repository endpoints and the integration
confirmation build their next configuration from the current one, so they always pass.

### D4. Collision-free assignment

`assignRepoId(path, taken)` returns `repoId(path)` unless another configured repository holds it — possible once an id
outlives the spelling it was derived from, for example a new folder created on a case-sensitive file system with a
tracked repository's former spelling — and otherwise the first of `sha1(<canonical path>\n<n>)` for `n = 1, 2, …` not
taken. Discovery passes the configured ids as taken, so a candidate's reported id is exactly the id Enable or Settings
will store, and the continuity check in D3 accepts it.

## Risks / Trade-offs

- An id no longer tells which path it was derived from. Nothing reads it that way; it is an opaque key.
- A folder moved to a different directory (not just respelled) is a different directory: its entry keeps the old path,
  scans fail as today, and the user forgets it and enables the new one, which gets a new id. Unchanged behaviour.
- Installations that already restarted after such a rename have their new id and orphaned old records; there is no
  record of the old id to recover them from.
