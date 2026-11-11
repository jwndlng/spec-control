# Ship progress and results

No implementation is included in this change yet. Ship progress, durable PR results, safe retry, demo/Help updates, and the What's new entry remain unverified; the required `ship-button-should-only-block-implement` predecessor is still in progress.

Checks run:

- `openspec validate show-ship-progress-and-results --strict` — valid; it reports an existing structural issue in the main `dashboard-api` spec that blocks applying/archiving that capability.
- `bun run check` — failed: lint reported 197 warnings and 2 infos, then typecheck could not find `bun-types` (`TS2688`); tests did not run.
