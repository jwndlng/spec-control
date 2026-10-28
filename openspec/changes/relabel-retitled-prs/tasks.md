# Tasks

## 1. Confirm

- [x] 1.1 Confirm from the release-drafter v7.10.0 source at the pinned SHA that the autolabeler adds matching labels and never removes one; verify by citing the file and lines in the pull request description (if it does remove them, skip 2.1 and only open the test pull request of 3.1) — it only adds by default but has an opt-in `sync-labels` (`runner.ts` 57–106, `config.schema.ts` 24–29), so 2.1 uses that setting instead of a script (design D1)

## 2. Workflow

- [x] 2.1 Set `sync-labels: true` in `.github/release-drafter.yml` (design D1–D3), leaving the `label` job in `.github/workflows/pr-title.yml` with `pull-requests: write` as its only permission, no checkout and no new step; verify with `actionlint` showing the workflow is valid and the pinned `autolabeler/schema.json` listing `sync-labels`
- [x] 2.2 Update the comments above `autolabeler:` in `.github/release-drafter.yml` and on the `label` job; verify the rules are byte-for-byte unchanged with `git diff`

## 3. Check

- [~] 3.1 Open a throwaway pull request titled `feat: label test`, retitle it `fix: label test` and add a `major` label by hand; verify on its page that it ends with `fix` and `major` and without `feat`, then close it unmerged — **for you, after this change is merged**: the autolabeler reads its config from `main` (design D4), so it cannot be tested from this branch. Open the throwaway pull request, retitle it, add `major`, check that the `label` job's log says `Removed label 'feat'` and the page shows only `fix` and `major`, then close it unmerged
- [ ] 3.2 Run `bun run check`; verify it passes
