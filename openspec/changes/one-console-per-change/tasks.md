# Tasks

## 1. One running session per change (server)

- [x] 1.1 Make `open` in `src/server/sessions/manager.ts` refuse any action but Draft while a session on `docs/<name>` runs, with a reason naming the branch, unless the request carries `endProposal: true`; drop the "open beside it" path from `receivingSession`; verify with session tests using the fake agent
- [x] 1.2 With `endProposal`, apply every opening refusal first, then end the proposal session as End session does, wait for its exit, keep its worktree and branch, and open the requested action (Implement, Validate or Archive; never Draft or Fast-forward); refuse and start nothing when the agent does not end; verify that Implement starts on `feat/<name>` from `docs/<name>` and exactly one session runs
- [x] 1.3 Refuse Resume while another session of the same change runs; verify with a session test
- [x] 1.4 Accept `endProposal` in `src/server/api.ts` as a boolean only; verify with an API test

## 2. Proposal pull request handover (server)

- [x] 2.1 Extend `requestReadyMerges` to ended proposal sessions (record set, not `autoEnded`, worktree present): same checks on the proposal's pull request and worktree, prompt to the change's single running session, `mergeAsked` recorded on the proposal session; verify with fake-gh scenarios for ready, no running session, and seen again
- [x] 2.2 Add the fixed handover sentence naming `docs/<name>` after the Merge sentence (`src/server/sessions/agents.ts`); verify with a unit test of the composed line
- [x] 2.3 Let the manual Merge of the running session's panel target the ended proposal session's ready pull request; verify with a session test
- [x] 2.4 Verify that `endMergedAutoMerge` removes the proposal worktree and keeps the branch after the handover merge while the Implement session keeps running

## 3. Card and console (UI)

- [x] 3.1 Remove the proposal-session exception from `cardSessionControls`; verify the card shows the badge and no starter while a proposal session runs
- [x] 3.2 Add one pure helper in `src/ui/sessionState.ts` for the console's steps: what goes into the session, and for a proposal session the starters that end it first; use it in `SessionControls` and `sessionPanel.tsx`; verify with `test/sessionState.test.ts` that a proposal console in `Ready` recommends Implement
- [x] 3.3 Label those items as ending the proposal session, send `endProposal`, show the new session afterwards, and ask one confirmation when the proposal worktree is `uncommitted` or `unpushed`; verify with a state test of the confirmation rule
- [x] 3.4 Show Merge for the handed-over proposal pull request in the running session's panel; verify with a state test

## 4. Docs and verification

- [x] 4.1 Update the session and console sections of `src/ui/helpContent.tsx`
- [x] 4.2 Run `bun run check` and `bun run build`, and verify the compiled binary starts and serves the board
- [~] 4.3 In a project with docs auto-merge on, run Draft then Implement from the proposal's console end to end: one console at a time, the proposal pull request merged through the Implement session, its worktree removed (needs the user's repositories)
- [x] 4.4 Add a What's new entry at the top of `src/ui/changelog.ts`
