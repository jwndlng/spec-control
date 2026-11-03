# Proposal: Agent Interoperability via Deterministic Server Actions

## Why

Using Spec Control feels noticeably different depending on which coding agent CLI is configured (Claude Code, Codex, Antigravity, or a custom CLI). Today, Spec Control delegates a large amount of deterministic git, file-marker, and GitHub CLI choreography to the agent by appending multi-sentence prose instructions to every prompt:

- Recording `spec-control.branch` or `spec-control.archive-branch` in `.openspec.yaml` (`recordInstruction`).
- Staging, committing, pushing the change branch, and opening a pull request via `gh` (`DEFAULT_SHIP_PROMPT`, `CONVENTIONAL_COMMITS_SHIP_SENTENCE`, `AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION`, `AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION`, `AUTO_MERGE_DOCS_INSTRUCTION`).
- Merging ready pull requests via `gh pr merge` (`DEFAULT_MERGE_PROMPT`, typed into a running PTY or handed over across sessions via `handedOverProposal`).
- Moving `openspec/changes/<change>` into `openspec/changes/archive/<YYYY-MM-DD>-<change>` even when delta specs are already synced (or absent) and all tasks are validated.
- Cherry-picking a stranded archive commit onto a fresh archive branch (`CARRY_OVER_ARCHIVE_PROMPT`) or deleting an active change directory that is already byte-for-byte identical to its archived copy (`REMOVE_DUPLICATE_IDENTICAL_SENTENCE`).

Different agents interpret these prompt suffixes inconsistently: they pause on different shell or file-permission confirmations, format commit subjects and PR titles differently, occasionally forget to record the branch in `.openspec.yaml`, or exit as soon as their slash command completes—before Spec Control can type a follow-up `Ship` or `Merge` prompt into the terminal. Even when an agent follows every instruction, spending LLM tokens and wall-clock turns on deterministic git and `gh` operations wastes time and quota.

Moving deterministic lifecycle steps out of agent prompts and into Spec Control's server makes every agent focus strictly on the creative work (drafting artifacts, implementing tasks, verifying requirements, syncing delta specs, and resolving genuine merge conflicts) while making branch recording, shipping, merging, and routine archive operations instantaneous, zero-token, and identical across all agents.

## What Changes

- **Deterministic `.openspec.yaml` branch recording**:
  - Extend `SpecFrameworkModule` with an optional `recordBranch(worktreePath, changeName, branch, field)` helper implemented by the OpenSpec module.
  - When Spec Control prepares a change worktree (or ships from it), the server writes `spec-control.branch` (or `spec-control.archive-branch` for archive sessions) directly into `openspec/changes/<change>/.openspec.yaml` (or the archived copy) using safe, non-symlink-following atomic file writes.
  - Retire `recordInstruction` from agent prompt assembly so agents no longer need to edit `.openspec.yaml` to link a change to its pull request.
- **Deterministic Ship (stage, commit, push, and `gh pr create`) — manual and automatic on session exit**:
  - `POST /api/sessions/<id>/ship` executes directly on the server in the session's managed worktree without starting, resuming, or typing into an agent terminal: it ensures the branch marker is recorded, stages and commits any uncommitted worktree changes via `gitWrite` (with hooks disabled and a deterministic commit subject matching the project's `prTitleConvention`), pushes the branch to `origin` via `gitWrite`, opens a pull request against the repository's default branch via `runGh` (`gh pr create`) if none is open yet for that head branch, and refreshes the repository's pull-request cache.
  - When a managed `Draft` session on `docs/<change>` (with `autoMergeDocs` enabled and all framework artifacts `"done"`), an `Archive` session on `chore/archive-<change>` (once `openspec/changes/archive/*-<change>` exists), or a `Fast-forward` session (once all tasks are `"done"` or `"awaiting"`) exits with status `0`, Spec Control automatically runs the deterministic Ship flow if the branch still has uncommitted changes, unpushed commits, or no open pull request.
  - Strip the prose `Ship` and `autoMergeDocs` git/PR choreography suffixes (`AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION`, `AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION`, `AUTO_MERGE_DOCS_INSTRUCTION`, and the `Fast-forward` ship tail) from agent prompts so agents stop once the artifacts or code changes are written.
