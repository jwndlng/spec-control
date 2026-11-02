# Tasks

## 1. Framework Branch Recording and Archive Helpers

- [ ] 1.1 Add a pure `setRecordedBranchInMarker(text, key, branch)` helper in `src/server/frameworks/openspec/marker.ts` that sets `branch` or `archive-branch` under `spec-control:` while preserving existing keys, comments, and the other branch entry, and verify with unit tests in `test/openSpecMarker.test.ts` covering fresh files, existing maps, idempotent updates, and malformed inputs.
- [ ] 1.2 Expose `recordBranchInMetadata` and worktree metadata/archive path helpers on `SpecFrameworkModule` (`src/server/frameworks/framework.ts`) and `openSpecModule` (`src/server/frameworks/openspec/index.ts`), and implement non-symlink-following atomic `.openspec.yaml` updates inside managed session worktrees; verify with tests in `test/specFrameworks.test.ts`.

## 2. Server-Side Git Write and GitHub CLI Helpers

- [ ] 2.1 Add deterministic worktree git helpers in `src/server/gitWrite.ts` (`commitWorktreeAll`, `pushWorktreeBranch`, `cherryPickWorktreeCommit`, and `abortWorktreeCherryPick`) with repository hooks disabled (`core.hooksPath` pointed at the empty hooks folder, `--no-verify`, `gc.auto=0`, and masked credentials), and verify with unit tests in `test/gitWrite.test.ts`.
- [ ] 2.2 Add `createPullRequest` (`gh pr create --repo <owner/name> --head <branch> --base <defaultBranch> --title <title> --body <body>`) and `mergePullRequest` (`gh pr merge <number> --repo <owner/name> --squash --match-head-commit <headOid>`, never passing `--delete-branch` or `--auto`) in `src/server/gh.ts`, running in the dashboard home without a shell, and verify with unit tests in `test/pullRequestsApi.test.ts`.

## 3. Deterministic Ship, Auto-Ship on Session Exit, and Deterministic Merge

- [ ] 3.1 Update `src/server/sessions/agents.ts` and `src/shared/agentDefaults.ts` to remove prose branch-recording (`recordInstruction`), `Ship`, Conventional Commits, and docs auto-merge suffixes from `Draft`, `Archive`, and `Fast-forward` prompts, move previous preset Archive prompts into `FORMER_PRESET_PROMPTS`, and verify prompt composition and config upgrade behavior in `test/agentSessions.test.ts`.
- [ ] 3.2 Rework `shipSession` in `src/server/sessions/manager.ts` and `POST /api/sessions/<id>/ship` in `src/server/api.ts` to execute deterministically on the server (record branch in `.openspec.yaml`, stage and commit uncommitted worktree changes with a convention-aware title, push branch to `origin`, open or reuse the GitHub pull request, refresh the PR cache, and record `autoMergeAskedAt` when docs-only auto-merge applies) without starting or typing into an agent, and verify in `test/agentSessions.test.ts`.
- [ ] 3.3 Add post-exit automatic `Ship` in `SessionManager` (`src/server/sessions/manager.ts`) when a managed `Draft` session on `docs/<change>` (with `autoMergeDocs` on and all required artifacts `done`), an `Archive` session (once the archive directory exists or duplicate directory is removed), or a `Fast-forward` session (once all tasks are `done` or `awaiting`) exits with code `0`, and verify with session lifecycle tests in `test/agentSessions.test.ts`.
- [ ] 3.4 Rework `mergeSessionPullRequest` (`POST /api/sessions/<id>/merge`) and `requestReadyMerges` in `src/server/sessions/manager.ts` to merge ready pull requests directly via `mergePullRequest` (`gh pr merge --match-head-commit`) for both `running` and `exited` sessions, retiring `handedOverProposal` and `proposalHandoverSentence`, and verify in `test/agentSessions.test.ts` and `test/pullRequestsApi.test.ts`.

## 4. Zero-Token Archive, Carry-Over Archive, and Identical Duplicate Removal

- [ ] 4.1 Update `openSession` in `src/server/sessions/manager.ts` so `action: "archive"` on a `Done` change with `subState === "complete"` and `specsSynced !== false` moves `openspec/changes/<change>` to `openspec/changes/archive/<YYYY-MM-DD>-<change>` in the `chore/archive-<change>` worktree, records `archive-branch`, and ships deterministically without spawning an agent process (while still starting the agent when `specsSynced === false` or `subState === "validate"`), and verify in `test/agentSessions.test.ts`.
- [ ] 4.2 Update `carryOverArchive` in `src/server/sessions/manager.ts` to run `cherryPickWorktreeCommit` in the `chore/archive-<change>` worktree and ship deterministically without an agent when the cherry-pick succeeds cleanly and touches only `openspec/`, falling back to aborting the cherry-pick and starting the agent session only on conflict; verify in `test/staleChanges.test.ts`.
- [ ] 4.3 Update `removeDuplicate` in `src/server/sessions/manager.ts` so a duplicate with `differingCount === 0` deletes `openspec/changes/<change>` (after `lstat` symlink checks) in the `chore/archive-<change>` worktree and ships deterministically without an agent, while `differingCount > 0` starts the agent session as before; verify in `test/staleChanges.test.ts`.

## 5. UI Updates and What's New

- [ ] 5.1 Update the session panel, Kanban card actions, and Settings copy in `src/ui/` so **Ship** and **Merge** reflect direct server execution (available on ended sessions as well as running ones) and update UI tests in `test/ui.test.ts` and `test/invariants.test.ts` to pass `bun test` and `bun run typecheck`.
- [ ] 5.2 Add a What's new entry at the top of `src/ui/changelog.ts` describing deterministic server-side branch recording, Ship, Merge, and zero-token Archive / Carry-over / Duplicate cleanup across all agents, and verify `test/changelog.test.ts` passes.
