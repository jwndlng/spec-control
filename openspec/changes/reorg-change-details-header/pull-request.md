## Change details

The header shows change-wide facts, including the source issue and a copyable path when a linked checkout supplies the artifacts. Pull requests link from their timeline checkpoints. Implementing shows the recorded model, and Console shows the selected session’s path and work status.

## Checks

- 163 focused tests passed across change detail, Console, PR timeline, demo, help and changelog coverage.
- `bun run build`, `bun run build:demo` and strict OpenSpec validation passed.
- Lint and typecheck passed within `bun run check`. Its latest test run failed 23 of 2,496 tests, including scanner, API, agent-session and GitHub-query failures. `bun run test:serial` passed 2,493 of 2,496 tests. Its three failures were fake GitHub issue-list tests, which passed alone (9/9).