- **Deterministic Merge (`gh pr merge --match-head-commit`) — manual and Docs auto-merge**:
  - Both manual `POST /api/sessions/<id>/merge` (and a change-level merge endpoint / action that works even after the session's agent has exited) and automatic Docs auto-merge (`requestReadyMerges`) execute `gh pr merge <number> --repo <owner/name> --match-head-commit <headOid>` directly on the server via `runGh` (using `--squash` by default,never passing `--delete-branch`) instead of typing `DEFAULT_MERGE_PROMPT` into an agent PTY.
  - Retire `handedOverProposal` and `proposalHandoverSentence` because Spec Control can merge a passing `docs/<change>` pull request directly before or during the `Fast-forward` / `Apply` worktree setup without asking the implementation agent to merge the docs PR first.
- **Deterministic Archive, Carry-Over Archive, and Identical Duplicate Removal**:
  - **Zero-token Archive when already synced**: When `POST /api/sessions` with `action: "archive"` targets a change in `Done` (`subState === "complete"`, no `- [~]` tasks) whose delta specs do not require agent syncing (`specsSynced !== false`, i.e. no delta specs, `skip_specs: true`, or delta specs already reflected in `openspec/specs/`), Spec Control performs the archive deterministically in the `chore/archive-<change>` worktree (moves `openspec/changes/<change>` to `openspec/changes/archive/<YYYY-MM-DD>-<change>`, records `spec-control.archive-branch`, commits, pushes, and opens the archive PR) without spawning an agent session. When `specsSynced === false` or `subState === "validate"`, Spec Control starts the agent session as before so the agent can sync delta specs or validate tasks, and then auto-ships on clean exit.
  - **Zero-token Stranded-Archive Carry-Over**: When `action: "carry-over-archive"` is triggered, Spec Control prepares the `chore/archive-<change>` worktree and runs `git cherry-pick <commit>` via `gitWrite`. If the cherry-pick succeeds cleanly and touches only paths under `openspec/`, Spec Control ships the archive PR deterministically without starting an agent; only if `git cherry-pick` hits a conflict does Spec Control abort/leave the conflict for an agent session to resolve.
  - **Zero-token Identical Duplicate Removal**: When `action: "remove-duplicate"` is triggered and `differingCount === 0` (every file in `openspec/changes/<change>/` matches the archived copy), Spec Control deletes `openspec/changes/<change>/` in the archive worktree, commits, pushes, and opens the cleanup PR without starting an agent; when `differingCount > 0`, it launches the agent session to reconcile the differences as today.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `agent-sessions`: Replace prompt-injected git/PR/merge/branch-marker instructions with deterministic server-side operations; auto-ship on clean exit for completed Draft (under `autoMergeDocs`), Fast-forward, and Archive sessions; run Archive, Carry-over-archive, and identical Remove-duplicate without spawning an agent when no LLM reasoning is required; execute Ship and Merge directly on the server instead of typing into an agent PTY.
- `dashboard-api`: Update `POST /api/sessions/<id>/ship`, `POST /api/sessions/<id>/merge`, and `POST /api/sessions` (for deterministic archive / carry-over-archive / remove-duplicate completion) so server-side git and `gh` actions return updated session and pull-request state directly without requiring a running agent process.
- `pull-requests`: Execute Docs auto-merge and manual Merge directly via `runGh` (`gh pr merge --match-head-commit <headOid>`) and create pull requests via `runGh` (`gh pr create`), independent of whether an agent session is still running.
- `spec-frameworks`: Add deterministic branch-marker writing (`recordBranch`) and archive directory move helpers to `SpecFrameworkModule` / `openSpecModule`, and drop `recordInstruction` from agent prompt composition.
- `stale-changes`: Execute stranded-archive carry-over (`cherry-pick`) and identical duplicate removal (`differingCount === 0`) deterministically on the server when no merge conflict or file divergence exists, falling back to an agent session only when conflict resolution or spec reconciliation is needed.

## Impact

- **Server (`src/server/`)**:
  - `src/server/gitWrite.ts`: Add deterministic helpers for `git add --all`, `git commit`, `git push`, `git cherry-pick`, and `git rm -rf` under existing path, symlink, credential-scrubbing, and hook-disabling (`core.hooksPath=/dev/null`) invariants.
  - `src/server/gh.ts`: Add `createPullRequest` (`gh pr create`) and `mergePullRequest` (`gh pr merge --match-head-commit`) helpers alongside `closePullRequest`, keeping `runGh` inside the neutral dashboard home directory with non-interactive env vars.
  - `src/server/frameworks/framework.ts`, `src/server/frameworks/openspec/index.ts`, `src/server/frameworks/openspec/marker.ts`: Replace prompt-level `recordInstruction` usage with server-side `recordBranch(...)` and deterministic archive directory relocation.
  - `src/server/sessions/agents.ts`, `src/server/sessions/manager.ts`: Simplify agent prompts by removing git/PR/branch-recording prose tails; implement server-side `shipSession`, `mergeSessionPullRequest`, post-exit auto-ship hooks, and zero-agent fast paths for synced `archive`, conflict-free `carry-over-archive`, and identical `remove-duplicate`.
  - `src/server/api.ts`: Update `/api/sessions`, `/api/sessions/:id/ship`, and `/api/sessions/:id/merge` routes and error codes for direct server execution.
- **Shared & UI (`src/shared/`, `src/ui/`)**:
  - Update default prompt templates and settings help copy in `src/shared/agentDefaults.ts` and `src/ui/` so users see that Ship, Merge, and branch recording are handled by Spec Control, while preserving backwards compatibility for existing `config.json` files.
  - Allow **Ship** and **Merge** buttons in the UI to work on changes/sessions even after the agent CLI process has exited.
  - Add a What's new entry at the top of `src/ui/changelog.ts`.
