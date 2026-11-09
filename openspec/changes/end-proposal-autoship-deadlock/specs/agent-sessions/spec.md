# Spec Delta

## MODIFIED Requirements

### Requirement: A Draft session in a docs auto-merge project opens its proposal pull request
When a **Draft artifacts** session works on `docs/<change>` and the repository has docs auto-merge switched on, Spec Control SHALL record `autoMergeAskedAt` on the session when the worktree holds nothing outside `openspec/` (with an empty worktree counting as holding nothing outside), and SHALL NOT append a prose proposal git/PR instruction to the Draft prompt; the agent receives only the profile's Draft prompt and its additional Draft instructions.

When that Draft session on `docs/<change>` exits with code `0`, or the user explicitly ends it, `autoMergeDocs` is on, every required artifact of `<change>` in the worktree is `done`, and the worktree holds only files under `openspec/`, Spec Control SHALL automatically run the deterministic Ship flow in that worktree: it writes `spec-control.branch: docs/<change>` in `openspec/changes/<change>/.openspec.yaml`, commits all changes with title `docs(openspec): add <change>` when the project declares Conventional Commits pull request titles and `Add OpenSpec proposal <change>` otherwise, pushes `docs/<change>` to `origin`, opens the pull request against the default branch via `gh pr create`, and sets `autoMergeAskedAt` on the session so that "A ready docs-only pull request is merged automatically by the server" and "A merged auto-merge pull request ends its session" merge the proposal pull request and clean up its worktree once its checks pass. An application shutdown or other non-user termination SHALL NOT trigger this user-ended path.

#### Scenario: Draft opens the proposal pull request
- **WHEN** `demo-ops` declares Conventional Commits titles, has docs auto-merge on, the user starts **Draft artifacts** for `rotate-keys`, and the agent writes all required artifacts under `openspec/changes/rotate-keys/` and exits with code `0`
- **THEN** the agent's opening prompt was only the profile's Draft prompt with its additional Draft instructions, and on exit Spec Control commits the artifacts on `docs/rotate-keys` with message `docs(openspec): add rotate-keys`, pushes `docs/rotate-keys`, opens the pull request against the default branch, and records `autoMergeAskedAt` on the session

#### Scenario: Ending a completed proposal ships it
- **WHEN** the Draft agent is still running on `docs/rotate-keys`, docs auto-merge is on, all required artifacts are done, the worktree contains only OpenSpec files, and the user explicitly ends the session
- **THEN** Spec Control ends the agent and automatically ships the proposal through the deterministic Ship flow, then records `autoMergeAskedAt` on the session

#### Scenario: Ending an incomplete proposal does not ship it
- **WHEN** the user explicitly ends the Draft session but a required artifact is missing or not done
- **THEN** Spec Control ends the agent without committing, pushing or opening a pull request

#### Scenario: Shutdown does not ship a proposal
- **WHEN** the application ends a Draft agent during shutdown, even though the required artifacts are done
- **THEN** Spec Control does not run proposal auto-ship

#### Scenario: Without a title convention
- **WHEN** the same project declares no title convention and the Draft session on `docs/rotate-keys` exits with all required artifacts written
- **THEN** Spec Control commits and opens the proposal pull request with the title `Add OpenSpec proposal rotate-keys`

#### Scenario: The worktree holds code
- **WHEN** the `docs-rotate-keys` worktree, reused from an earlier session, holds an uncommitted `src/app.ts`, and Draft is started or exits for `rotate-keys`
- **THEN** Spec Control does not auto-ship or set `autoMergeAskedAt` on the session

#### Scenario: Without docs auto-merge
- **WHEN** `demo-ops` has docs auto-merge off and the user starts **Draft artifacts**
- **THEN** the session works on `feat/rotate-keys` and does not auto-ship on exit or explicit end

#### Scenario: Draft sent into an Implement session
- **WHEN** Draft is sent into the running Implement session of `rotate-keys` on `feat/rotate-keys`
- **THEN** the prompt carries no proposal instruction and the session does not auto-ship as a proposal PR

#### Scenario: Fast-forward is unchanged
- **WHEN** the user starts **Fast-forward** for `rotate-keys` in a project with docs auto-merge on
- **THEN** the session works on `feat/rotate-keys` and never carries the auto-merge record
