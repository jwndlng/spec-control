Removed the misplaced `## ADDED Requirements` heading from `dashboard-api`, restoring two permission requirements to OpenSpec parsing (48 → 50). The `agent-sessions` heading was already repaired on main; its seven permission requirements remain visible (66 total). Requirement and scenario text is unchanged.

Checks run:

- CLI list/show, requirement and scenario comparisons, archive-delta merge, repository sync comparison, and normal validation passed for both specs. Strict change validation passed; strict main-spec validation reported only long-requirement warnings (55 session, 44 API).
- `bun test test/scanner.test.ts`: 38 passed, 0 failed, including the three previously timed-out cases.
- `bun run check`: passed; lint, typecheck, and 2,320 tests passed (0 failed).
