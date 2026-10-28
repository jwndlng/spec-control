# Design

## Context

`pr-title.yml` runs on `pull_request_target` (opened, edited, reopened, synchronize) with two jobs: the title check,
read-only, and `label`, the only job with a write scope, which runs the pinned autolabeler and checks out nothing. The
autolabeler reads `.github/release-drafter.yml` from the default branch. The draft release (`draft-release.yml`, on
push to `main`) reads the same file and sorts and versions merged pull requests by these labels.

## Decisions

### D1. Turn on the autolabeler's own `sync-labels`, not a script

The pinned v7.10.0 autolabeler has a `sync-labels` setting, off by default
(`packages/autolabeler/src/config/config.schema.ts`, lines 24–29). With it on, the runner lists the labels the pull
request carries now, and removes each one that some rule in the config names and that this run did not select,
comparing names case-insensitively (`packages/gh-actions/src/autolabeler/runner.ts`, lines 57–78 and 93–106).
`.github/release-drafter.yml` sets `sync-labels: true`.

That is exactly the requirement: the config's rules name the ten type labels and nothing else, so only those can be
removed. Because it reads the current labels rather than the event payload, a label added between the event and the job
is handled too.

Rejected: a `gh api -X DELETE` step after the autolabeler (the original plan, written before the source was read). It
would duplicate the setting with ten lines of shell, a second copy of the type list and an environment-variable dance
to keep the title out of the script. `actions/github-script` was rejected for the same reason, and for adding a new
third-party pin.

### D2. The drafter ignores the new key

`draft-release.yml` reads the same file, and its schema (`packages/core/src/config/config.schema.ts`) is a zod `object`,
which drops unknown keys. It already ignores `autolabeler:` the same way, so `sync-labels` changes nothing there.

### D3. Type labels belong to the title

A type label that disagrees with the title is removed even if a person added it, because the title is squash-merged and
is what the release notes print. Labels that no rule names — `major`, Dependabot's `dependencies` and
`github_actions`, anything else — are never touched. The config has no fallback rule, so a title with no recognised
type (which the title check already fails) ends with no type label.

### D4. Effective only after merge

The autolabeler fetches its config from the default branch, so the pull request that adds `sync-labels` is labelled
under the old rules. The test pull request of task 3.1 has to be opened after this change is merged.
