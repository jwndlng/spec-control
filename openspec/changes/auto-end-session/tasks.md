# Tasks

## 1. Configuration and session record

- [ ] 1.1 Add `endMergedSessions?: boolean` to `agentSessions` in `src/shared/types.ts`, validate it in `src/server/config.ts` (boolean or absent, `true` saved as absent, `400` naming the key otherwise); verify with config tests for `false`, absent and `"yes"`, and that saving triggers no scan
- [ ] 1.2 Add `agentStartedAt?: string` to `ChangeSession`, set it in the manager's `start()` and clear `autoEnded` there (D2, D4), reading `createdAt` when absent; verify with a manager test that resuming an auto-ended session clears `autoEnded` and sets `agentStartedAt`

## 2. Ending merged sessions

- [ ] 2.1 Rename `endMergedAutoMerge` to `endMergedSessions` and let it pick, per session, the auto-merge rule (unchanged) or the general rule when `endMergedSessions !== false` (D1); update the call in `src/server/api.ts`; verify the existing auto-merge tests still pass unchanged
- [ ] 2.2 Implement the general rule's checks: merged, same repository, default-branch base, merged after `agentStartedAt`, worktree not `uncommitted` and `HEAD` equal to `headOid` or status `merged` (D3), nothing recorded when they fail; verify with `fake-gh` scenarios for the archive merged by the user, the agent moved on, a pull request merged before a resume, a fork, another base, the setting off, in-place and adopted sessions
- [ ] 2.3 Verify the worktree is kept with the reason when another session runs in it, the branch and every other ref are unchanged, no fetch or extra `gh` runs, and nothing happens in the demo, with a test asserting the recorded git and `gh` invocations
- [ ] 2.4 Verify one `session-auto-ended` activity event is recorded for a general-rule end and no separate session-ended event, with an activity test

## 3. UI

- [ ] 3.1 Add the **End sessions whose pull request merged** checkbox with its hover description to the Agent sessions section of Settings, ticked when absent; verify with a settings state test that clearing saves `false` and ticking removes the key
- [ ] 3.2 Check that the ended notice and card badge read correctly for a session ended without auto-merge, adjusting `autoEndedText` only if it mentions auto-merge; verify with a `sessionState` test

## 4. Docs and release

- [ ] 4.1 Update `CLAUDE.md` invariant 1 and the Agent sessions notes so the automatic removal is no longer tied to Docs auto-merge, naming the setting; verify by reading it against the `dashboard-api` delta
- [ ] 4.2 Run `bun run check` and `bun run build`, and verify the setting and an automatic end work in `dist/spec-control` with a fake `gh`
- [ ] 4.3 Add a What's new entry at the top of `src/ui/changelog.ts` saying that sessions whose pull request merged now end on their own and where to switch it off; verify it shows in the What's new dialog
