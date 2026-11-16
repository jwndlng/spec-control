# Reviewer summary

Dismiss now stores a project-scoped change identity in the dashboard home and hides that change across its checkouts. Show dismissed reveals cards with Restore; work files, git state, dependencies, and running sessions remain intact. The former destructive operation is available separately as Delete change files with its existing safeguards. Help and the demo describe the reversible flow, and the What's new list has an entry.

Checks passed: `bun run check` (lint, typecheck, 2,376 tests); focused reversible dismissal API test; `bun run build:demo`; and `bun test test/whatsNew.test.ts` (8 tests). The full check also passed the scanner test that had timed out on an earlier run.
