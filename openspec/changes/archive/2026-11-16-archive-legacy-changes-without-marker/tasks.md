# Tasks

## 1. Create metadata for legacy changes

- [x] 1.1 Resolve metadata paths from existing active or archived change directories and exclusively create a missing branch marker after verifying its parent path; cover missing-marker, existing-marker, and symlink behavior in `test/specFrameworks.test.ts`.

## 2. Verify deterministic Archive

- [x] 2.1 Add a regression case that archives a complete markerless change, confirms the archived worktree marker records `archive-branch`, and confirms no marker is added to the main checkout.
- [x] 2.2 Run `openspec validate archive-legacy-changes-without-marker` and `bun run check`; resolve any failures.
