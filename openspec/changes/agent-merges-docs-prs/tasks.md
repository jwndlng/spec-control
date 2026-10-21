# Tasks

## 1. Prompts and types

- [x] 1.1 Rewrite `AUTO_MERGE_DOCS_INSTRUCTION` and `AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION` in `src/shared/types.ts` (design D6): one line each, no "enable auto-merge", and both say do not merge and do not enable auto-merge. Update `test/shipAutoMerge.test.ts` and `test/agents.test.ts` so they assert that neither text asks for auto-merge and that the composition order is unchanged.
- [x] 1.2 Add `"merge"` to `PromptKey`, add `DEFAULT_MERGE_PROMPT` and the fixed Merge target sentence, and add `prompts.merge` (with its additional instructions) to the profile schema in `src/server/config.ts`. Verify that a config without it loads unchanged and that the preset upgrade tests still pass.
- [x] 1.3 Add `mergePrompt(agent, change, { pr, head })` to `src/server/sessions/agents.ts` (design D1). It validates `pr` and `head` and throws otherwise. Add `test/agents.test.ts` cases for the default prompt, a profile's own prompt with `{change}`, additional instructions, a bad SHA and a bad number.
- [x] 1.4 Add `mergeAsked?: { pr; head; at; submitted; by }` to `ChangeSession` and `headOid?` / `docsOnly?` to `PullRequest`. Verify with `bun run typecheck`.

## 2. Pull-request query

- [x] 2.1 In `src/server/pullRequests.ts`, request `headRefOid` on every `gh pr list` call. Request `files,changedFiles` only on the open call, and only when an enabled target of that GitHub repository has `autoMergeDocs` on (design D2). Extend `test/fixtures/fake-gh.ts` scenarios to record the requested fields, and assert in `test/pullRequests.test.ts` which calls asked for which fields.
- [x] 2.2 Parse `headOid` (40 hex characters or absent) and `docsOnly` (count matches the paths, at least one path, all under `openspec/`), and drop the paths. Cover in `test/pullRequests.test.ts`: docs-only, one file outside `openspec/`, 140 reported and 100 returned, `openspec-notes.md` / `docs/openspec/x`, missing fields, an old cache entry, and paths absent from the cache file and the API response.

## 3. Readiness and pending merge (shared)

- [x] 3.1 Add `mergePending(pr, mergeAsked)` to `src/shared/pullRequestReadiness.ts` (design D5): open, same number, same `headOid`. Cover merged, closed, new head and no record in `test/pullRequestReadiness.test.ts`.
- [x] 3.2 Add a `mergeReady(pr)` helper for the automatic rule: open, not draft, `mergeable`, checks `passing` (never `none`), docs-only, and has a head. Cover each failing condition, `checks: none` included, in the same test file.

## 4. Session manager and API

- [x] 4.1 Add `SessionManager.merge(id)` (manual, design D1/D4). It refuses when the session is not running, is in place, has no linked open ready pull request with a head in the last good list, or when sessions are disabled. Otherwise it submits `mergePrompt` through `submit`, writes `mergeAsked` with `by: "user"`, and reports a `session-merge` activity event. Add `POST /api/sessions/<id>/merge` in `src/server/api.ts` behind `crossSiteRefusal`. Test it in a new `test/mergePrompt.test.ts` with `fake-agent.ts`: submitted, typed but not confirmed (menu), ended session refused, not-ready refused, no `gh`/git process started.
- [x] 4.2 Add `SessionManager.requestReadyMerges(repoId, pullRequests)` (design D3/D4). It applies every condition of the "A ready docs-only pull request is handed to its agent to merge" requirement, uses the `merging` set taken before the first await, checks worktree HEAD equals `headOid` and runs `shipsOnlyOpenSpec`, writes `mergeAsked` (`by: "dashboard"`) before `submit`, and reports the event. Call it from `postPullRequestsRefresh` for every good list, next to `endMergedAutoMerge`. Test in `test/mergePrompt.test.ts`: the happy path, `checks: none`, not docs-only, draft, conflict, other base, HEAD ahead, a file outside `openspec/` only locally (a rename out of `src/`), seen again, a new head sent once, agent exited (nothing started), opt-in off, sessions disabled, a session without the record, a Fast-forward session, two concurrent completions sending once, and the demo.
- [x] 4.3 Extend `test/autoMergeCleanup.test.ts` with the full flow: Archive with the instruction, then a ready docs-only `#88`, then a Merge prompt, then `#88` merged in a later scenario, then the session ended and its worktree removed with the branch kept. Also check that `endMergedAutoMerge` is unchanged for a pull request merged without a Merge prompt.
- [x] 4.4 Record the Merge event in `src/server/activity/` (number, `by`, submitted). Verify it with an activity test that matches the "Merge sent on its own" scenario.
- [x] 4.5 Verify that `test/pullRequestsApi.test.ts` still proves that a refresh leaves every fixture repository byte-for-byte unchanged and starts only `gh pr list` / `gh api user`, now with a docs auto-merge repository and a pending Merge among the fixtures.

## 5. UI

- [x] 5.1 Make `watchPlan` in `src/ui/pullRequestsState.ts` take the sessions' pending merges, and treat a card whose pull request is `mergePending` as watched and in progress (design D5). Pass them in from the board. Cover in `test/pullRequestsState.test.ts`: a pending merge keeps the 60-second cadence while ready, and a new head, merged or closed ends it.
- [x] 5.2 Add the **Merge** action to the session panel's action list (`src/ui/sessionPanel.tsx`, `src/ui/api.ts`). Enable it under the spec's conditions, with the disabled reason in its tooltip and "Resume the session to merge." when the agent has ended. Show the D7 wording for a pending Merge and for typed but not confirmed. Show "asked the agent to merge #N" on the card. Verify in the panel/board UI tests.
- [x] 5.3 Update the Ship/Archive result wording in the panel ("will be handed back to the agent to merge once its checks pass"). Update the Docs auto-merge tooltip in `src/ui/projectSettings.tsx` / `src/ui/overview.tsx` as the project-overview delta says. Verify with the existing settings UI test, updated for the new text.
- [x] 5.4 Make sure the demo never sends or shows a pending Merge (`src/ui/demo/`). Verify with `test/demoSessions.test.ts`.

## 6. Docs and wrap-up

- [x] 6.1 Update CLAUDE.md: invariant 1's "whose agent the dashboard asked to enable auto-merge" wording, and the "Agent sessions" paragraph, so that Merge is described as a third prompt-only action and the agent no longer enables auto-merge. Check that no invariant gains a git/`gh` subcommand or a write.
- [x] 6.2 Add a What's new entry in `src/ui/changelog.ts`, and verify the changelog test passes.
- [x] 6.3 Run `bun run check`, then `bun run build`, and confirm in `dist/spec-control` that a refresh against a `fake-gh` scenario sends the Merge prompt into a fake-agent session (the compiled-binary rule).
- [~] 6.4 Manual check, left as `- [~]` for the user: on a free private GitHub repository with docs auto-merge on, archive a change. Confirm that the agent opens the pull request without enabling auto-merge, that the dashboard sends Merge once checks pass, that the pull request merges, and that the session ends with its worktree removed.
