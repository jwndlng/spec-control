# Design

## Context

`src/server/version.ts` exports `VERSION`: the release tag (`SPEC_CONTROL_VERSION`, set by the release workflow and
baked in with `--define`) or `dev`. The server already hands it to the UI as `current` in `GET /api/update`, which
`app.tsx` reads on load and at most hourly into the `update` state that drives `UpdateBanner`. The demo answers that
endpoint with `current: "demo"`. `isReleaseVersion` (`src/shared/versions.ts`) and `releaseUrl` (`src/ui/updateBanner.tsx`)
already exist.

## Goals / Non-Goals

**Goals:**
- Show the running release tag in the hero header, linked to its release page, from data the UI already has.

**Non-Goals:**
- Showing a commit hash, build date or `dev` label for unreleased builds.
- Changing `GET /api/version`, `GET /api/update`, the update check or the banner.
- Any change in `desktop/` — the app shows the server's page.

## Decisions

- **Source: `GET /api/update`'s `current`, not a new endpoint or a build-time define in the UI bundle.** The UI is built
  once by `scripts/build-ui.ts` and embedded; the version is defined only for the server build, so the UI would show
  `dev` even in a release. The status is already fetched on load, so this adds no request. Alternative — read
  `GET /api/version`: one more request for the same string.
- **Gate on `isReleaseVersion(current)`.** "Released via GitHub with a tag" is exactly what the release workflow
  produces and what the update check already treats as a release. `dev`, `demo` and any odd value fall out with no
  special cases. Hidden while `update` is still undefined or the read failed, so there is no `…` placeholder flashing.
- **Placement: a small muted link beside the title inside `.hero-brand`**, not in `.topbar-end`, which is already
  crowded with status and actions. Styled like a quiet pill (muted foreground, subtle border), same in both themes via
  existing tokens; on narrow screens it wraps under the title rather than widening the header.
- **A pure helper `headerVersion(status)`** in `updateBanner.tsx` returns the tag or `undefined`, and a hook-free
  `VersionLabel` component renders the link — testable with the existing vnode helpers in `test/updateUi.test.ts`,
  like `bannerVersion`/`UpdateBanner`.
- **Link attributes** match the banner's: `target="_blank" rel="noopener noreferrer"`, `aria-label="Spec Control
  <version> release notes"`. In the macOS app external links already open in the default browser.

## Risks / Trade-offs

- [The header gains one more element on small screens] → it is short (`v0.12.0`), wraps under the title, and is checked
  at the hero's existing breakpoints.
- [Version appears a moment after first paint, once `/api/update` answers] → acceptable; it is a quiet label, and
  showing nothing until known avoids a wrong value.
