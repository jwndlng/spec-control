# Pull request summary

Adds **Mark confirmed** for individual `[~]` tasks in change detail, with stale-file conflicts and refresh. Ship preflight also offers **Mark all complete and Ship** for verified, untruncated task files; the server rechecks the preflight version before writing and shipping. Checklist boxes remain read-only.

Checks run:

- Passed: focused task, API, Ship UI/session, detail, parser, and changelog suites — 100 tests, 707 expectations.
- Passed: `bun run typecheck` and `git diff --check`.
- Passed: `openspec validate tick-off-tasks-ui --json` (valid; it reports the existing ignored `spec-control` key warning in `.openspec.yaml`).
- `bun run check` did not pass: unrelated API test files failed to bind `127.0.0.1:0` with `EADDRINUSE`; the full suite did not complete. The focused API tests passed.
