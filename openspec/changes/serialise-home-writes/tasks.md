# Tasks

## 1. Config revision

- [ ] 1.1 Add `configRevision(config)` to `src/server/config.ts`; verify with `test/config.test.ts` (equal configs, equal revision; any change, a new one)
- [ ] 1.2 Send `ETag` on every response whose body is the configuration, and check `If-Match` in `putConfig` inside `updateConfig`, answering `412 { error, config }` with the current `ETag` and writing nothing; verify with `test/api.test.ts` (matching revision saves; stale revision after `POST /api/labels/color` is `412` and the colour stays; no `If-Match` saves as before)
- [ ] 1.3 Carry the revision in `src/ui/api.ts` and `src/ui/demo/demoApi.ts` (`config()`, `saveConfig(config, revision)`, a `412` surfaced with the current config); verify with `test/api.test.ts` and `bun run check`

## 2. Settings and setup wizard

- [ ] 2.1 Add a pure `rebaseDraft(draft, base, current)` beside `withLatestRepos` in `src/ui/settings.tsx` and use it on `412`: save at once when no edited key changed elsewhere, otherwise show the rebased draft with a notice; verify with a new `test/settingsSave.test.ts` (clone tracked meanwhile, ignore path added meanwhile, label colour chosen meanwhile, conflicting poll-interval edit)
- [ ] 2.2 Send the fresh copy's revision from the setup wizard's saves and recompute and retry once on `412` (`src/ui/setupState.ts`, `src/ui/setupWizard.tsx`); verify with `test/setupState.test.ts`

## 3. Activity log

- [ ] 3.1 Capture the entries at enqueue time in `ActivityLog.append` and compact from them; verify with `test/activityLog.test.ts`: 5 000 events, then two appends without waiting, leaves 2 000 lines with no duplicate id and both new events present

## 4. Pull requests

- [ ] 4.1 Record `lastQueriedAt` per GitHub repository and drop repositories queried within 60 s from `repoIds` refreshes, `force` notwithstanding; verify with `test/pullRequests.test.ts` and `test/pullRequestsApi.test.ts` against `test/fixtures/fake-gh.ts` (three watch refreshes within a minute start one query; a user `force` refresh right after still queries; after 60 s the watch queries again)
- [ ] 4.2 Serialise `PullRequests.persist`; verify with `test/pullRequests.test.ts` (two refreshes of different repositories finishing together leave a cache file with both lists)

## 5. Verification

- [ ] 5.1 Run `bun run check` and `bun run build`; with the compiled binary, save Settings from a tab opened before a label colour was chosen in another and check the colour survives
