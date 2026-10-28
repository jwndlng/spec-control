# Proposal

## Why

The `label` job in `.github/workflows/pr-title.yml` runs release-drafter's autolabeler with the rules in
`.github/release-drafter.yml`. The autolabeler only ever **adds** the labels whose rules match; it never removes a
label whose rule no longer matches. A pull request opened as `feat: x` and retitled `fix: x` therefore carries both
`feat` and `fix`. Because the pull request is squash-merged under its final title, the draft release then lists a fix
under **Features** too, and the version resolver, which bumps minor for any `feat`, proposes `v0.4.0` where `v0.3.2` was
right. That breaks two requirements of `release-publishing`: "Pull requests are labelled from their title" (labelled
from *the* type in the title) and "A draft release is kept current" (grouped and versioned from those labels).

Task 1.1 read the pinned v7.10.0 source: by default the autolabeler only adds
(`packages/gh-actions/src/autolabeler/runner.ts`, lines 80–92), but it has an opt-in `sync-labels` setting
(`packages/autolabeler/src/config/config.schema.ts`, lines 24–29) that removes every label one of its rules names and
the current run did not select (`runner.ts`, lines 57–78 and 93–106). This repository never set it. So the change
turns that setting on instead of adding a script.

## What Changes

- **The label job also removes type labels the title no longer has.** `.github/release-drafter.yml` sets
  `sync-labels: true`, so the autolabeler removes from the pull request every Conventional Commit type label (`feat`,
  `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `ci`, `build`, `perf`) other than the one its current title's
  type names. The job is unchanged: no new step, no script, no checkout.
- **Other labels stay.** `major`, `dependencies` and every other label that no autolabeler rule names are never
  removed. A
  type label added by hand that disagrees with the title is removed: the title is what is squash-merged, so it decides
  the type.
- **Permissions and pinning are unchanged.** The job keeps `pull-requests: write` alone, the autolabeler stays pinned to
  its commit SHA, and no new third-party action is added.
- The requirement "Pull requests are labelled from their title" states that a pull request carries only its current
  type's label.

## Impact

- `.github/release-drafter.yml` — `sync-labels: true` with a comment above `autolabeler:`; the rules are unchanged.
- `.github/workflows/pr-title.yml` — the comment on the `label` job only.
- Specs: `release-publishing` (MODIFIED "Pull requests are labelled from their title").
- No source, test or CLAUDE.md change. No in-flight change or open pull request touches `.github/`.
