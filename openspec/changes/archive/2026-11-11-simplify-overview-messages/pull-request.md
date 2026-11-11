Finish checks cards now hide internal agent instructions and raw fetch timestamps from routine content. A collapsed **PR freshness** disclosure shows relative age and the exact timestamp. Failed refreshes offer **Retry PR refresh**. The follow-up action still requires the agent to verify current PR evidence.

Updated Help, a fictional merged-PR demo example, and an independent What's new entry.

Checks run:

- Focused UI, server preflight, demo session and changelog tests: 49 passed.
- `bun run check`: lint, typecheck and all 2,323 tests passed (13,060 assertions).
- Demo build, binary build, OpenSpec validation, and `git diff --check`: passed.
