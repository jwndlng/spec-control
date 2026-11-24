## Delivered

- The detail header shows change-wide facts and omits pull-request and session-specific status. Each delivery's pull request stays at its timeline checkpoint.
- The header shows the source checkout path when linked, and Implementing shows the recorded model. Console shows the selected session's path and work status.
- The offline demo uses the same timeline placement.

## Checks

- GitHub CI `check (ubuntu-latest)` passed on merge commit `76076db1`; the workflow runs `bun run check`.
- `bun run build` and `bun run build:demo` passed locally.
- A local `bun run check` rerun failed: 2,259 passed, 104 failed, 3 errors. Its log included local server startup failures and timeouts.
- 163 focused tests passed in prior verification runs.
- `openspec validate reorg-change-details-header --strict` currently exits nonzero on the `.openspec.yaml` `spec-control` metadata warning.
