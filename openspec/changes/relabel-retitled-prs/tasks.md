# Tasks

## 1. Confirm

- [ ] 1.1 Confirm from the release-drafter v7.10.0 source at the pinned SHA that the autolabeler adds matching labels and never removes one; verify by citing the file and lines in the pull request description (if it does remove them, skip 2.1 and only open the test pull request of 3.1)

## 2. Workflow

- [ ] 2.1 Add the stale-label removal step to the `label` job in `.github/workflows/pr-title.yml` (design D1–D4), keeping `pull-requests: write` as the only permission and no checkout; verify with `actionlint` (or `gh workflow view`) showing the workflow is valid and a review of the step's `env:` showing no `${{ }}` inside `run:`
- [ ] 2.2 Update the comment above `autolabeler:` in `.github/release-drafter.yml`; verify the rules are byte-for-byte unchanged with `git diff`

## 3. Check

- [ ] 3.1 Open a throwaway pull request titled `feat: label test`, retitle it `fix: label test` and add a `major` label by hand; verify on its page that it ends with `fix` and `major` and without `feat`, then close it unmerged
- [ ] 3.2 Run `bun run check`; verify it passes
