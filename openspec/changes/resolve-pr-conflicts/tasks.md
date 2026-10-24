# Tasks

## 0. Before starting

- [x] 0.1 Rebase onto `main` once `record-change-pull-request` has merged, use its link rule (recorded branch → exact candidates; branches only, no recorded pull-request numbers) wherever this change says "linked pull request", and add a MODIFIED delta of "A pull request is linked to a change by its head branch" whose last paragraph names Resolve conflicts as the one action the link may affect; verify with `bunx openspec validate resolve-pr-conflicts --strict`

## 1. Pull-request list (server)

- [x] 1.1 Request `isCrossRepository` in `FIELDS` of `src/server/pullRequests.ts`, parse it defensively into `PullRequest.isCrossRepository?` (`src/shared/types.ts`); used only to refuse fork pull requests; verify with a `test/pullRequests.test.ts` case using `test/fixtures/fake-gh.ts` for true, false, missing and malformed values, and that no new `gh` subcommand runs

## 2. Conflict signal (shared)

- [x] 2.1 Add `src/shared/conflictSignal.ts` combining a worktree's work status and the linked pull request into `{ local?, github? }` per design D1, and verify with `test/conflictSignal.test.ts`: local only, GitHub only, both agreeing, both disagreeing (still offered, both shown), push pending (worktree `HEAD` differs from the cached head commit), neither, draft pull request, merged pull request, worktree on another branch

## 3. Starting on the head branch (server)

- [x] 3.1 Give `ensureWorktree` a start-point option: existing local branch checked out as is, else `git worktree add --track -b <head> <path> origin/<head>`, else a refusal before anything is created; verify with temp-repository tests that the branch's upstream is `origin/<head>`, that a behind local branch is checked out unchanged, and that a refusal leaves no directory, branch or config entry
- [x] 3.2 Accept `resolveConflicts: true` in `SessionManager.open` and `POST /api/sessions`: derive the pull request from the server's snapshot and cache, skip only the stage check, pick the session action and worktree by head branch, apply every refusal of the delta specs; verify with fake-agent session tests for the remote-only branch, the recorded off-convention branch, adoption of a linked worktree, and `409` refusals for fork (one-line reason), default branch, main-checkout branch, unknown branch, worktree or running session on another branch, and no signal
- [x] 3.3 Let `resolveConflicts(id)` accept the GitHub signal as well as the local one, refusing a session on another branch than the pull request's head; verify with a session test where only the cached pull request is `conflicting`
- [x] 3.4 Append the fixed pull-request sentence in `resolveConflictsPrompt` (number and branches re-validated, after additional instructions); verify with a unit test of the composed text with and without a pull request
- [x] 3.5 Prove no `gh` process and no `git fetch` is started by offering or using the action, with the recording remote and fake `gh` of `test/pull.test.ts` / `test/ghHelpers.ts`

## 4. Change detail and panel (UI)

- [x] 4.1 Show Resolve conflicts in the change detail (`src/ui/changeDetail.tsx`) from `conflictSignal`, with each signal's base and freshness wording of design D5 and the push-pending hint of D1, calling the session route for a running or ended session and `api.startSession` with `resolveConflicts` otherwise; keep the panel's action in `src/ui/sessionPanel.tsx` on the same rule; verify with a state test and `bun run check`
- [x] 4.2 Leave the card to `one-next-action-per-stage`; if that change has merged, wire its pull-request-driven step to the same `conflictSignal`; verify with its card state test

## 5. Docs and verification

- [x] 5.1 Update the Resolve conflicts help in `src/ui/helpContent.tsx`; verify with `bun run check`
- [x] 5.2 Run `bun run check` and `bun run build`, and verify the compiled binary starts a resolve-conflicts session on a pull request's head branch in a scratch repository with a fake remote
- [x] 5.3 Add a What's new entry at the top of `src/ui/changelog.ts`: Resolve conflicts now also follows GitHub's conflict report and works on the pull request's own branch when the worktree is gone; verify with `bun run check`
