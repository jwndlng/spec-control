## Summary

- OpenSpec Draft, Implement, Validate, and Archive sessions now resolve a checked-in workflow in the managed checkout or use a version- and capability-checked CLI fallback. Fallback instructions preserve the selected schema, change state, task tracking, and action boundaries. Missing support blocks launch with project setup guidance; the session panel and Help identify fallback mode.

## Checks

- `bun run check` passed: lint (210 warnings, 2 infos), typecheck, and 2,425 tests.
- Focused workflow, Help, changelog, proposal-session, and Archive prompt tests passed (42 tests); compiled terminal/API smoke passed (1 test).
- Codex CLI 0.167.2 and Antigravity CLI 1.5.9, both with OpenSpec CLI 1.15.0, completed the implement fallback in disposable repositories and verified their requested files and task markers. Antigravity required sign-in, workspace trust, and file-read approvals.
