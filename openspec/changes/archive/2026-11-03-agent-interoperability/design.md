# Design: Agent Interoperability via Deterministic Server Actions

## Context

See `proposal.md` — Why for the problem statement. Today, `src/server/sessions/agents.ts` and `src/server/sessions/manager.ts` assemble long prose suffixes onto agent prompts so the agent CLI performs deterministic git, `.openspec.yaml` marker, and `gh` operations inside its pseudo-terminal:

- `openSpecModule.recordInstruction(change, kind)` asks the agent to edit `openspec/changes/<change>/.openspec.yaml` (or its archived copy) to add `spec-control.branch` or `spec-control.archive-branch`.
- `DEFAULT_SHIP_PROMPT`, `CONVENTIONAL_COMMITS_SHIP_SENTENCE`, `AUTO_MERGE_DOCS_INSTRUCTION`, `AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION`, and `AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION` ask the agent to stage, commit, push, and run `gh pr create`, while warning it not to merge or enable GitHub auto-merge.
- `DEFAULT_MERGE_PROMPT` and `proposalHandoverSentence` are typed into a running session's PTY to ask the agent to run `gh pr merge <number> --match-head-commit <commit>`, which fails or stalls whenever the agent has already exited or is showing a TUI menu.
- `Archive`, `Carry over archive`, and `Remove duplicate` always spawn an interactive agent session even when delta specs are already synced (or absent), when `git cherry-pick` has no conflicts, or when the duplicate active directory is byte-for-byte identical to the archive.

