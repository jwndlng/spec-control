# Proposal

## Why

The `label` job in `.github/workflows/pr-title.yml` runs release-drafter's autolabeler with the rules in
`.github/release-drafter.yml`. The autolabeler only ever **adds** the labels whose rules match; it never removes a
label whose rule no longer matches. A pull request opened as `feat: x` and retitled `fix: x` therefore carries both
`feat` and `fix`. Because the pull request is squash-merged under its final title, the draft release then lists a fix
under **Features** too, and the version resolver, which bumps minor for any `feat`, proposes `v0.4.0` where `v0.3.2` was
right. That breaks two requirements of `release-publishing`: "Pull requests are labelled from their title" (labelled
from *the* type in the title) and "A draft release is kept current" (grouped and versioned from those labels).

Confidence is medium on one point: the "adds only" behaviour is what release-drafter's autolabeler is documented and
known to do, but it was not re-read from the pinned v7.10.0 source while writing this proposal (no copy of it is on
this machine and nothing beyond this repository was fetched). Task 1.1 confirms it before anything is changed; if the
pinned version does remove stale labels, the change shrinks to the spec scenario and a test pull request.

## What Changes

- **The label job also removes type labels the title no longer has.** After the autolabeler, a step in the same job
  removes from the pull request every Conventional Commit type label (`feat`, `fix`, `docs`, `chore`, `refactor`,
  `test`, `style`, `ci`, `build`, `perf`) other than the one its current title's type names. It uses the `gh` CLI the
  runner already has, with the job's own token, the pull request number and title taken from the event payload through
  environment variables (never interpolated into the script), and checks out nothing.
- **Other labels stay.** `major`, `dependencies` and every other label that is not a type label are never removed. A
  type label added by hand that disagrees with the title is removed: the title is what is squash-merged, so it decides
  the type.
- **Permissions and pinning are unchanged.** The job keeps `pull-requests: write` alone, the autolabeler stays pinned to
  its commit SHA, and no new third-party action is added.
- The requirement "Pull requests are labelled from their title" states that a pull request carries only its current
  type's label.

## Impact

- `.github/workflows/pr-title.yml` — one step added to the `label` job.
- `.github/release-drafter.yml` — the comment above `autolabeler:` notes that stale type labels are removed by the
  workflow; the rules are unchanged.
- Specs: `release-publishing` (MODIFIED "Pull requests are labelled from their title").
- No source, test or CLAUDE.md change. No in-flight change or open pull request touches `.github/`.
