# Tasks

## 1. Typed prompts (server)

- [ ] 1.1 Add `typedForm` to `src/server/sessions/agents.ts` and use it for `launchCommand`'s `typed` and for every prompt sent into a running session (design D1); verify with `test/agents.test.ts` (multi-line prompt typed as one line, argument prompt unchanged)
- [ ] 1.2 Make `SessionManager.submit` `async` so every refusal is a rejected promise (D2); verify with a `test/terminalSessions.test.ts` case that starts a profile without `{prompt}` whose typed prompt is refused and asserts the process keeps running and a second session is unaffected
- [ ] 1.3 Check the typed form with `validSubmission` before `start`/`restart` and before `session.action` or `autoMergeAskedAt` change in `open`, `prompt`, `ship`, `resolveConflicts` and `resume` (D1); verify with `test/sessionPrompt.test.ts` (sent Archive refused: action and auto-merge record unchanged, nothing typed) and `test/shipAutoMerge.test.ts` (resume-based Ship with an over-long prompt refused: no agent started)
- [ ] 1.4 Replace `{prompt}` inside an argument with a replacer function (D8); verify with a `test/agents.test.ts` case for `$&`, `` $` `` and `$'`

## 2. Starts and removals (server)

- [ ] 2.1 Add the per-change start lock and take it in `open`, `openToResolve`, every `restart` of a change session and the removal step of `close` and `endMergedAutoMerge`, re-running checks after acquiring it (D3); verify with `test/terminalSessions.test.ts` cases for two concurrent opens (one agent, same session returned) and two concurrent resumes (one process, none left after End)
- [ ] 2.2 Refuse worktree removal in `close` and `endMergedAutoMerge` while another session runs in the worktree, recording the reason (D4); verify with `test/autoMergeCleanup.test.ts` (merged pull request of an ended session whose worktree a running session reuses: worktree kept, running agent untouched, `autoEnded.removed` false with the reason) and an end-dialog case
- [ ] 2.3 Require `isCrossRepository === false` and the default branch as base in `endMergedAutoMerge` (D6); verify with `test/autoMergeCleanup.test.ts` scenarios for a fork's pull request, a missing `isCrossRepository` and another base, using `test/fixtures/fake-gh.ts`

## 3. Worktrees (server)

- [ ] 3.1 Verify a reused directory in `ensureWorktree` (`rev-parse --git-common-dir`, `symbolic-ref --quiet HEAD`), `"branch"` for new sessions and `"repository"` for restarts, refusals mapped to 409 (D5); verify with `test/worktree.test.ts` against temp git repositories (other branch, folder inside another repository, restart after a branch switch)

## 4. Console and Integrate (server)

- [ ] 4.1 Refuse `openConsole` and console resume while another agent runs in the console folder or an integration runs in a folder holding it, and refuse `openIntegration` while a session runs in or below the folder (D7); verify with `test/consoleSession.test.ts` and `test/integration.test.ts`

## 5. Wrap-up

- [ ] 5.1 Add a What's new entry at the top of `src/ui/changelog.ts`; verify with `bun run check`
- [ ] 5.2 Run `bun run check` and `bun run build`, and verify with the compiled binary that a profile without `{prompt}` and a multi-line Implement prompt starts, types the prompt as one line, and leaves the server running
