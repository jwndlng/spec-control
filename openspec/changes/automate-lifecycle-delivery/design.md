# Design

## Context

This change is one independently scoped session split from simplify-agent-lifecycle. Read proposal.md and this change's spec deltas for its contract. Required predecessors: `repair-permission-spec-structure`, `resolve-agent-workflow-instructions`.

## Goals / Non-Goals

Implement only the proposal's listed concern in its owned paths. Preserve unrelated session behavior, remote protections, tracked repository write boundaries, and other sessions' work. No code implementation belongs to this planning branch until a new apply session starts.

## Decisions

### 1. Persist delivery independently of terminal lifetime

Add a lifecycle delivery coordinator under `src/server/` and durable records in the dashboard home, following the existing atomic home-write conventions. Key records by canonical repository/project, change incarnation, phase, and revision; store action provenance, worktree/branch identity, inspected content hashes, local/remote head, PR identity, state, last failure, and retry timing. A phase retains one branch/PR and advances revisions until its PR merges; a later follow-up after merge must create a new delivery identity rather than push invisibly to a merged PR.

Use states `pending`, `committing`, `pushing`, `opening-pr`, `waiting-to-merge`, `merged`, `blocked`, and `unavailable`. Local lifecycle stage remains scanner-derived. A visible Ready/Done/Archived stage does not imply remote persistence.

Observe managed action completion through the existing session refresh/scanner cycle plus an optional provider-neutral completion report. Reports prompt verification; they never prove tasks, artifact contents, or git state. Read bounded framework outputs and tasks from the managed action checkout, require complete valid required artifacts for Ready and all checked tasks for automatic implementation delivery, and verify an archive belongs to the same incarnation. Require a stable content snapshot across observations before delivery; restart detection if evidence changes. Watch while the process remains running; exit is a fallback observation, never the primary trigger. No terminal text parsing or runtime-specific success phrases.

Only a managed action observed in this session history creates an automatic checkpoint. On upgrade, bootstrap historical snapshots as observations, not new delivery requests. Existing recorded pending proposal PRs are reconciled rather than republished.

Alternative considered: add stronger Ship instructions to every agent prompt. Rejected because it depends on agent interpretation, process exit, and per-runtime approvals and gives the dashboard no reliable recovery state.

### 2. Reuse deterministic Ship and Merge with explicit scopes

Move reusable Ship/Merge operations behind a coordinator interface rather than duplicate git/GitHub command code. Manual and automatic operations share locks keyed by canonical repository and worktree. Verify worktree ownership, expected branch/head, content snapshot, and staged diff before committing. Scope proposal delivery to that change's planning artifacts, schema outputs such as `pull-request.md` when present, and metadata. Block mixed code or unrelated-change work instead of silently committing it. Implementation retains existing session-worktree scoping; archive delivery includes the archive move and synced main specs.

Reconcile remote PR state before creating or retrying. Persist intent before remote calls and success evidence afterwards. An uncertain push/create/merge result is resolved by querying the recorded repository/branch/PR; it does not justify blindly repeating creation. Use expected-head merge matching and verify the resulting commit/head. Observe source changes after each operation and queue the next revision without overwriting active agent work. Server locks do not control arbitrary agent git commands: changed index/head evidence must block/reconcile the operation, not be overwritten.

Draft always uses `docs/<change>` in its dedicated worktree independently of `autoMergeDocs`; preserve already-open proposal branches. A Draft action in an implementation worktree with code cannot persist the whole worktree as a proposal. Show a specific blocker and let the existing Draft/handoff path create or select a clean proposal checkout. Implementation can proceed through the explicit existing handoff, seeded with planning work if it is not yet on the base. Proposal merging does not silently launch the next phase or end a busy agent.

### 3. Separate proposal merge policy from documentation merge policy

Standard proposal persistence is automatic when managed sessions are enabled, regardless of `autoMergeDocs`. Non-proposal documentation and archive checkpoints retain that project setting. Implementation containing code opens a PR and stops for human merge. Preserve task preflight behavior for explicit actions from `ship-button-should-only-block-implement`; automatic implementation delivery still requires all tasks checked. An explicitly accepted archive with unresolved tasks can be published while showing those tasks and never fabricating completion.

Introduce a shared exact-head documentation classifier used by local Ship and GitHub PR checks. Default docs include `openspec/**`, `docs/**`, `.md`, and `.rst`; executable/script files, workflows, manifests, lockfiles, symlinks, submodules, and unknown files fail classification even under a docs directory. Include both sides of renames and the complete diff. Proposal artifacts must also belong to the proposal scope, which is narrower than generic documentation.

Read applicable required-check and protection evidence for the exact PR/base/head through the GitHub integration. No-check PRs may merge only when fresh evidence establishes no required checks apply and no reported checks are pending/failing; unknown evidence is an explicit blocker. GitHub remains the enforcement authority for required reviews, protections, and permissions. Record failures and retry with bounded backoff for transient errors; permissions/conflicts/policy wait for changed evidence or Retry. Replace permanent once-per-head failure suppression with an in-flight guard and persisted retry state. No `--admin`, force push, or protection bypass.

Existing automatic merged-session cleanup must recognize proposal delivery separately from the docs setting and retain its fresh no-loss checks. A later action or newer work prevents cleanup of a merged proposal's worktree.

### Completion intent is explicit

A stable filesystem snapshot alone can be an intermediate draft. Extend the provider-neutral session report contract with phase-completed intent tied to a server-issued current action identity/revision. Inject the report contract in the action packet for Codex and Antigravity, including CLI fallback. Reports are untrusted intent: independently validate files, required artifacts, task summaries, branch/head, and stable content before delivery. Existing clean-exit verification remains a fallback. A missing report leaves a clear Awaiting phase completion state with an explicit Confirm phase complete recovery control that performs the same checks; ordinary terminal idle is insufficient. Never reuse a prior phase report. Add tests for mid-draft pauses and replayed reports.

When integrating proposal delivery, use the workflow resolver's instruction packet extension point; do not add a second resolver. The workflow-discovery session does not implement delivery reports. Keep the report state separate from terminal status so generic agents can finish an action without exiting.


## Risks / Trade-offs

- Shared files may change in neighboring sessions → use the concern ownership and landing order in SESSION.md; refresh against merged predecessors and reconcile only the relevant blocks.
- Missing evidence or changed data during operations → expose a concrete blocker and retain current no-loss/path/permission protections.
- Runtime behavior differs across versions → automated tests use fake agents and GitHub; verify installed runtimes separately where this change affects them.

## Migration Plan

Land required predecessors first, refresh this worktree from origin/main, then implement the tracked tasks. Preserve backward-compatible reads where records change. Document breaking destructive-API changes explicitly when applicable. Rollback must retain files, worktrees, remote PRs, and recoverable home records; do not delete state to hide a failure.
