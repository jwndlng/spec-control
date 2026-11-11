Remove the misplaced `## ADDED Requirements` heading from dashboard-api, restoring two permission requirements to OpenSpec parsing (48 → 50). Agent-sessions was already repaired on main; all seven permission requirements remain visible (66 total). Requirement/scenario text is unchanged.

Checks run:

- CLI list/show, byte comparisons, archived-delta merge and repository sync comparisons passed for both specs.
- OpenSpec 1.15.0 normal validation passed for both specs; strict change validation passed. Strict main-spec validation failed on long-requirement warnings only (55 session, 44 API), with no structural errors.
- Latest `bun run check`: lint/typechecking passed; 2,317 tests passed, three scanner tests timed out at 5,000 ms: `scans a fixture repo: artifacts, tasks, archive dates, columns`; `a change without a design is Ready: the spec-driven schema requires only tasks`; `unexpected change directory names are skipped with a warning`.
- Earlier full check: 2,319 passed, one scanner timeout. Separate scanner-file rerun: 38 passed, zero failures.

The required full repository check remains blocked by scanner timeouts; task 1.2 is unchecked.
