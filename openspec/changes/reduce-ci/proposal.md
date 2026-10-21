# Proposal

## Why

The `ci` workflow runs its whole job on `macos-latest` as well as on `ubuntu-latest`, on every push to every pull request
and again on every merge to `main`. The macOS job takes about five minutes, mostly `bun test`, against about two on
Linux, and macOS minutes cost the most. About half of the merged pull requests touch only `openspec/` (archives,
proposals), yet they also run the full matrix twice. The minutes go where nothing can break.

## What Changes

- **Pull requests run on Linux only.** The macOS job no longer runs for `pull_request` events. Linux still runs lint,
  typecheck, tests, the binary build and smoke test, the demo build and the clean-tree check on every pull request.
- **macOS runs once per merge, after the merge.** The macOS job runs on pushes to `main`, and on a manual dispatch for any
  ref, so a maintainer can request macOS for a risky branch before merging. The existing `cancel-in-progress` setting
  still lets a newer merge cancel an older macOS run that is still going.
- **macOS runs only what can differ on macOS.** On macOS the job runs the tests, the single-binary build and the smoke
  test. It skips lint, typecheck, the demo build and the clean-tree check, which do not depend on the platform and still
  run on Linux for the same commit.
- **Documentation-only changes start no CI.** `ci` (pull requests and pushes) and `pages` (pushes) ignore changes that
  touch only `openspec/**` or Markdown files at the repository root (`README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, …).
  Nothing that is built or tested reads those paths. Markdown under `test/fixtures/` is not ignored.
- The release workflow is unchanged: it builds and verifies on every platform for each published release.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `repo-hygiene`: the "Continuous integration gates every pull request" requirement changes. Pull requests are gated
  on Linux, macOS is checked on `main` after each merge and on manual dispatch, and documentation-only changes start no
  CI run.

## Impact

- `.github/workflows/ci.yml`: triggers, `paths-ignore`, the OS matrix and per-OS step conditions.
- `.github/workflows/pages.yml`: `paths-ignore` on its `push` trigger.
- `CONTRIBUTING.md`: the sentence saying CI runs on Linux and macOS for every pull request.
- `openspec/specs/repo-hygiene/spec.md` (on archive).
- No application code, tests or release workflow change. No status check is required on `main` today (no branch
  protection or ruleset), so a pull request whose CI is skipped is not left waiting on a check that never reports.
