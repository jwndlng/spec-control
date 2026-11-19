# Tasks

## 1. Put local progress in lifecycle checkpoints

- [x] 1.1 Remove the progress meter from the detail header, render artifact progress and milestones under Drafts and task progress under Implementing, and verify both checkpoint meters with lifecycle timeline tests.
- [x] 1.2 Update the detail header test to prove the meter is absent there and verify the focused detail and timeline test files pass.

## 2. Keep phase actions with their matching checkpoints

- [x] 2.1 Place Draft artifacts in Drafts while keeping Implement under Implementing when an optional artifact remains, center phase actions and completion confirmation, and verify action placement with lifecycle timeline coverage.
- [x] 2.2 Make the current phase marker visibly pulse and verify the reduced-motion rule and timeline styling remain intact.

## 3. User-facing release information

- [x] 3.1 Add a What's New entry describing progress and actions inside the lifecycle timeline, and verify the entry is valid with the changelog test.

## 4. Integration

- [x] 4.1 Run `bun run check` and verify the complete lint, typecheck, and test command succeeds.
