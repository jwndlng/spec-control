## Delivered

- Add a default-off **Show running** switch to combined and project boards. It matches repository and change name against running sessions, including archive, in-place, waiting and quiet agents.
- Keep the choice in `running=1`; Clear filters resets it while preserving layout. Existing search, repository, activity and archive rules still apply, with session updates changing membership through the existing session list.
- Update Help and add a What's new entry.

## Verification

- Passed: `bun run check` (lint, typecheck, 2,329 tests; zero failures). Lint reports warnings.

- Passed: 38 tests across `boardFilters`, `runningBoardUi`, `helpContent` and `whatsNew`, including rendered combined/project boards in path/hash routing, session updates, reload/remount, detail return targets, archive bounds/counts and clearing with sessions disabled. Synthetic sessions only.
- Passed: strict validation with the repository's `./node_modules/.bin/openspec`, `bun run build`, `bun run build:demo`, and compiled `dist/spec-control --version` (`dev`).
