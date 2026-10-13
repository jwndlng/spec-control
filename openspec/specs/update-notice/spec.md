# update-notice Specification

## Purpose
Tells the user that a newer release of Spec Control exists — for the command-line binary and for the macOS app alike —
by comparing the running version with the tag of this project's latest GitHub release, without installing anything and
without sending anything about the user.

## Requirements

### Requirement: The update check asks GitHub for the latest release tag and nothing else
The update check SHALL learn the tag of this project's latest published release with a single `HEAD` request to
`https://github.com/jwndlng/spec-control/releases/latest`, without following redirects, and SHALL read only the
`Location` header of the response. The tag SHALL be the last path segment of that location when the location is
`https://github.com/jwndlng/spec-control/releases/tag/<tag>` and `<tag>` has the form `v<major>.<minor>.<patch>`;
anything else — another status, another host or path, a tag of another form, a network error, or no answer within ten
seconds — SHALL count as a failed check. The request MUST NOT carry a cookie, an `Authorization` header, a query string,
a request body, or anything identifying the user, the machine, the configuration, a path, a repository or how the
dashboard is used; its `User-Agent` SHALL be `spec-control/<running version>`. The check MUST NOT use `gh`, git or any
credential, MUST NOT read a response body, and MUST NOT download, write or run anything it receives.

#### Scenario: Latest release found
- **WHEN** the request is answered `302` with `Location: https://github.com/jwndlng/spec-control/releases/tag/v0.12.0`
- **THEN** the check's result is the latest version `v0.12.0`

#### Scenario: Unexpected redirect
- **WHEN** the request is answered `302` with a location on another host, or with `/releases/tag/nightly`
- **THEN** the check counts as failed and no latest version is recorded

#### Scenario: Nothing about the user is sent
- **WHEN** a check runs while several repositories are tracked
- **THEN** the only request made is `HEAD /jwndlng/spec-control/releases/latest` with no query, body, cookie or credential, and with `User-Agent: spec-control/<version>`

### Requirement: Versions are compared numerically
A latest release SHALL be newer than the running version exactly when both are of the form `v<major>.<minor>.<patch>`
and the latest is greater, comparing major, then minor, then patch as numbers. A running version of any other form,
including `dev`, SHALL never be older than anything.

#### Scenario: Double-digit minor
- **WHEN** the running version is `v0.9.3` and the latest release is `v0.10.0`
- **THEN** an update is available

#### Scenario: Same or older
- **WHEN** the running version is `v0.10.0` and the latest release is `v0.10.0` or `v0.9.9`
- **THEN** no update is available

### Requirement: The check runs rarely and only when allowed
The server SHALL check about one minute after it starts serving, and then at most once every 24 hours while it runs. It
SHALL remember the time and outcome of its last check in `~/.spec-control/update-check.json`, and a start within 24 hours
of the last check SHALL NOT check again but use the remembered outcome. A failed check SHALL count as a check, be
retried only when the next check is due, and report nothing to the user beyond the Updates section. The server MUST NOT
check when it runs as `dev` (unless it was built with a version), and MUST NOT check while the configuration has
`updateCheck: false`. Saving the configuration with the check turned off SHALL cancel any planned check immediately;
turning it on again SHALL plan the next check by the same rule. Scanning, discovery, polling, serving the UI and every
other endpoint MUST NOT start a check. At most one check SHALL run at a time.

#### Scenario: Restart within a day
- **WHEN** a release binary checked an hour ago and is restarted
- **THEN** it makes no request and reports the remembered latest version

#### Scenario: Development build
- **WHEN** the server runs from `bun run dev` and reports its version as `dev`
- **THEN** no update check request is ever made

#### Scenario: Turned off
- **WHEN** the user turns Check for new versions off and saves, while the next check is planned in an hour
- **THEN** no request is made in that hour or afterwards until the setting is turned on again

#### Scenario: Offline
- **WHEN** the machine has no network at the planned check
- **THEN** the check is recorded as failed, the dashboard shows no error outside the Updates section, and the next attempt is 24 hours later

### Requirement: Update endpoints
`GET /api/update` SHALL return what the server last learned, without contacting any network or starting a process:
`{ enabled, current, latest?, checkedAt?, outcome, available }`, where `enabled` says whether checks are allowed (false
when turned off or for a `dev` build), `current` is the running version as `GET /api/version` reports it, `latest` the
last tag learned, `checkedAt` the time of the last check, `outcome` one of `never`, `ok` or `failed`, and `available`
whether `latest` is newer than `current` and checks are enabled. `POST /api/update/check` SHALL run a check now and
answer the same shape once it finished; it SHALL be refused with `409` while checks are not allowed, SHALL join a check
already running rather than start a second one, and is a mutating request under the same-origin protection. Neither
endpoint SHALL carry a path, a repository name or a credential.

