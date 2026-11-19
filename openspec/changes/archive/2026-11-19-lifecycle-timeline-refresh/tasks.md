# Tasks

## 1. Timeline model and layout

- [x] 1.1 Model proposal, implementation, and archive PR checkpoints from their latest delivery and cached PR list; add focused tests for state mapping, legacy implementation fallback, and merged states.
- [x] 1.2 Rebuild the timeline rail with centered grid checkpoints, centered actions, horizontal draft milestones, and motion only for active work; verify via lifecycle timeline tests and review the rendered structure at narrow and wide widths.
- [x] 1.3 Add a What's new JSON entry for the lifecycle timeline improvements and verify the changelog loader accepts it.

## 2. Integration

- [x] 2.1 Wire phase delivery checkpoints and active session state into change detail; verify the detail tests cover merged Done, phase-specific PRs, and action placement.
- [x] 2.2 Run `bun run check` and resolve any failures.
