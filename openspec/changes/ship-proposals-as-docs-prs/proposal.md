# Proposal

## Why

Every pull request that only touches `openspec/` should merge on its own once its checks pass — that is what docs
auto-merge is for. Today only two kinds of pull request ever get there: Ship's and Archive's. The proposal itself never
does, because a **Draft artifacts** session never ships: the agent writes the artifacts into its worktree on
`feat/<name>`, and they sit there, uncommitted, until **Implement** continues on the same branch. So:

- **A proposal is never reviewed or merged on its own.** It reaches the default branch only inside the implementation's
  pull request, mixed with code, which is exactly the kind of pull request docs auto-merge must not touch.
- **The created change becomes a leftover.** **Create change** writes `openspec/changes/<name>/` into the main checkout
  and stages it; nobody commits it there. Because the proposal never lands on the default branch by itself, that staged
  copy outlives the change — one of the sources of left-over files `stale-means-archived-and-merged` lists.
- **Drafting and implementing share a branch.** Even if a Draft session opened a pull request, a merged proposal pull
  request on `feat/<name>` would leave Implement continuing on a branch whose pull request already merged.

## What Changes

- **Draft gets its own branch in projects with docs auto-merge.** When the repository has docs auto-merge on at the
  moment a Draft session starts, the session works in its own worktree `docs-<name>` on branch `docs/<name>` — the
  convention this repository's own proposals use. Without docs auto-merge nothing changes: Draft works on `feat/<name>`
  and Implement continues there, because a proposal that is not shipped needs no branch of its own.
- **The Draft prompt asks for the proposal pull request.** For such a session the dashboard appends a fixed **proposal
  instruction** after the profile's Draft prompt and its additional instructions: once every artifact is written,
  commit them on this branch, push it and open a pull request against the default branch — titled
  `docs(openspec): add <name>` when the project declares Conventional Commits, otherwise `Add OpenSpec proposal <name>`
  — containing only files under `openspec/`, do not merge it, do not enable auto-merge on it, and do not start
  implementing. It is appended only when read-only git proves the fresh worktree holds nothing outside `openspec/`, the
  same check Archive makes.
- **The existing auto-merge flow takes it from there.** Appending the proposal instruction records the auto-merge time
  on the session, exactly as Ship and Archive do, so "A ready docs-only pull request is handed to its agent to merge"
  and "A merged auto-merge pull request ends its session" apply unchanged: the agent is asked to merge once the pull
  request is ready, and the session ends and its clean worktree is removed once it merged.
- **Implement builds on the proposal.** An Implement session that has to create `feat/<name>` starts it from the default
  branch when the default branch already holds `openspec/changes/<name>/` (the proposal merged), otherwise from the
  local `docs/<name>` when that branch exists (the proposal pull request is still open), otherwise from the default
  branch as today. Decided with read-only git. Implementing never continues on `docs/<name>`, so the proposal pull
  request stays docs-only.
- **The proposal pull request is linked to its change.** `docs/<name>` joins the change's candidate branches, compared
  exactly like the others; the existing choice — open first, then the most recent — shows the proposal pull request
  while it is open and the implementation's once that one opens.
- **The card names it.** While the linked pull request is the proposal's, the card and detail header call it the
  proposal pull request.
- **Fast-forward is unchanged.** It keeps `feat/<name>` and one pull request with proposal and code, which is not
  docs-only and never auto-merged.
- No new write to a tracked repository, no new git subcommand, no network access, no `gh` process: the dashboard only
  appends text to a prompt and chooses a branch name and a start point for a worktree it already creates.

## Non-goals

- Pull requests opened outside the dashboard (by hand or by an agent the dashboard did not start): nothing watches them,
  so they are not merged on their own.
- A GitHub Action or GitHub's own auto-merge: the dashboard keeps deciding when a docs-only pull request is ready.
- The dashboard committing, pushing or merging anything: it never does; the agent does it under its own permission
  prompts.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `agent-sessions`: the Draft session's branch and worktree in a docs auto-merge project, the Implement start point,
  the proposal instruction, and the proposal instruction as a source of the auto-merge record.
- `pull-requests`: `docs/<name>` as a candidate branch.
- `stale-changes`: `docs/<name>` among a change's exactly named branches (`stale-means-archived-and-merged` was archived
  first).
- `kanban-board`: the card names a proposal pull request.

## Order and overlaps

- `record-change-pull-request` records the implementation's `branch` and the `archive-branch` in `.openspec.yaml`. The
  proposal branch is **not** recorded: the dashboard names it, so it is a fixed candidate like `feat/<name>`.
- `one-next-action-per-stage` lets the linked open pull request decide the card's recommended step. A proposal pull
  request flows through it unchanged — waiting while checks run, Merge when ready, Resolve conflicts on a conflict — with
  Implement in the menu. Only the wording "proposal pull request" is added here.
- `stale-means-archived-and-merged` lists a change's exact branches; `docs/<name>` belongs in that list. Whichever of the
  two is archived second adds it.
- `resolve-pr-conflicts` works on the linked pull request's head branch, so a conflicting proposal pull request is
  resolved on `docs/<name>` with no change here.

## Impact

- `src/shared/sessionBranch.ts`: `docs/<name>` for a Draft session that ships its proposal.
- `src/server/sessions/manager.ts`: branch and worktree name for Draft, the proposal instruction and its record, the
  Implement start point.
- `src/server/sessions/worktree.ts`: `ensureWorktree` takes a start point; a read-only check whether the default branch
  holds the change.
- `src/server/sessions/workStatus.ts`: `changeOfWorktree` knows the `docs-` prefix.
- `src/shared/types.ts`: `AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION`.
- `src/shared/pullRequestLink.ts`: `docs/<name>` as a candidate; whether the linked pull request is the proposal's.
- `src/ui/kanban.tsx`, `src/ui/pullRequests.tsx`, `src/shared/nextStep.ts`: the "proposal pull request" wording on
  the badge, in the detail header and in the recommended step's labels.
- `src/shared/sessionBranch.ts`, `src/ui/sessionState.ts`, `src/ui/sessions.tsx`, `src/ui/sessionPanel.tsx`: a session
  of the change may run beside the proposal session, which receives Draft only (found while implementing: "at most one
  session per change" would otherwise put Implement onto `docs/<name>`); `src/server/sessions/manager.ts` also sends
  Resolve conflicts to the running session on the pull request's branch.
- `src/server/staleChanges.ts`: `docs/<name>` in `changeBranches`; tests in `test/staleChanges.test.ts`.
- `src/ui/helpContent.tsx`, `src/ui/projectSettings.tsx`, `src/ui/changelog.ts`: help, the Docs auto-merge hint and
  what's new.
- Tests: `test/proposalSessions.test.ts`, `test/worktree.test.ts`, `test/pullRequestLink.test.ts`,
  `test/workStatus.test.ts`, `test/agents.test.ts`, `test/pullRequestBoard.test.ts`.