Meanwhile, Spec Control already has the two foundational server modules needed to run these steps directly without an LLM:
- `src/server/gitWrite.ts` runs non-interactive git write commands (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=""`, batch SSH, `core.hooksPath` pointed at an empty directory, `gc.auto=0`, and credential masking).
- `src/server/gh.ts` runs non-interactive `gh` commands (`GH_PROMPT_DISABLED=1`, `NO_COLOR=1`, `cwd` in the dashboard home outside every tracked repository, no shell, bounded timeout, and credential masking), and already executes `gh pr close` for change dismissal.

## Goals / Non-Goals

**Goals:**
- Make `.openspec.yaml` branch recording, `Ship`, `Merge` (manual and docs auto-merge), synced `Archive`, conflict-free `Carry over archive`, and identical `Remove duplicate` execute deterministically on the server with zero LLM tokens and identical behavior across Claude Code, Codex, Antigravity, and custom agent profiles.
- Automatically run the deterministic `Ship` flow when a managed `Draft` session on `docs/<change>` (with `autoMergeDocs` enabled), an `Archive` session, or a `Fast-forward` session exits with code `0` after completing its work.
- Allow **Ship** and **Merge** to work on a change session whether the agent process is `running` or `exited`.
- Preserve all security and repository-hygiene invariants: never run a shell, never touch the main checkout's working tree or index for session worktree operations, never follow symbolic links when writing `.openspec.yaml` or moving/deleting change directories, disable git hooks on all server git writes, and guard merges with `--match-head-commit <headOid>`.

**Non-Goals:**
- Parsing or scraping terminal output from agents to detect completion (completion is determined strictly from process exit code `0` plus read-only inspection of the worktree's OpenSpec artifacts, task checkboxes, and git status).
- Replacing the agent when LLM reasoning is genuinely needed: syncing unsynced delta specs during Archive (`specsSynced === false`), walking the user through `- [~]` tasks (`subState === "validate"`), resolving `git cherry-pick` or pull-request merge conflicts, or reconciling differing files in `Remove duplicate` (`differingCount > 0`).
- Changing the user-configurable opening prompts for `Draft`, `Implement`, `Validate`, `Resolve conflicts`, or `Integrate` beyond stripping the server-appended git/PR/marker choreography suffixes.

## Decisions

### D1: Pure framework transformation + atomic server write for `.openspec.yaml` branch recording

- **Choice**: Replace `recordInstruction(changeName, kind)` usage in prompt assembly with:
  1. A pure function `setRecordedBranchInMarker(text: string, key: "branch" | "archive-branch", branch: string): string` in `src/server/frameworks/openspec/marker.ts` (exposed on `SpecFrameworkModule` as `recordBranchInMetadata?(text, key, branch)` and `changeMetadataPaths(changeName, archiveDirName?)`).
  2. A server helper in `src/server/sessions/manager.ts` that locates the change's `.openspec.yaml` inside the managed session worktree (`openspec/changes/<change>/.openspec.yaml` or, if archived in that worktree, `openspec/changes/archive/<date>-<change>/.openspec.yaml`), verifies with `lstat` that every path segment from the worktree root down to `.openspec.yaml` is a real directory/file (no symbolic links), and atomically writes the updated content via a sibling temp file and `rename` when the value is not already recorded.
- **When it runs**:
  - When Spec Control prepares a managed session worktree for a change (so if the agent itself commits during `Implement`, the branch is already in `.openspec.yaml`).
  - Immediately before staging/committing in the deterministic `Ship` and `Archive` flows (covering archive directories created during the session).
- **Rationale**: Agents frequently either omit the `.openspec.yaml` edit, mis-indent the YAML map, or trigger an extra file-write permission prompt. Doing it in Spec Control guarantees 100% accuracy at zero token cost.
- **Alternatives considered**: Keeping `recordInstruction` as a fallback for custom agents. Rejected because all agents run in Spec Control's worktree and benefit equally from the server writing `.openspec.yaml`.

### D2: Deterministic `Ship` via `gitWrite` and `runGh`, plus auto-ship on clean session exit

- **Choice**: Implement `shipSession(id, options?: { title?: string })` in `SessionManager` as a direct server operation in the session's worktree (`session.worktreePath`):
  1. Verify the session is a change session with a managed worktree (not `inPlace`) and its work status is `uncommitted`, `unpushed`, or `pushed`.
  2. Ensure `.openspec.yaml` in the worktree records `branch` (or `archive-branch` when `session.action === "archive"`).
  3. Inspect `git status --porcelain=v1 -z` in the worktree. If any files are modified, staged, deleted, or untracked, run `git add --all` and `git commit --no-verify -m <commitTitle>` in the worktree via `gitWrite` (with `core.hooksPath` pointed at the empty hooks directory, `gc.auto=0`, and fallback committer identity if git has none configured).
  4. Derive the default `<title>` deterministically when not supplied:
     - Proposal branch (`docs/<change>`): `docs(openspec): add <change>` when `prTitleConvention === "conventional-commits"`, else `Add OpenSpec proposal <change>`.
     - Archive branch (`chore/archive-<change>`): `chore(openspec): archive <change>` when `prTitleConvention === "conventional-commits"`, else `Archive OpenSpec change <change>`.
     - Implementation branch (`feat/<change>` or custom): if the worktree was already clean and has commits ahead of base, reuse the latest commit's subject (`git log -1 --format=%s`); otherwise `feat: <change>` when `prTitleConvention === "conventional-commits"`, else `<change>`.
  5. Run `git push --no-verify --set-upstream origin HEAD:refs/heads/<branch>` in the worktree via `gitWrite`.
  6. If the repository's `origin` is on `github.com`, check whether an open pull request with `headRefName === <branch>` already exists in the repository's pull-request cache (or via `gh`). If none exists, run `createPullRequest(githubRepo, { head: branch, base: defaultBranch, title, body })` in `src/server/gh.ts`, which invokes `gh pr create --repo <owner/name> --head <branch> --base <defaultBranch> --title <title> --body <body>` from the neutral dashboard home directory without a shell.
  7. Refresh the repository's pull-request cache (`pullRequests.refreshRepo(repoId)`) and recompute whether the branch ships only `openspec/` documents; when `repo.agent?.autoMergeDocs` is on and `shipsOnlyOpenSpec` holds (and `session.action !== "fastForward"`), record `autoMergeAskedAt`.
- **Automatic Ship on session exit**:
  - In `SessionManager`'s process exit handler (`onExit`), when a managed worktree session exits with `exitCode === 0` (and was not terminated by `closeSession` / `autoEnded`):
    - **Draft on `docs/<change>`** with `autoMergeDocs` enabled: if all required artifacts of `<change>` in the worktree are `done` and `worktreeHoldsNothingOutsideOpenSpec` holds, run `shipSession`.
    - **Archive on `chore/archive-<change>`**: if `openspec/changes/archive/*-<change>` exists in the worktree (or for `removeDuplicate`, `openspec/changes/<change>` no longer exists), run `shipSession`.
    - **Fast-forward on `feat/<change>`**: if `<change>` in the worktree has tasks (`total > 0`) and `done + awaiting === total`, run `shipSession` (never setting `autoMergeAskedAt`).
- **Rationale**: Eliminates all prose git/PR tails from `Draft`, `Archive`, `Fast-forward`, and `Ship`, while ensuring that agents that exit immediately after completing a slash command (such as `/opsx:ff` or `/opsx:archive`) automatically get their branch pushed and their PR opened.

### D3: Deterministic `Merge` via `gh pr merge --match-head-commit`

- **Choice**: Add `mergePullRequest(repo: string, number: number, headOid: string)` in `src/server/gh.ts`, invoking:
  `gh pr merge <number> --repo <owner/name> --squash --match-head-commit <headOid>`
  (never passing `--delete-branch` or `--auto`).
- **Manual and automatic merge**:
  - `POST /api/sessions/<id>/merge` validates that the session's linked open pull request (or the change's proposal pull request on `docs/<change>`) is ready (`pullRequestReadiness(pr).state === "ready"`) and has a 40-hex `headOid`, then calls `mergePullRequest` directly and triggers a pull-request refresh for that repository. It works whether the session is `running` or `exited`.
  - `requestReadyMerges(repoId)` in `SessionManager` checks all sessions of `repoId` that carry `autoMergeAskedAt` (whether `running` or `exited`, including proposal sessions on `docs/<change>`). When all readiness, `docsOnly`, and worktree `HEAD === pr.headOid` checks pass and `session.mergeAsked` has not already recorded `{ number: pr.number, headOid: pr.headOid }`, it records `session.mergeAsked` and calls `mergePullRequest` directly, followed by `endSessionsForMergedPullRequests` once the refreshed list reports the PR as `merged`.
- **Retiring proposal handover**: Because an ended proposal session on `docs/<change>` can now be merged directly by `requestReadyMerges` or `POST /api/sessions/<id>/merge` without a running agent terminal, `handedOverProposal` and `proposalHandoverSentence` are removed.

### D4: Zero-token fast paths for `Archive`, `Carry over archive`, and `Remove duplicate`

- **Choice**:
  1. **Synced Archive**: When `openSession` is called with `action: "archive"` (without `carryOverArchive` or `removeDuplicate`) for a change in `Done` with `subState === "complete"` (`tasks.awaiting === 0`) and `specsSynced !== false` in a git repository that uses worktrees:
     - Prepare the `chore/archive-<change>` worktree from the default branch.
     - Verify with `lstat` that `openspec`, `openspec/changes`, `openspec/changes/<change>`, and `openspec/changes/archive` (creating `archive` if absent) in the worktree contain no symbolic links.
     - Move `openspec/changes/<change>` to `openspec/changes/archive/<YYYY-MM-DD>-<change>` (using UTC date `YYYY-MM-DD`).
     - Record `archive-branch: chore/archive-<change>` in `openspec/changes/archive/<YYYY-MM-DD>-<change>/.openspec.yaml`.
     - Run the deterministic `Ship` flow (stage, commit, push, open PR) and record a completed session (`status: "exited"`, `exitCode: 0`) without spawning an agent process.
     - If `specsSynced === false` or `subState === "validate"`, spawn the agent session with the Archive prompt as today; when the agent finishes and exits with `0`, the post-exit hook ships the branch.
  2. **Carry over archive**: When `carryOverArchive: true` is passed:
     - Prepare the `chore/archive-<change>` worktree and run `git cherry-pick --no-commit <commit>` (or `git cherry-pick <commit>` with hooks disabled) via `gitWrite`.
     - If `git cherry-pick` succeeds and `worktreeHoldsNothingOutsideOpenSpec` holds, record `archive-branch`, push, and open the PR deterministically without starting an agent.
     - If `git cherry-pick` fails (conflict), run `git cherry-pick --abort` to leave the worktree clean and start the agent session with `CARRY_OVER_ARCHIVE_PROMPT` (minus the Ship prose tail) so the agent resolves the conflict.
  3. **Remove duplicate**: When `removeDuplicate: true` is passed:
     - If `duplicate.differingCount === 0`, prepare the `chore/archive-<change>` worktree, verify with `lstat` that `openspec`, `openspec/changes`, and `openspec/changes/<change>` are real directories, remove `openspec/changes/<change>` recursively, record `archive-branch` in `openspec/changes/archive/<archiveDir>/.openspec.yaml`, and ship deterministically without starting an agent.
     - If `duplicate.differingCount > 0`, start the agent session as today so the user and agent can reconcile the differing files, then auto-ship on clean exit.

### D5: Prompt simplification and backwards compatibility

- **Choice**:
  - Update preset Archive prompts in `src/shared/agentDefaults.ts` to drop the trailing `"and include in your commit every file the archive moved or removed"` git instruction (keeping the previous strings in `FORMER_PRESET_PROMPTS` so existing `config.json` files upgrade seamlessly on load).
  - Keep accepting `prompts.ship`, `prompts.merge`, `additionalInstructions.ship`, and `additionalInstructions.merge` in `config.json` validation so existing user configurations never fail to load or save.

## Risks / Trade-offs

- **[Risk] User git environment lacks `user.name` / `user.email` when server runs `git commit`** → **Mitigation**: `gitWrite` checks whether `git commit` has an identity or passes fallback `-c user.name="Spec Control" -c user.email="spec-control@localhost"` only when git reports no configured author identity, while preserving the user's configured git identity whenever present.
- **[Risk] Agent exits with code `0` during `Draft` or `Fast-forward` before finishing all artifacts or tasks (e.g. user pressed Ctrl-C or exited early)** → **Mitigation**: Auto-ship on exit checks the worktree's actual OpenSpec state before shipping: a `Draft` session on `docs/<change>` only auto-ships if every required artifact is `done`; a `Fast-forward` session only auto-ships if `tasks.total > 0` and `tasks.done + tasks.awaiting === tasks.total`; an `Archive` session only auto-ships if `openspec/changes/archive/*-<change>` exists. If not complete, the worktree remains uncommitted/unpushed and the user can **Resume** or click **Ship** manually when ready.
- **[Risk] `gh pr create` or `git push` fails during automatic post-exit Ship (e.g. offline or branch protection)** → **Mitigation**: Record the failure reason on the session record (`shipError`) and surface it in the session panel and card, leaving the committed work in the worktree so clicking **Ship** retries idempotently.

## Migration Plan

1. Extend `src/server/frameworks/openspec/marker.ts` and `SpecFrameworkModule` with pure `.openspec.yaml` branch-recording and archive path helpers.
2. Add `commitWorktreeAll`, `pushWorktreeBranch`, and `cherryPickCommit` in `src/server/gitWrite.ts` and `createPullRequest` / `mergePullRequest` in `src/server/gh.ts`.
3. Update `SessionManager` (`src/server/sessions/manager.ts`) and `src/server/sessions/agents.ts` to use server-side branch recording, deterministic `Ship`, post-exit auto-ship, deterministic `Merge` / `requestReadyMerges`, and zero-agent fast paths for synced `Archive`, clean `Carry over archive`, and identical `Remove duplicate`.
4. Update API routes (`src/server/api.ts`), UI components (`src/ui/`), and tests (`test/`).
5. Add a What's new entry in `src/ui/changelog.ts`.
