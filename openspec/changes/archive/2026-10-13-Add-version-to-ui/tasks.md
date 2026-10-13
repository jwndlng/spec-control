# Tasks

## 1. Version label

- [x] 1.1 Add `headerVersion(status: UpdateStatus | undefined): string | undefined` to `src/ui/updateBanner.tsx` (the tag when `isReleaseVersion(status.current)`, else undefined) and a hook-free `VersionLabel` component rendering a link to `releaseUrl(version)` with `target="_blank" rel="noopener noreferrer"` and an `aria-label` naming the version; verify with new cases in `test/updateUi.test.ts`: `v0.12.0` → link to `…/releases/tag/v0.12.0`, `dev`, `demo`, `v0.12` and undefined → nothing, and a status with `enabled: false` still shows the tag
- [x] 1.2 Render `VersionLabel` with the existing `update` state beside the title in the hero (`src/ui/app.tsx`, `.hero-brand`); verify `bun run dev` shows nothing (`dev`) and a build with `SPEC_CONTROL_VERSION=v0.0.1 bun run build` then `dist/spec-control` shows `v0.0.1` linked to its release page on the overview, a board and Settings
- [x] 1.3 Style the label in `src/ui/styles.css` (muted pill from existing tokens, wraps under the title at the hero's existing breakpoints (1279px, 1100px, 720px)); verify in light and dark themes and at a narrow window that the header has no horizontal scroll
- [x] 1.4 Confirm the demo shows no label (`DEMO_UPDATE_STATUS.current` is `demo`) with a test in `test/updateUi.test.ts` using `headerVersion(DEMO_UPDATE_STATUS)`

## 2. Docs and release

- [x] 2.1 Add a What's new entry at the top of `src/ui/changelog.ts` (id `2026-10-13-version-in-header`) saying the header now shows the release you run, linked to its notes; verify the changelog tests in `bun test` pass
- [x] 2.2 Run `bun run check` and verify lint, typecheck and tests pass
