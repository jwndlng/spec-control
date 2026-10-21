# Tasks

## 1. CI workflow

- [x] 1.1 In `.github/workflows/ci.yml`, add `workflow_dispatch` and give `pull_request` and `push` the
      `paths-ignore: ['openspec/**', '*.md']` filter, with a comment explaining why it is safe and that a
      path-detection job would replace it if required checks are added. Verify `pull_request`, `push: main` and
      `workflow_dispatch` are present and that only the first two carry the filter.
- [x] 1.2 Replace the fixed `os` matrix with the event-based expression from design decision 1, and update the matrix
      comment to say macOS runs on `main` and on manual dispatch. Verify with `actionlint .github/workflows/ci.yml` if it
      is installed; otherwise check that the YAML parses (`bun -e 'Bun.YAML.parse(await Bun.file(".github/workflows/ci.yml").text())'`).
- [x] 1.3 Split `Lint, typecheck, test`: on Linux run `bun run check`; on macOS run `bun test`. Give the demo build and
      the clean-tree check `if: runner.os == 'Linux'`. Verify by reading the steps: macOS runs checkout, setup-bun, the
      version check, install, `Build UI`, `bun test`, the binary build and the smoke test, and nothing else.

## 2. Pages workflow

- [x] 2.1 Add the same `paths-ignore` to the `push` trigger in `.github/workflows/pages.yml`, leaving
      `workflow_dispatch` unfiltered. Verify the YAML parses and the deploy job's permissions are unchanged.

## 3. Documentation

- [x] 3.1 Update step 4 of `CONTRIBUTING.md`: pull requests run CI on Linux, macOS runs after each merge to `main`,
      run the `ci` workflow manually on the branch (`gh workflow run ci --ref <branch>`) before merging a change that is
      platform-sensitive, and documentation-only changes (`openspec/`, root Markdown) start no CI. Verify that no other
      line in `CONTRIBUTING.md`, `README.md` or `CLAUDE.md` still says every pull request runs on macOS
      (`grep -n -i macos`).

## 4. Verification

- [ ] 4.1 Run `bun run check` and confirm it passes, since no application code changes. Then push the branch and confirm
      the pull request shows only `check (ubuntu-latest)`.
- [ ] 4.2 Run `gh workflow run ci --ref feat/reduce-ci` and confirm the dispatched run shows both
      `check (ubuntu-latest)` and `check (macos-latest)`, with the macOS job skipping lint, typecheck, the demo build
      and the clean-tree check.
