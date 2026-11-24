# Tasks

## 1. Header facts and session context

- [x] 1.1 Remove the PR presentation and availability message from DetailHeader and retire its unused helpers. Update change detail, board, PR UI and demo tests to verify the header omits PR details for linked, absent and unavailable PRs while the source issue, change labels, warnings, dependencies, copy reference and applicable change actions remain accessible.
- [x] 1.2 Remove session work status and the session-worktree path fallback from the header. Verify main and linked checkout cases, two sessions with distinct paths, and the gone-change header. Exercise the linked checkout’s copy button and the selected session’s path and status in Console.

## 2. Phase details

- [x] 2.1 Move the optional recorded model label to Implementing. Test its presence with a recorded model even without a phase action, and its absence when unset.
- [x] 2.2 Verify timeline and offline demo coverage for PR links at their own proposal, implementation and archive checkpoints, including a change with multiple deliveries. Check that the detail view opens without fetching PRs and retains eligible checkpoint actions.

## 3. Release and verification

- [x] 3.1 Add an independent What’s new JSON entry under `src/ui/changelog/entries/` describing where to find phase and session details.
- [x] 3.2 Verify the entry and integrated UI changes with `bun run check`. GitHub CI's `check (ubuntu-latest)` job ran `bun run check` on merge commit `76076db1` and passed. The local rerun on this checkout failed (2,259 passed, 104 failed, 3 errors); its log included local server startup failures and resulting timeouts.
