# Design

## Context

`pr-title.yml` runs on `pull_request_target` (opened, edited, reopened, synchronize) with two jobs: the title check,
read-only, and `label`, the only job with a write scope, which runs the pinned autolabeler and checks out nothing. The
draft release (`draft-release.yml`, on push to `main`) sorts and versions merged pull requests by these labels.

## Decisions

### D1. Remove stale type labels in a `gh` step, not with another action

A `run` step after the autolabeler, using the preinstalled `gh` with `GH_TOKEN: ${{ github.token }}`. Inputs come from
the event payload through `env:` — `PR_NUMBER`, `PR_TITLE`, `PR_LABELS` (`toJSON` of the label names) and
`GITHUB_REPOSITORY` — so a title is never spliced into the script. The step extracts the type with the same pattern the
autolabeler rules use (`^([a-z]+)(\(.+\))?!?:`, case-insensitive, lowercased), and for each label in `PR_LABELS` that
is one of the ten type names and is not that type, calls `gh api -X DELETE
repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels/<name>`, treating a 404 (already gone) as success.

Rejected: `actions/github-script` (a new third-party pin for ten lines of shell); a labeler that syncs labels (the
`actions/labeler` sync option works on changed files, not titles); dropping the autolabeler for a script that both adds
and removes (keeps the change smaller and the rules in one config).

### D2. The payload's labels are the ones to check

The payload lists the labels as they were when the event fired. The autolabeler only adds the current type, which this
step keeps, so reading the payload rather than re-listing labels is enough; a label someone adds by hand between the
event and the step is handled on the next event.

### D3. Type labels belong to the title

A type label that disagrees with the title is removed even if a person added it, because the title is squash-merged and
is what the release notes print. Labels that are not type names — `major`, Dependabot's `dependencies` and
`github_actions`, anything else — are never touched. A title with no recognised type (which the title check already
fails) ends with no type label.

### D4. Keep the type list in one place where possible

The ten type names appear in the title check's `types`, in `release-drafter.yml` and now in the step. The step reads
them from a single `TYPES` variable with a comment pointing at the other two; generating them from one file is not
worth a checkout in a job that must not check out.
