# Contributing

This file describes how Spec Control itself is developed, by the maintainer and their agents. If you found a bug or
have an idea, please [open an issue](https://github.com/jwndlng/spec-control/issues) rather than a pull request.

Work in this repository is driven by [OpenSpec](https://github.com/Fission-AI/OpenSpec) changes under `openspec/changes/`.
One change = one branch = one pull request.

## Workflow

1. **Propose** — `/opsx:new` or `/opsx:propose` creates `openspec/changes/<change-name>/`. Commit the proposal as
   `docs(openspec): add <change-name>`.
2. **Branch** — name the branch after the change: `feat/<change-name>` (or `fix/<change-name>`, `chore/<change-name>`).
   The dashboard matches branches to changes by name, so this repository shows up correctly on its own board.
3. **Implement** — `/opsx:apply <change-name>`; tick tasks in `tasks.md` as they are done.
   A change that alters behaviour the built-in Help describes updates `src/ui/helpContent.tsx` as well.
   Feature detail goes into the Help and the spec, not the README: `README.md` changes only when a key feature, the
   global → project → change structure, the run steps or what the dashboard touches changes.
4. **Check** — `bun run check` (lint, typecheck, tests) must pass before pushing. CI runs the same command, plus the
   single-binary build, on Linux for every pull request, and the tests and the build again on macOS after each merge
   to `main`. Before merging a change that may behave differently on macOS (paths, pseudo-terminals, `desktop/`), run
   it there on the branch: `gh workflow run ci --ref <branch>`. A change that touches only `openspec/` or Markdown at
   the repository root starts no CI.
5. **Pull request** — the title follows [Conventional Commits](https://www.conventionalcommits.org/) and becomes the
   squash-commit subject. Do not push to `main` directly.
6. **Archive** — after merge, `/opsx:archive <change-name>` and commit as `chore(openspec): archive <change-name>`.

## Commit and PR titles

`<type>(<optional scope>): <summary>` with type one of `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`,
`ci`, `build`, `perf`.

```
feat(discovery): ignore paths and canonical repo identity
fix(scanner): read schema from the embedded copy in compiled binaries
docs(openspec): add dedupe-discovery
chore(openspec): archive kanban-dashboard-mvp, discover-on-root-change
```

## Working in parallel: one worktree per change

Several sessions (people or agents) have changes in flight at once, so nobody works in the main checkout. Each change
gets its own `git worktree` and branch:

```sh
git fetch origin
git worktree add .claude/worktrees/<change-name> -b feat/<change-name> origin/main
cd .claude/worktrees/<change-name> && bun install
# … edit, bun run check, commit, push, open the pull request …
git worktree remove .claude/worktrees/<change-name>      # after the merge
```

The main checkout stays on `main` and is only read from (and used to run the dashboard). Stay within the files your
change lists under **Impact** in its proposal; if you need to touch something another in-flight change owns, say so in
the proposal first. Agent sessions follow the same rule — see `CLAUDE.md`.

## Testing agent sessions

Tests must never start a real agent CLI or use the network. `test/fixtures/fake-agent.ts` is a small interactive program
(prints how it was started, echoes what is typed, `exit`/`crash` end it); session tests run it in real pseudo-terminals
against temp git repositories made from the synthetic fixtures, including the WebSocket that carries the terminal. If you
change how agents are started or relayed, also run the compiled binary once (`bun run build`): pseudo-terminals and
WebSockets must work inside the single executable.

## Demo site and screenshots

The [live demo](https://blog.wndlng.ch/spec-control/) is the real UI built with `bun run build:demo`: the
entry point `src/ui/demo/main.tsx` swaps the HTTP API for an in-memory one and switches to hash routing. It is
published from `main` by `.github/workflows/pages.yml`; nothing generated is committed.

- **Sample data is fiction, always.** `src/ui/demo/sampleData.ts` holds invented repositories under `/home/demo/` and
  invented change names. Never paste names or paths from a real dashboard; tests fail on anything shaped like a real
  home directory, in the sample and in the built demo.
- **A new API operation needs a demo implementation.** Add it to `interface Api` in `src/ui/api.ts` and type checking
  fails until `src/ui/demo/demoApi.ts` has it too. If it makes no sense without a server, reject with a clear message.
- **The URL goes through `src/ui/url.ts`.** Components never touch `location` or `history` directly (a test checks), so
  every view keeps working in both routing modes.
- **Screenshots come from the demo build only:** `bun run build:demo && bun run screenshots`. The script takes no URL
  on purpose. The README embeds the published ones, so they follow `main` on their own.
- **A new Settings panel is one entry in the `sections` array** in `src/ui/settings.tsx`; the navigation and the page are
  both rendered from it. Its `id` becomes part of the `?section=` deep-link contract (`src/ui/settingsSections.ts`).
- A new board feature is worth a sample change that shows it — the demo is the first thing a newcomer sees.

## Releasing

Releases are drafted from pull request titles; publishing the draft is the only manual step.

- **Labels come from titles.** The `label` job in `.github/workflows/pr-title.yml` labels every pull request with its
  Conventional Commit type (`feat`, `fix`, `docs`, `chore`, …), using the rules in `.github/release-drafter.yml`. A
  retitled pull request gains the new type's label; remove a stale one by hand if it matters for the notes.
- **The draft follows `main`.** Every merge updates one draft release (`.github/workflows/draft-release.yml`): the
  merged pull requests under Features, Bug Fixes, Maintenance and Documentation, and pull requests without one of
  those labels listed uncategorised.
- **The version comes from the labels**, counted from the last published release: any `feat` bumps the minor version,
  anything else the patch version. For a breaking change add the `major` label to its pull request by hand. Tags are
  `v<major>.<minor>.<patch>`; `package.json`'s `version` is not updated.
- **Publishing builds the binaries.** Review and tidy the draft, then publish it. `.github/workflows/release.yml` builds
  `spec-control` from the new tag on macOS (arm64, x64) and Linux (x64, arm64), checks that each binary runs and
  that its `--version` is the tag, and only if all four pass attaches them as `spec-control-<tag>-<platform>`
  with `SHA256SUMS`, build-provenance attestations and a Download section appended to the notes. If a platform fails,
  nothing is attached: fix it and re-run the workflow.
- **Publishing also builds the macOS app** (Apple silicon only; Intel Macs use the `darwin-x64` binary). The `desktop`
  job in the same workflow bundles the verified `darwin-arm64` binary into `Spec Control.app` with Electrobun
  (`desktop/`), ad-hoc signs it (`desktop/scripts/adhoc-sign.ts`), checks that the bundled binary's `--version` is the
  tag and that `codesign --verify --deep --strict` accepts the app in the disk image, checks that the disk image is
  laid out as an installer window (its `Applications` link, `.background/background.tiff` and Finder's `.DS_Store`,
  made by `desktop/scripts/style-dmg.ts`), and hands
  `Spec-Control-<tag>-darwin-arm64.dmg` to the publish job, which attaches it with the binaries. The app is not
  notarised, like the binaries, so the job needs no Apple account and no secrets. Electrobun still signs with a
  Developer ID and notarises when `ELECTROBUN_DEVELOPER_ID` and the App Store Connect key are set, but releases do not.
- **Building the app locally**: `bun run build:desktop` on an Apple silicon Mac builds the binary, then the app under
  `desktop/build/` and a `.dmg` under `desktop/artifacts/`. It is ad-hoc signed, like a release, and its disk image is
  laid out like a release's: `desktop/scripts/style-dmg.ts`, Electrobun's `postPackage` hook, copies the app out of
  Electrobun's image unchanged and has Finder lay out a new image around it, so Finder briefly opens a window. The first
  build asks to let the terminal control Finder (System Settings → Privacy & Security → Automation); keep the screen
  unlocked while it runs. It refuses while a volume named `Spec Control` is mounted, typically an image you opened:
  eject it and build again. A build with `ELECTROBUN_DEVELOPER_ID` keeps Electrobun's signed image unstyled.
  `desktop/` has its own `package.json` and lockfile; the Electrobun toolchain (Hutch) is pinned in
  `desktop/hutch.config.ts` and upgraded only in a change of its own.
- A local `bun run build` reports `dev`; set `SPEC_CONTROL_VERSION=v1.2.3` to build as a given version.

**What's new.** The dashboard carries its own, shorter changelog for the people running it: the **What's new** dialog,
read from `src/ui/changelog.ts` and compiled into the UI, so it needs no network. Every `feat` pull request whose change
users can see adds one entry at the top of that list, in the same pull request; internal `feat`s, fixes and chores do
not. An entry has an `id` of `<YYYY-MM-DD>-<kebab-case-slug>` (the merge date, never changed once released — browsers
remember which ids they have seen), that `date`, a short `title` and a one- or two-sentence Markdown `summary` that
says what users can now do and where to find it, in their words, not the pull request's. `test/whatsNew.test.ts` checks
the list's shape and order. This is not the release notes: those stay generated from pull request titles and list
every change for maintainers; the dialog links to them.

## Toolchain

Bun is pinned in `.bun-version` (and `packageManager`). Upgrading Bun is a deliberate commit of its own — the compiled
binary and text imports are version-sensitive — not something Dependabot does.

Package updates are manual for now (`bun update`, then `bun run check`): Dependabot cannot yet read the `bun.lock` format
Bun 1.4 writes. Dependabot does keep the GitHub Actions pins current.
