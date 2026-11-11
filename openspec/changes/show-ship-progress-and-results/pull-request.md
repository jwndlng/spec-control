# Ship progress and results

Ship records server-observed stages and outcomes in the session, including verified commit, push, and created or reused pull request details. The panel acknowledges Ship immediately, prevents duplicate requests, retains results across reloads, links the pull request, and offers retry after failure or an unknown remote outcome. In the Console tab, Ship stays prominent with a plain-language explanation; secondary actions are collapsed and grouped by pull request, change, and session. The demo and Help describe the flow.

Checks:

- `bun run check` — passed (2,356 tests across 187 files; 0 failures; 13,330 assertions). Lint emitted 202 warnings and 2 infos.
- `bun run build:demo` — passed.
- `bun test test/agentSessions.test.ts test/shipPreflightUi.test.tsx test/sessionPanelUi.test.ts test/pullRequests.test.ts test/demoSessions.test.ts` — passed (107 tests, 0 failures).
- `openspec validate show-ship-progress-and-results --json` — valid; reports an existing `.openspec.yaml` warning for the `spec-control` metadata key.
- `git diff --check` — passed.

Manual demo review remains: open `dist/demo/index.html` and confirm the Ship explanation and grouped action menu are easy to follow. Chrome review was stopped before inspection could be completed. Task-preflight cancellation is inapplicable: the predecessor Ship contract explicitly removes task-specific Ship confirmation.
