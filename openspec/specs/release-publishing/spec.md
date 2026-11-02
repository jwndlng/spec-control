# release-publishing Specification

## Purpose
Defines how this project's releases are made: pull requests labelled from their Conventional Commit titles, a draft
GitHub release kept current from `main`, and what publishing that draft builds, verifies and attaches — the
single-binary downloads — together with the version the binary reports.

## Requirements

### Requirement: Pull requests are labelled from their title
Every pull request SHALL be labelled from the Conventional Commit type in its title whenever it is opened, edited, reopened or updated: `feat` with `feat`, `fix` with `fix`, `docs` with `docs`, and `chore`, `refactor`, `test`, `style`, `ci`, `build` and `perf` each with a label of the same name. A pull request SHALL carry only the type label its current title names: any other of these type labels, whether added for an earlier title or by hand, SHALL be removed when it is labelled. Labels that are not type labels, including `major` added by hand, SHALL be left in place. The labelling job MUST NOT check out or run code from the pull request.

#### Scenario: Feature title gets the feature label
- **WHEN** a pull request titled `feat(board): group by owner` is opened
- **THEN** it carries the label `feat`

#### Scenario: Scoped maintenance title
- **WHEN** a pull request titled `chore(openspec): archive demo-change` is opened
- **THEN** it carries the label `chore`

#### Scenario: Retitled pull request
- **WHEN** a pull request's title is edited from `chore: tweak` to `fix: tweak`
- **THEN** it carries the label `fix` after the edit and no longer carries `chore`

#### Scenario: Hand-added labels survive a retitle
- **WHEN** a pull request opened as `feat: new export` carries `major` added by hand and is retitled `fix: new export`
- **THEN** it carries `fix` and `major`, and not `feat`

#### Scenario: Fork pull request
- **WHEN** a pull request is opened from a fork
- **THEN** it is labelled the same way and no code from the fork is executed

### Requirement: A draft release is kept current
Each push to `main` SHALL create or update a single draft GitHub release whose notes list every pull request merged since the last published release as `- <title> @<author> (#<number>)`, grouped under **Features** (`feat`), **Bug Fixes** (`fix`), **Maintenance** (`chore`, `refactor`, `style`, `perf`, `test`, `ci`, `build`) and **Documentation** (`docs`); pull requests with none of these labels SHALL still be listed. The draft's name and tag SHALL be `v<major>.<minor>.<patch>`, resolved from the last published release: a `major` label bumps major, otherwise any `feat` bumps minor, otherwise patch. Updating the draft MUST NOT publish it, create a git tag or build anything.

#### Scenario: Merged fix after a feature
- **WHEN** the last published release is `v0.3.1` and pull requests labelled `feat` and `fix` have been merged since
- **THEN** the draft is named and tagged `v0.4.0` and lists the first under Features and the second under Bug Fixes

#### Scenario: Only maintenance merged
- **WHEN** the last published release is `v0.3.1` and only a `chore` pull request has been merged since
- **THEN** the draft is tagged `v0.3.2`

#### Scenario: Breaking change marked by hand
- **WHEN** a merged pull request since `v0.3.1` carries the label `major`
- **THEN** the draft is tagged `v1.0.0`

#### Scenario: Draft stays a draft
- **WHEN** a pull request is merged to `main`
- **THEN** the draft release is updated, no release is published and no tag is pushed

