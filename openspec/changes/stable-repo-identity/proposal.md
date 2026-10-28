# A repository keeps its id when its folder's spelling changes

## Why

A tracked repository's `id` is recomputed from its path wherever the configuration is validated: `config.ts`
canonicalises `repos[].path` with `realpathSync.native` (on-disk casing, symbolic links resolved) and refuses any entry
whose `id` is not `repoId(path)`. When a tracked folder is renamed by case only (`/w/acme/Acme` to `/w/acme/acme`) or
replaced by a symbolic link while the server runs, the stored path still names the same directory but no longer
canonicalises to itself, so **every** configuration write fails with `repos.0.id: id does not match path` — saving
Settings, Enable and Disable, labels, a confirmed integration, Ignore — until the dashboard is restarted. On that
restart `migrateConfig` recomputes the id from the new canonical path (reproduced: `f055f4484961` became
`953b65d83fe7`), which silently orphans everything keyed by the old id: session records and their worktrees under
`worktrees/<id>/`, the activity history, the per-repository caches and the browser's per-project state. That breaks the
promise of `repo-discovery` that renaming does not change identity and one directory has one id.

## What Changes

- **The id is assigned once and stored.** A repository gets its id from its canonical path when it is added (Enable on
  the overview or in Settings, a confirmed integration, a tracked clone, setup) and keeps it from then on. Neither
  validation nor loading recomputes it; loading keeps every stored id that is well formed and assigns one only to an
  entry that has none.
- **One directory, one id, by canonical path.** The guarantee moves from "the id is a hash of the path" to "no two
  entries name the same directory": validation refuses two repositories whose paths resolve to the same directory,
  loading merges them as it does today (keeping the winner's id), and every lookup of a configured repository by path —
  tracking, integration, discovery's set of known repositories — compares canonical paths, never `repoId(path)`.
- **A write cannot re-point an id.** Every configuration write checks, against the configuration it replaces, that an
  id it keeps still names the same directory (the canonical form of the old and the new path are equal now) and that an
  id it adds is the one the dashboard would assign to that path. So a Settings tab holding the old spelling saves, and
  the stored path becomes the new canonical spelling with the same id.
- **A new id never collides.** When the id derived from a new repository's path is already held by another
  configured repository (possible once ids outlive their path), the dashboard derives the next one deterministically,
  and discovery reports candidates with the id they would get.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `repo-discovery`: ids are assigned when a repository is added and kept; loading no longer recomputes them.
- `dashboard-api`: `PUT /api/config` (and every configuration write) checks id continuity instead of id-equals-hash.
- `settings-page`: saving Settings after a tracked folder's spelling changed keeps the repository and its id.

## Impact

- `src/server/config.ts`: drop the `id === repoId(path)` refinement; add the same-directory check; `assignRepoId(path,
  taken)`; `newRepoConfig` takes the taken ids; `migrateConfig` keeps stored ids; the continuity check inside
  `updateConfig` before `saveConfig`.
- `src/server/api.ts`: `postTrackRepo` finds a configured repository by canonical path, not by `repoId(path)`;
  `putConfig` reports the continuity refusal as `400`.
- `src/server/discover.ts`: candidate ids from `assignRepoId` with the configured ids as taken.
- `src/server/integration.ts`: `confirmIntegration` assigns the id with the configured ids as taken.
- Tests: `test/config.test.ts`, `test/api.test.ts`, `test/trackingApi.test.ts`, `test/discover.test.ts`,
  `test/integration.test.ts`, `test/setupApi.test.ts`. The case-only rename and the symbolic link are made in temporary
  directories by the tests (the case-only rename only where the file system is case-insensitive), never committed
  under `test/fixtures/`.
- Specs: `openspec/specs/repo-discovery/spec.md`, `openspec/specs/dashboard-api/spec.md`,
  `openspec/specs/settings-page/spec.md`.
- No UI change, no new dependency, no network, nothing written to a repository; invariants and CLAUDE.md unchanged.
- Installations that already lost their old id through a restart are not repaired: nothing records what the old id
  was.

## Overlaps

- `serialise-home-writes` (PR #359, in flight) changes `src/server/config.ts` (adds `configRevision`) and
  `putConfig` in `src/server/api.ts` (the `If-Match` check inside the serialised write), and adds the `dashboard-api`
  requirement "A configuration save cannot undo a write it did not see" and the `settings-page` requirement "Saving
  Settings keeps changes made elsewhere". The continuity check here sits in `updateConfig`, inside the same serialised
  write, and does not change the revision; the overlap is textual. Its rebase of a stale Settings draft carries the old
  path spelling, which this change makes acceptable.
- `add-validate-phase` (in flight) changes `src/server/config.ts` (the prompt migration in `migrateConfig`); the
  overlap is textual.
- `contain-repository-reads` (PR #371, in flight) changes `src/server/api.ts` in unrelated routes.
