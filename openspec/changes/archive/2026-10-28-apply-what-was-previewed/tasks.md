# Tasks

## 1. Shared config: apply what was previewed

- [x] 1.1 Add `digest` to `SharedConfigPreview` and an optional `digest` to `SharedConfigAssignment` in `src/shared/types.ts`; compute it in `previewFor` (design D2); verify with `test/sharedConfig.test.ts` (same input same digest, changed file or profiles different digest)
- [x] 1.2 Make `applyTo` refuse a missing or different digest with "changed since the preview" and write nothing; verify with `test/sharedConfig.test.ts` for "The file changed after the preview" and "The profiles were saved after the preview"
- [x] 1.3 Accept and pass on `digest` in `selection()` and `postSharedConfigApply` (`src/server/api.ts`); verify with `test/sharedConfigApi.test.ts` for "Apply with a stale digest", "Apply without a digest" and the existing "Partial success"
- [x] 1.4 Keep the previewed assignments with the previews and send exactly those, with digests, from the dialog (design D1, `withDigests` in `src/ui/sharedConfigState.ts`); update `src/ui/api.ts` and the demo stand-in; verify with `test/sharedConfigUi.test.ts` reproducing "A poll while the preview is open" (preview `[alpha-infra]`, a later `outdated` `demo-ops` row, apply still `[alpha-infra]`)

## 2. Activity feed: latest answer only

- [x] 2.1 Add the latest-request guard to `src/ui/activityState.ts` and use it in `load` and `loadOlder` (`src/ui/activity.tsx`), applying `wanted` and `onSeen` only for applied answers (design D3); verify with `test/activityState.test.ts` for the three activity-feed scenarios

## 3. Board: snapshots only move forward

- [x] 3.1 Add `newerSnapshot` (design D4) and use it in `loadState` and the refresh's `onSnapshot` in `src/ui/app.tsx`; verify with `test/autoRefresh.test.ts` for "A slow poll after Refresh" and "Same snapshot again"

## 4. Wrap-up

- [x] 4.1 Add a What's new entry to `src/ui/changelog.ts`; verify with `bun run check`
- [x] 4.2 Run `bun run check` and `bun run build`, and in the compiled binary preview, edit the file, then confirm Apply and see it refused; verify by hand against a temp repository — done: `bun run build`, and against the compiled binary's API with a temp repository a stale digest and a missing one were refused with the file untouched, and a fresh preview's digest wrote it. **For you:** in `dist/spec-control`, Settings → Shared OpenSpec config, tick a profile, open **Preview**, edit that repository's `openspec/config.yaml`, then press **Apply** and check it shows `refused` with "changed since the preview"
