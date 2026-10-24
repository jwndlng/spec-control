# Design

## Context

Docs auto-merge already works end to end for Ship and Archive: the dashboard appends an instruction, records
`autoMergeAskedAt` on the session, sends the running agent a Merge prompt once the pull request is ready and docs-only at
the worktree's commit (`requestReadyMerges`), and ends the session and removes its clean worktree once the query lists
the pull request merged (`endMergedAutoMerge`). The Draft starter is the one step that produces only `openspec/` files
and never takes part. Today a Draft session runs on `feat/<name>` in worktree `<name>`, and Implement adopts or reuses
that same worktree (`linkedWorktreeOf`, `ensureWorktree` reusing an existing directory).

## Decisions

### D1. A branch and worktree of its own, only with docs auto-merge

A Draft session started while the repository has docs auto-merge on works on `docs/<name>` in worktree `docs-<name>`.
The worktree name must differ from Implement's (`<name>`): `ensureWorktree` reuses any existing directory by name, so a
shared name would put Implement onto the proposal's branch. `changeOfWorktree` maps the `docs-` prefix back to the
Draft action for worktrees whose session record is gone.

Without docs auto-merge the Draft session keeps `feat/<name>` and worktree `<name>`. Rejected: `docs/<name>` always.
A proposal that is not shipped gains nothing from its own branch, and Implement could then no longer continue in the
draft's worktree — the artifacts would be copied uncommitted into a second worktree and the first would become a
leftover, the very thing this work is meant to reduce.

The decision is taken once, when the session starts, and recorded as the session's branch; switching docs auto-merge
later does not move a session.

### D2. The proposal instruction, appended like the archive one

`AUTO_MERGE_DOCS_PROPOSAL_INSTRUCTION` follows the profile's Draft prompt and its additional instructions, like
`AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION`. It is appended only to a Draft session on `docs/<name>` — at start, or when
Draft is sent into that same running session — and only when `shipsOnlyOpenSpec(worktree, base, { allowEmpty: true })`
proves the worktree holds nothing outside `openspec/`; `allowEmpty` because a fresh worktree holds nothing yet. Sending
Draft into a session on another branch never carries it: that branch is not the proposal's.

The title follows the project's declared convention: `docs(openspec): add <name>` with Conventional Commits,
`Add OpenSpec proposal <name>` otherwise. It is the dashboard's fixed text, with `<name>` the validated change name.

Rejected: a "Ship proposal" prompt the dashboard types when the change reaches `Ready`. It would type into a terminal
on a scan result, without the user's action and while the agent may still be writing; the instruction in the opening
prompt lets the agent ship when it knows it is done.

### D3. The auto-merge record is reused, not extended

Appending the proposal instruction sets `autoMergeAskedAt` exactly as Ship and Archive do. The ready-merge and
merged-ends-session requirements already key on that record and on the session's branch, so the only spec change there
is naming the proposal instruction as one of the instructions that set it. A Draft session on `docs/<name>` is never
adopted (D4), so the "did not adopt its worktree" condition never excludes it.

### D4. Implement starts from the proposal, never on it

Implement keeps `feat/<name>` and worktree `<name>`. When it has to create the branch, the start point is chosen with
read-only git (`ls-tree`, `show-ref`):

1. the default branch as known locally, when its tree holds `openspec/changes/<name>/` — the proposal merged;
2. else the local `docs/<name>`, when it exists — the proposal pull request is still open, or was never opened;
3. else the default branch, as today, with the change copied in when missing.

Rejected: continuing on `docs/<name>`. Code would land in the proposal pull request, which would stop being docs-only
and lose its title's meaning. Rejected: always the default branch with the artifacts copied in. While the proposal
pull request is open, both pull requests would add the same files independently; a later edit to the proposal in its
review would make them conflict. Starting from `docs/<name>` makes the implementation branch contain the proposal's
commits: if the proposal merges first, its files arrive on the default branch with the same content and the
implementation still merges cleanly; if the proposal changes in review, the conflict is shown and resolved like any
other (`resolve-pr-conflicts`).

The adoption exception stays for `feat/<name>` only: a Draft session on `docs/<name>` adopts a worktree that has
`docs/<name>` checked out, and Implement never adopts the proposal's worktree.

### D5. Linking: a fixed candidate, not a record

`docs/<name>` joins `feat/<name>` and `chore/archive-<name>` as a fixed candidate. `record-change-pull-request`'s
`branch` key stays the implementation's; recording the proposal branch would add a key for a name the dashboard already
chose. The existing choice — open first, then most recent — gives the right pull request at every point: the proposal's
while it is the only open one, the implementation's once that opens, the archive's at the end.

### D6. The created change's staged copy

Once the proposal merges and the user pulls, the incoming commit holds `openspec/changes/<name>/`, so the staged copy
**Create change** left in the main checkout is exactly a change leftover the pull's **Resolve and pull** already
handles. Nothing new is needed here; `stale-means-archived-and-merged` covers the copies that still escape.

## Risks

- **The agent ignores the instruction** and starts implementing on `docs/<name>`. Then `shipsOnlyOpenSpec` no longer
  holds at the pull request's head, so no Merge prompt is sent and nothing merges on its own; the pull request waits for
  the user like any other.
- **Proposal pull request not merged before Implement.** Handled by D4; the card's recommended step stays the waiting
  label while its checks run, with Implement in the menu (`one-next-action-per-stage`).
- **An older Draft worktree on `feat/<name>`** from before this change keeps working: an existing worktree is reused by
  name, and Implement adopts it as today.

## Open Questions

None.
