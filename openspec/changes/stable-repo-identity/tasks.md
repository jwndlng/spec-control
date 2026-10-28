# Tasks

## 1. Configuration

- [x] 1.1 Replace the `id === repoId(path)` refinement in `src/server/config.ts` with a check that no two repositories canonicalise to the same directory (design D2); verify with `test/config.test.ts` that a configuration whose stored path differs from its canonical spelling validates with its id unchanged, and that two entries for one directory are refused naming the duplicate directory
- [x] 1.2 Add `assignRepoId(path, taken)` and pass the taken ids through `newRepoConfig` (design D4); verify with `test/config.test.ts` that a free hash is used as is and a taken one yields the next derived id, deterministically
- [x] 1.3 Make `migrateConfig` keep well-formed stored ids and assign one only to an entry without it, merging same-directory entries under the winner's id as before (design D1); verify with `test/config.test.ts` — a config written for `/w/acme/Acme` loads after the folder became `/w/acme/acme` with the new path and the old id, and the "Legacy duplicate entries are merged" case still holds
- [x] 1.4 Add the continuity check to `updateConfig` before `saveConfig` (design D3); verify with `test/config.test.ts` that an unchanged id with the old spelling is saved under the new canonical path, an id moved to another repository's directory is refused, and a new id other than the assigned one is refused, each leaving `config.json` unchanged

## 2. Routes and discovery

- [x] 2.1 Find a configured repository by canonical path in `postTrackRepo` (`src/server/api.ts`) and assign new ids with the taken set there and in `confirmIntegration` (`src/server/integration.ts`); verify with `test/trackingApi.test.ts` and `test/integration.test.ts` that enabling or integrating a folder already tracked under an older spelling changes nothing and adds no entry
- [x] 2.2 Report candidate ids from `assignRepoId` in `src/server/discover.ts`; verify with `test/discover.test.ts` that a candidate whose hash a configured repository already holds is reported with the id Enable then stores
- [x] 2.3 Verify end to end with `test/api.test.ts`: after a tracked folder is replaced by a symbolic link to it (and, where the temporary directory's file system is case-insensitive, after a case-only rename), `PUT /api/config` with the old spelling, `POST /api/repos/<id>/enabled`, a label change and `POST /api/ignore-paths` all succeed and the id is unchanged; `PUT /api/config` re-pointing an id answers `400`
- [x] 2.4 Verify that the setup wizard's save keeps working with `test/setupApi.test.ts`

## 3. Wrap-up

- [x] 3.1 Run `bun run check`, and with `bun run build` confirm in `dist/spec-control` that a case-only rename of a tracked folder in a temporary workspace leaves its id, sessions and activity in place across a restart
