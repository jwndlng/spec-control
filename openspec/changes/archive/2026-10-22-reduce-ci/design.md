# Design

## Context

`ci.yml` has one `check` job with an `os: [ubuntu-latest, macos-latest]` matrix. It is triggered by `pull_request` and
by `push` to `main`, with `concurrency: ci-${{ github.ref }}` and `cancel-in-progress: true`. On a recent run the macOS
job spent 4m54s of its 5m11s in `bun run check`, almost all of it `bun test`. Every other step took about a second.
The matrix comment explains why macOS is there: it is the primary platform, and its file system is case-insensitive,
which some path-handling tests depend on.

`main` has no branch protection or ruleset, so no check is required. `pages.yml` runs on every push to `main`.
Nothing that is built or tested reads this repository's own `openspec/` tree or its root Markdown. Tests write their
own temporary trees or use `test/fixtures/`, and the build embeds only `dist/ui/index.html` and the OpenSpec schema
from `node_modules`.

## Goals / Non-Goals

**Goals:**
- Run macOS once per merged change instead of once per push to a pull request plus once per merge.
- Run no CI for changes that cannot affect the build: archives, proposals and README edits.
- Keep a way to run macOS on a branch before it merges.

**Non-Goals:**
- Making the test suite itself faster on macOS.
- Changing `release.yml`. It runs only when a release is published, and it is the gate for what users download.
- Adding required status checks or branch protection.

## Decisions

**1. macOS moves from pull requests to `push: main` and `workflow_dispatch`.** The matrix is built from the event:
```yaml
os: ${{ github.event_name == 'pull_request' && fromJSON('["ubuntu-latest"]') || fromJSON('["ubuntu-latest","macos-latest"]') }}
```
A pull request gets Linux only. A merge and a manual dispatch get both. The job name stays `check (<os>)`, so history
and any future required check keep the same name.
- *Alternative: a `ci:macos` label that turns macOS on for a pull request.* That needs the `labeled` event type, which
  re-runs the Linux job whenever any label changes, or a second workflow. A manual dispatch on the branch gives the same
  result without either.
- *Alternative: macOS only in `release.yml`.* That is cheapest, but a macOS-only regression would surface only when a
  release is published, possibly many merges later. Checking after each merge keeps the window to one merge.
- *Alternative: path filters that choose macOS for platform-sensitive files.* The case-insensitivity tests cover
  discovery, config and sessions, which is most of `src/server/`, so a filter would almost always pick macOS, and it
  could miss the cases that matter.

**2. On macOS, only the steps that can differ by platform run.** That is `bun test` (instead of `bun run check`), the
binary build and the smoke test. `Build UI` still runs first, because the server entry imports `dist/ui/index.html`.
Lint, typecheck, the demo build and the clean-tree check get `if: runner.os == 'Linux'`. They run on Linux for the
same commit in the same run, and none of them depends on the platform. This saves seconds rather than minutes, but
it keeps the macOS job's purpose clear.

**3. `paths-ignore` for documentation-only changes.** Both triggers in `ci.yml`, and `pages.yml`'s `push`, get:
```yaml
paths-ignore: ['openspec/**', '*.md']
```
In GitHub's filter syntax `*` does not match `/`, so `*.md` matches only Markdown at the root. Fixture Markdown under
`test/fixtures/` and `desktop/` documentation still run CI. A push or pull request that changes any other file still
runs everything, because `paths-ignore` skips a run only when *every* changed file matches. `workflow_dispatch` has no
path filter, so it always runs.
- *Alternative: a first job that detects changed paths and makes the others conditional.* That always reports a check,
  which would matter for required checks, but none exist. It also costs a runner start on every event.

**4. Concurrency is unchanged.** `ci-${{ github.ref }}` with `cancel-in-progress: true` already cancels a running
`main` run when the next merge lands. That run includes macOS, so a burst of merges runs macOS for the newest merge
only.

## Risks / Trade-offs

- [A macOS-only failure merges, and is found only on `main`] → The run on `main` fails visibly within about five
  minutes of the merge, and the fix is the next pull request. For a branch that is clearly platform-sensitive (paths,
  pseudo-terminals, `desktop/`), the maintainer or agent dispatches CI on the branch before merging. CONTRIBUTING says
  so.
- [A cancelled `main` run hides a macOS failure from an earlier merge] → The newer run tests a tree that contains the
  earlier merge, so a failure it introduced still shows, attributed to the later commit.
- [A file that later starts reading `openspec/` or root Markdown at build or test time] → The ignore list is in one
  place, next to a comment that says why it is safe. Anyone who adds such a dependency removes the entry.
- [If required checks are introduced later, a skipped run never reports] → The decision 3 alternative (a detection job)
  is the known fix. Noted in the workflow comment.

## Migration Plan

Merge the workflow change. The pull request that carries it changes `.github/`, so it runs CI on Linux. Its merge to
`main` runs on both platforms, which checks the new matrix expression. To roll back, revert the commit.
