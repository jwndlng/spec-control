# Spec Delta

## ADDED Requirements

### Requirement: A release build shows its version in the header
When the running version, as `GET /api/update` reports it in `current`, is a release tag of the form
`v<major>.<minor>.<patch>`, every view SHALL show that version in the page header next to the product name, as a link
to that release's page (`https://github.com/jwndlng/spec-control/releases/tag/<version>`) that opens outside the
dashboard. The version SHALL be shown whether or not Check for new versions is on, and whether or not an update is
available. A running version of any other form — `dev`, the demo's `demo`, or anything that is not a release tag — SHALL
show no version in the header, and nothing SHALL be shown before the UI has read `GET /api/update` or when that read
failed. Showing the version MUST NOT add a request: it uses the same read of `GET /api/update` the update banner uses and
MUST NOT contact any host other than the dashboard's own. The label SHALL be reachable by keyboard, SHALL name the
version for screen readers, and SHALL fit a narrow screen without horizontal scrolling. Because the macOS app shows the
server's page, the version SHALL appear in the app's window in the same way.

#### Scenario: Release build
- **WHEN** a binary built for the release `v0.12.0` serves the dashboard
- **THEN** the projects overview, a board and Settings each show `v0.12.0` next to "Spec Control" in the header, linking to `https://github.com/jwndlng/spec-control/releases/tag/v0.12.0`

#### Scenario: Checks turned off
- **WHEN** the user turned Check for new versions off in a `v0.12.0` build
- **THEN** the header still shows `v0.12.0`, and no request is made for it

#### Scenario: Development build
- **WHEN** the dashboard runs from `bun run dev` and reports its version as `dev`
- **THEN** the header shows no version

#### Scenario: Demo
- **WHEN** the user opens the demo
- **THEN** the header shows no version and no request leaves the page

#### Scenario: Link leaves the dashboard
- **WHEN** the user follows the version link in the macOS app
- **THEN** the release page opens in the default browser and the app window keeps showing the dashboard
