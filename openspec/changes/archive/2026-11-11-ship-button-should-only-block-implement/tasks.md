# Tasks

## 1. Task gating

- [x] 1.1 Keep unresolved or unknown tasks visible, but remove them as a blocker for explicit Ship when required
  artifacts are ready; retain the existing Implement and automatic implementation gates.
- [x] 1.2 Allow explicit Archive when required artifacts are ready regardless of unresolved task state, preserving task
  contents and existing automatic archive/merge eligibility rules.
- [x] 1.3 Extend focused API and UI tests to cover open, awaiting, unknown and complete task states across Implement,
  Ship and Archive.

## 2. Actionable Ship result

- [x] 2.1 Return the pull request URL and whether it was created or already existed from the Ship operation.
- [x] 2.2 Show a direct pull request link and unresolved-task context in the Ship result UI.
- [x] 2.3 Add an explicit follow-up route to review pull request feedback or resolve conflicts using existing agent
  actions; do not start an agent automatically from Ship.
- [x] 2.4 Test created, existing and unavailable pull request URL outcomes, including that Ship does not claim checks
  or tasks are complete.

## 3. Documentation and verification

- [x] 3.1 Update built-in Help and relevant demo behavior/data for the revised Ship and Archive flow.
- [x] 3.2 Run `bun run check` and verify task gating, PR result links and follow-up actions.