### Requirement: Publishing a release attaches verified binaries
When a release whose tag starts with `v` is published, the release workflow SHALL build the single binary from that tag for `darwin-arm64`, `darwin-x64`, `linux-x64` and `linux-arm64`, each on a runner of that platform, and SHALL attach them to the release as `spec-control-<tag>-<platform>`. From the same tag it SHALL also build the macOS desktop app (`desktop-app` capability) for `darwin-arm64`, bundling the `darwin-arm64` binary built in the same run, with an ad-hoc code signature and without notarisation, and SHALL attach it as `Spec-Control-<tag>-darwin-arm64.dmg`. A `SHA256SUMS` file SHALL cover every attached binary and disk image. Each binary and disk image SHALL have a GitHub build-provenance attestation. Before anything is attached, each binary MUST run successfully with `--help`, and `--version` MUST print exactly the release tag; the binary inside the app MUST likewise print exactly the release tag, the app in the disk image MUST pass a strict, deep verification of its code signature, and the disk image MUST hold the installer layout of the `desktop-app` capability (the `Applications` link, the background and Finder's layout file). If any platform fails to build or verify, nothing SHALL be attached. After attaching, the workflow SHALL append to the release notes a section naming the downloads, showing how to verify a download's checksum and attestation, and saying that the app and the macOS binaries are not notarised and how to open them. A draft release, or a release whose tag does not start with `v`, SHALL trigger no build. The workflow SHALL need no Apple account, signing certificate or other signing credential, and no secret beyond the token GitHub provides to the run.

#### Scenario: Publishing the draft
- **WHEN** the maintainer publishes the draft release `v0.4.0`
- **THEN** the release gains `spec-control-v0.4.0-darwin-arm64`, `-darwin-x64`, `-linux-x64`, `-linux-arm64`, `Spec-Control-v0.4.0-darwin-arm64.dmg` and `SHA256SUMS`, each binary and disk image has a provenance attestation, and the notes end with download and verification instructions

#### Scenario: Version mismatch blocks the upload
- **WHEN** a binary built for release `v0.4.0` prints anything other than `v0.4.0` for `--version`
- **THEN** the workflow fails and no file is attached to the release

#### Scenario: One platform fails
- **WHEN** the `linux-arm64` build fails while the others succeed
- **THEN** no binary, no disk image and no `SHA256SUMS` are attached

#### Scenario: Broken app signature blocks the upload
- **WHEN** the app in the disk image fails `codesign --verify --deep --strict`
- **THEN** the workflow fails and nothing is attached to the release

#### Scenario: Unstyled disk image blocks the upload
- **WHEN** the disk image the `desktop` job built has no background or no Finder layout file
- **THEN** the workflow fails and nothing is attached to the release

#### Scenario: No signing secrets
- **WHEN** the repository has no Apple certificate, API key or other signing secret configured and a release is published
- **THEN** the app is built, verified and attached like the binaries

#### Scenario: Checksums match
- **WHEN** a user downloads a binary or disk image and `SHA256SUMS` from a release and runs `shasum -a 256 -c` on the line for that file
- **THEN** the check passes

#### Scenario: Non-version tag
- **WHEN** a release tagged `nightly-test` is published
- **THEN** the release workflow builds nothing and attaches nothing

### Requirement: The binary reports its version
`spec-control --version` SHALL print the version the binary was built as and exit with status 0 without starting the server, opening a browser or reading configuration. A binary built by the release workflow SHALL report its release tag (for example `v0.4.0`); any other build, including `bun run dev` and a local `bun run build`, SHALL report `dev`, unless the build was given a version in `SPEC_CONTROL_VERSION` (or, for one release, the former `OPENSPEC_DASHBOARD_VERSION` when `SPEC_CONTROL_VERSION` is unset), which the release workflow sets to the tag. The `--help` output SHALL list `--version`.

#### Scenario: Release binary
- **WHEN** the binary attached to release `v0.4.0` is run with `--version`
- **THEN** it prints `v0.4.0` and exits 0

#### Scenario: Local build
- **WHEN** a contributor runs `bun run build` and then `./dist/spec-control --version`
- **THEN** it prints `dev` and exits 0

#### Scenario: No side effects
- **WHEN** `--version` is passed
- **THEN** no port is bound, no browser is opened and nothing under `~/.spec-control/` or `~/.openspec-dashboard/` is written or moved

#### Scenario: Build as a given version
- **WHEN** a contributor runs `SPEC_CONTROL_VERSION=v1.2.3 bun run build` and then `./dist/spec-control --version`
- **THEN** it prints `v1.2.3` and exits 0

### Requirement: Releasing is documented
`CONTRIBUTING.md` SHALL describe how a release is made — labels come from pull request titles, the draft is updated on every merge to `main`, the maintainer reviews and publishes it, publishing builds and attaches the binaries and the macOS app (Apple silicon only; Intel Macs use the binary), and a `major` label forces a major bump — and that the macOS app is ad-hoc signed and needs no signing secrets. `README.md` SHALL point to the releases page for downloading the macOS app or a binary, including how to verify a download, that neither the macOS app nor the macOS binaries are notarised, how to open the app the first time (removing the quarantine attribute, or **Open Anyway** in System Settings → Privacy & Security), and how to update: Spec Control announces a newer release with a banner unless the user turned **Check for new versions** off in Settings → Updates (or set `updateCheck: false`), the check sends nothing but one request to the releases page, and a new version is installed by quitting Spec Control (or the app), replacing the binary or dragging the new app over the old one in Applications, and starting it again — settings, sessions and worktrees stay in `~/.spec-control/`. The update banner's How to update link SHALL point to that part of the README.

#### Scenario: Contributor looks for how to release
- **WHEN** a contributor reads `CONTRIBUTING.md`
- **THEN** a Releasing section explains the draft, the version rules, that publishing the draft is the only manual step, and that the macOS app job needs no secrets

#### Scenario: User wants a binary
- **WHEN** a user reads the **Run** section of `README.md`
- **THEN** it links to the releases page, offers the macOS app first on Apple silicon Macs and the binary on Intel Macs, and explains checksum verification, the quarantine workaround for both the app and the bare binary, and how to update the app and the binary

#### Scenario: macOS refuses to open the downloaded app
- **WHEN** a user drags the app from `Spec-Control-v0.4.0-darwin-arm64.dmg` to Applications and macOS says it cannot verify the app
- **THEN** the README's Run section tells them how to open it anyway, with the `xattr` command and the System Settings route

#### Scenario: User follows How to update
- **WHEN** a user follows the banner's How to update link
- **THEN** the README explains how to replace the app or the binary, that their data stays in `~/.spec-control/`, what the check sends, and how to turn it off
