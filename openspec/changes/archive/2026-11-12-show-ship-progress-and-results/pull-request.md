# Ship progress and results

Ship immediately shows progress, reports server-observed stages, and keeps verified results across refreshes. Success links to the created or reused pull request; failures preserve verified work and offer a safe retry. In Console, Ship stays prominent with a plain-language explanation, while secondary actions are grouped under Pull request, Change, and Session. The demo and Help describe the flow.

Checks:

- `bun run check` — passed (2,379 tests across 192 files; 0 failures; 13,485 assertions). Lint emitted 206 warnings and 2 infos.
- `bun run build:demo` — passed; built `dist/demo/index.html` (1,281 KB).
- `openspec validate show-ship-progress-and-results --json` — valid; reports an existing `.openspec.yaml` warning for the `spec-control` metadata key.
- `git diff --check` — passed.
- GitHub PR checks (`conventional-title`, `label`) — passed.
- Demo visual review — user confirmed complete.