#### Scenario: Reading is free
- **WHEN** `GET /api/update` is requested
- **THEN** no network connection is opened and nothing under `~/.spec-control/` is written

#### Scenario: Check now
- **WHEN** the user presses Check now and the latest release is `v0.12.0` while `v0.11.2` runs
- **THEN** `POST /api/update/check` answers `outcome: "ok"`, `latest: "v0.12.0"` and `available: true`

#### Scenario: Check now while turned off
- **WHEN** `POST /api/update/check` is requested with `updateCheck: false` in the configuration
- **THEN** it answers `409` and no request is made

#### Scenario: Cross-site check
- **WHEN** another web page in the same browser posts to `/api/update/check`
- **THEN** the request is refused by the same-origin guard and no check runs

### Requirement: A banner announces a newer version
When `GET /api/update` reports an update available, every view SHALL show a thin banner at the very top of the page,
above the header, saying that Spec Control `<latest>` is available while `<current>` runs, with a link to that
release's page (`https://github.com/jwndlng/spec-control/releases/tag/<latest>`) and a link to how to update (the
README's update instructions), both opening outside the dashboard, and a dismiss button. Dismissing SHALL hide the
banner for that version in this browser only, remembered under the browser key `spec-control.updateDismissed`; a
later, newer version SHALL show the banner again. The banner MUST NOT appear when no update is available, when checks
are turned off, or for a version the user dismissed. The UI SHALL read `GET /api/update` when it loads and again at most
once an hour while it stays open, and MUST NOT itself contact any host other than the dashboard's own. The banner SHALL
be announced politely to screen readers, its links and dismiss button SHALL be reachable by keyboard, and it SHALL fit a
narrow screen without horizontal scrolling. Because the macOS app shows the server's page, the banner SHALL appear in
the app's window in the same way.

#### Scenario: New version available
- **WHEN** `v0.11.2` runs and the server learned `v0.12.0`
- **THEN** the projects overview, a board and Settings each show "Spec Control v0.12.0 is available — you have v0.11.2" with Release notes and How to update links

#### Scenario: Dismissed for one version
- **WHEN** the user dismisses the banner for `v0.12.0` and reloads the page
- **THEN** no banner is shown, and once the server learns `v0.13.0` the banner shows again

#### Scenario: Links leave the dashboard
- **WHEN** the user follows Release notes in the macOS app
- **THEN** the release page opens in the default browser and the app window keeps showing the dashboard

### Requirement: Check for new versions is a setting
Settings SHALL have an **Updates** section with a **Check for new versions** switch, on by default and part of the
Settings draft like every other setting. The configuration key `updateCheck` SHALL be written as `false` only when the
switch is off and SHALL be absent otherwise; a configuration without the key SHALL mean on. The section SHALL show the
running version, when the last check ran and its outcome (the latest version found, "up to date", or that it failed),
and a **Check now** button that runs `POST /api/update/check` and shows the result; Check now SHALL be disabled while the
switch is off, while unsaved changes would turn it off, and for a `dev` build, which the section SHALL name as the
reason. Turning the switch off and saving SHALL hide the banner at once.

#### Scenario: Default
- **WHEN** a user opens Settings with a configuration that has no `updateCheck` key
- **THEN** Check for new versions is on, and saving without touching it writes no `updateCheck` key

#### Scenario: Off and saved
- **WHEN** the user turns Check for new versions off and saves
- **THEN** the configuration holds `updateCheck: false`, the banner disappears, and no further check is made

#### Scenario: Only false is stored
- **WHEN** `PUT /api/config` is called with `updateCheck: true`
- **THEN** the saved configuration has no `updateCheck` key, and a non-boolean value is refused with `400` leaving the configuration unchanged

#### Scenario: Development build
- **WHEN** Settings is opened in a `dev` build
- **THEN** the Updates section shows the version `dev`, says that development builds do not check, and Check now is disabled

### Requirement: The demo never checks
The demo build SHALL show the Updates section with a fictional running version and checks reported as not available in
the demo, SHALL never show the update banner, and MUST NOT make any request for it.

#### Scenario: Demo settings
- **WHEN** the user opens the demo's Settings at the Updates section
- **THEN** it shows the section, Check now is disabled, and no request leaves the page

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
