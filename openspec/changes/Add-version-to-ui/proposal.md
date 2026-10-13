# Proposal

## Why

The version a user runs is visible only deep in **Settings → Updates** ("Running `v0.11.2`"). When someone reports a
problem, compares their install with the release notes or checks that an update took, they have to know where to look.
A released build knows its tag; the header should simply show it.

## What Changes

- The hero header shows the running version as a small, quiet label next to the product name — but only when the
  build is a GitHub release, i.e. its version is a release tag of the form `v<major>.<minor>.<patch>`.
- The label links to that release's page on github.com (`…/releases/tag/<version>`), opening outside the dashboard, like
  the update banner's Release notes link. It is a link the user follows, not a request the page makes.
- `dev` builds, any other non-tag version and the demo (`demo`) show no label.
- The version comes from the `current` field of `GET /api/update`, which the UI already reads at load. No new endpoint,
  no new request, no network; it is shown whether or not **Check for new versions** is on.
- The macOS app shows the same label, because it shows the server's page.
- A What's new entry announces it.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `update-notice`: adds a requirement that a release build shows its running version in the header, linked to its
  release page, and that non-release builds and the demo show none.

## Impact

- `src/ui/app.tsx` (hero header), `src/ui/updateBanner.tsx` (reuses `releaseUrl`; a small helper deciding what to show),
  `src/ui/styles.css` (label style, narrow screens).
- `src/shared/versions.ts` (`isReleaseVersion`, reused, unchanged).
- `src/ui/changelog.ts` (What's new entry).
- `test/updateUi.test.ts` (label shown for a tag, hidden for `dev`, `demo` and before the status loads).
- No server, API, configuration or invariant change: invariants 1 and 4 are untouched.
