# Tasks

## 1. Branches and worktrees (server)

- [x] 1.1 Give `sessionBranch` and `worktreeName` the Draft-with-proposal case (`docs/<name>`, `docs-<name>`), decided from the repository's docs auto-merge setting when the session starts and kept on the session record; teach `changeOfWorktree` the `docs-` prefix; verify with unit tests of all three
- [x] 1.2 Let `ensureWorktree` take a start point and add a read-only check whether the default branch's tree holds `openspec/changes/<name>/` (`ls-tree`); choose Implement's start point as in design D4; verify with `test/worktree.test.ts` against temp git repositories for proposal merged, proposal unmerged, and no `docs/<name>`
- [x] 1.3 Restrict adoption so that `feat/<name>` sessions never adopt a `docs/<name>` worktree and Draft sessions on `docs/<name>` adopt only that branch; verify with a session test using the fake agent

- [x] 1.4 Let one other session of the change run beside a Draft session on `docs/<name>`: it receives Draft only (`receivingSession`, server and board alike), any other action opens its own session or goes to the other running one, sending a non-Draft action into it is refused, the card keeps its starters but Draft and Fast-forward, and Resolve conflicts prefers the running session on the pull request's branch; amend "Session lifecycle and control" in the delta spec; verify with session and board tests

## 2. Proposal instruction (server)

- [x] 2.1 Add `AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION` (both title variants) to `src/shared/types.ts` and compose it after the Draft prompt and its additional instructions; verify with a unit test of the composed text
- [x] 2.2 Append it on start and on sending Draft into the same session only for a Draft session on `docs/<name>` whose worktree passes `shipsOnlyOpenSpec(..., { allowEmpty: true })`, set `autoMergeAskedAt`, and report inclusion in the result; verify with session tests for included, worktree holding code, auto-merge off, Draft sent into an Implement session and Fast-forward
- [x] 2.3 Verify that `requestReadyMerges` and `endMergedAutoMerge` handle a proposal session unchanged with a test that lists the proposal pull request ready, then merged, and checks the Merge prompt, the ended session, the removed worktree and the kept branch

## 3. Pull-request link and board (shared, UI)

- [x] 3.1 Add `docs/<name>` to `candidateBranches` and expose whether the linked pull request is the proposal's; verify with `test/pullRequestLink.test.ts` for the three scenarios of "A proposal pull request is linked to its change"
- [x] 3.2 Label the badge and any derived recommended step as the proposal pull request on the card and in the detail header; verify with a render or state test
- [x] 3.3 Add `docs/<name>` to the exact branch list of `stale-means-archived-and-merged` if that change is archived first (otherwise that change adds it); verify with its stale tests — it was archived first, so `changeBranches` (`src/server/staleChanges.ts`) and the `stale-changes` delta add it
- [x] 3.4 Update help text and add a What's new entry at the top of `src/ui/changelog.ts`; verify with `bun run check`

## 4. Verification

- [x] 4.1 Run `bun run check` and `bun run build`, and verify the compiled binary starts and serves the board
- [x] 4.2 In a project with docs auto-merge on, run Draft artifacts end to end: the agent opens the proposal pull request, the dashboard asks it to merge once ready, and the session ends and its worktree is removed after the merge (needs the user's repositories)
