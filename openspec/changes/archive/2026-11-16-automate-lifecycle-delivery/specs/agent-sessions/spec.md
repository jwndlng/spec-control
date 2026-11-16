## REMOVED Requirements

### Requirement: A Draft session in a docs auto-merge project opens its proposal pull request
**Reason**: Standard proposal persistence now applies independently of the optional docs auto-merge setting and agent exit.
**Migration**: Use lifecycle-delivery and the standard proposal sessions requirement below. Preserve existing open proposal PRs and their branches.

## MODIFIED Requirements

### Requirement: Ship commits, pushes and opens a pull request deterministically
For a session whose worktree has status `uncommitted`, `unpushed` or `pushed` the dashboard SHALL offer a **Ship** action that executes deterministically on the server without starting, resuming, or typing into an agent. When Ship is activated (or triggered by a verified managed lifecycle checkpoint under lifecycle-delivery, including while its agent remains running), the server SHALL:

1. Write `spec-control.branch` (or `spec-control.archive-branch` for an archive session) into the change's `.openspec.yaml` (or archived `.openspec.yaml`) in the session's worktree if not already set to the session's branch.
2. Check with read-only git whether the worktree has uncommitted or untracked changes (`status --porcelain=v1 -z`) and, if so, stage the checkpoint-approved paths (all worktree changes for an explicit Ship; only planning artifacts and metadata for automatic proposal delivery) and commit them (`git commit --no-verify -m <title>`) in the session's worktree with repository hooks disabled.
3. Push the session's branch to `origin` (`git push --no-verify --set-upstream origin HEAD:refs/heads/<branch>`) with batch SSH and credentials masked.
4. Determine whether an open pull request for `<branch>` already exists in the repository's GitHub repository; if none exists, create one against the repository's default branch via `gh pr create --repo <owner/name> --head <branch> --base <defaultBranch> --title <title> --body <body>` and refresh the repository's pull-request cache.

When the session's repository has auto-merge of docs-only pull requests switched on, the server SHALL decide with read-only git in the session's worktree whether the branch contains documentation only under "Documentation merge eligibility is shared". When that holds, the server SHALL record `autoMergeAskedAt` on the session (and return `autoMergeInstructionIncluded: true`), and the panel SHALL say that, because only documentation changed, Spec Control will merge the pull request automatically once its checks pass. An in-place session has no worktree and no branch: it has no work status, Ship MUST NOT be offered for it, and a Ship request for it SHALL be refused.

#### Scenario: Ship commits, pushes and opens a pull request without an agent
- **WHEN** Ship is used on a running or ended session for `rotate-keys` whose worktree on `feat/rotate-keys` has uncommitted files
- **THEN** the server writes `branch: feat/rotate-keys` in `.openspec.yaml`, commits all changes in the worktree, pushes `feat/rotate-keys` to `origin`, opens a pull request via `gh pr create`, refreshes the repository's pull-request cache, and starts or types into no agent process

#### Scenario: Ship when commits are already made and only unpushed
- **WHEN** the agent already committed its changes in the worktree and `.openspec.yaml` already records `branch: feat/rotate-keys`, so the worktree is clean and `unpushed`
- **THEN** Ship creates no extra commit, pushes `feat/rotate-keys` to `origin`, and opens the pull request using the existing commit subject as the default title

#### Scenario: Nothing to ship
- **WHEN** Ship is requested for a session whose worktree is `merged`, `clean` or `missing`
- **THEN** the request is refused and no git write or `gh` command runs

#### Scenario: Ship is not offered without git
- **WHEN** the panel of an in-place session is open
- **THEN** no Ship control is shown, no work status is shown for it, and a Ship request for that session is refused

#### Scenario: Shipping a docs-only branch with auto-merge on
- **WHEN** Ship runs on the archive session of `rotate-keys` in a repository with auto-merge of docs-only pull requests on, and the branch only moves `openspec/changes/rotate-keys/` under `openspec/changes/archive/` and changes `openspec/specs/secrets/spec.md`
- **THEN** the session records `autoMergeAskedAt`, the result states `autoMergeInstructionIncluded: true`, and the panel says the pull request will be merged once its checks pass

#### Scenario: Code in the branch
- **WHEN** Ship runs in a repository with auto-merge on and the branch changes `openspec/changes/rotate-keys/tasks.md` and `src/keys.ts`
- **THEN** the session records no `autoMergeAskedAt` and the result states `autoMergeInstructionIncluded: false`

### Requirement: A ready docs-only pull request is merged automatically by the server
Whenever a pull-request query for a repository completes with a good list — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL, for each change session of that repository (whether `running` or `exited`) that carries the auto-merge record of "A merged auto-merge pull request ends its session", is not in place and did not adopt its worktree, look in that query's result for an open pull request whose head branch is the session's branch, and SHALL merge that pull request directly via `gh pr merge <number> --repo <owner/name> --squash --match-head-commit <headOid>` only when **all** of these hold at that moment:

- agent sessions are enabled, the repository has docs auto-merge switched on or this is standard proposal persistence under lifecycle-delivery, and this is not the demo;
- the pull request is open and not a draft, its base branch is the repository's default branch, its mergeability is `mergeable` and its checks pass, or fresh GitHub evidence confirms no required checks apply and no reported check is failing or pending; an empty cached check list alone SHALL NOT prove this;
- the pull request is docs-only (`pull-requests`: "What a pull-request list contains") and carries a head commit;
- when the session's worktree still exists, its checked-out commit is that head commit and the worktree holds documentation only under the shared eligibility check Ship makes — decided with read-only git, without contacting a remote, at that moment; a git command that fails counts as not holding;
- no merge was already attempted by the dashboard for this session, pull request and head commit.

Before running `gh pr merge`, the session SHALL record the pull request's number, the head commit and the time (`mergeAsked`), so that a second query completing meanwhile starts no duplicate merge. Concurrent or repeated observations SHALL make at most one merge attempt at a time per PR head. Failed attempts SHALL retain an actionable blocker and follow the retry rules of lifecycle-delivery; a recorded attempt SHALL NOT permanently prevent recovery. Because the merge runs directly through `gh pr merge` on the server, it works identically whether the session's agent is still running or has already exited, and never starts, resumes, or types into an agent. Fast-forward implementation code SHALL NOT be auto-merged; documentation-only checkpoints follow the same project policy as other implementations.

#### Scenario: Archive pull request goes green after the agent exited
- **WHEN** `demo-ops` has docs auto-merge on, the archive session of `rotate-keys` carries the auto-merge record, its worktree is at commit `c0ffee0123456789abcdef0123456789abcdef01` with only `openspec/` changes, and a watch refresh lists `#88` from `chore/archive-rotate-keys` open against the default branch, not a draft, mergeable, checks passing, docs-only, head commit `c0ffee0123456789abcdef0123456789abcdef01`
- **THEN** the server records `#88` and `c0ffee0123456789abcdef0123456789abcdef01` on the session and runs `gh pr merge 88 --repo acme/demo-ops --squash --match-head-commit c0ffee0123456789abcdef0123456789abcdef01` without starting or typing into an agent

#### Scenario: No checks at all
- **WHEN** all other conditions hold and GitHub freshly confirms that no checks are required or pending for `#88`
- **THEN** the PR is merged; unknown required-check evidence instead leaves an actionable waiting status

#### Scenario: A file outside openspec
- **WHEN** everything holds except that `#88` is not docs-only
- **THEN** no merge is run

#### Scenario: Draft, conflict or another base
- **WHEN** everything holds except that `#88` is a draft, or conflicts with its base, or targets a branch other than the default branch
- **THEN** no merge is run

#### Scenario: The worktree is ahead of the pull request
- **WHEN** everything holds except that the worktree's commit is not `#88`'s head commit
- **THEN** no merge is run

#### Scenario: Seen again at the same head commit
- **WHEN** a later refresh lists `#88` still open at the same head commit after a merge for it was already attempted
- **THEN** no duplicate merge runs; a recorded failure remains retryable under the lifecycle retry policy

#### Scenario: A fix was pushed
- **WHEN** a check failed, a fix was pushed, and a later refresh lists `#88` ready again at a new head commit with checks passing
- **THEN** one `gh pr merge` naming the new head commit is run

#### Scenario: Docs auto-merge switched off
- **WHEN** the user switched docs auto-merge off for `demo-ops` after a non-proposal session recorded `autoMergeAskedAt`, and a refresh lists `#88` ready and docs-only
- **THEN** no merge is run

#### Scenario: Demo
- **WHEN** the demo lists a ready docs-only pull request for a session that carries the record
- **THEN** nothing is run

### Requirement: Automatic shipping and merging respect task completion
Automatic implementation Ship and implementation docs-only Merge SHALL require a fresh bounded task summary proving every task checked. Awaiting, open, missing, malformed and truncated tasks SHALL withhold automation. Automatic proposal shipping and merging MAY precede task completion because proposals precede implementation. Archive delivery SHALL verify the archived task summary unless Archive was explicitly accepted with unresolved tasks under the explicit-action rules; that accepted archive SHALL still be published and its unresolved tasks displayed, without claiming completion. Fast-forward SHALL carry the completion instruction and SHALL use the same server gate rather than infer completion from the agent's exit alone.

#### Scenario: Fast-forward ends with a human check
- **WHEN** a Fast-forward agent exits cleanly with a task marked `- [~]`
- **THEN** the dashboard does not ship automatically, and interactive Ship still offers the unresolved-task choices

#### Scenario: Docs-only work has an old auto-merge record
- **WHEN** a previously shipped implementation has a ready docs-only PR but unresolved tasks in its checkout
- **THEN** the dashboard withholds automatic Merge

#### Scenario: Merged-PR cleanup observes a task-only follow-up
- **WHEN** Finish tasks or Finish checks is active and a refresh observes the session's previously merged pull request
- **THEN** automatic shipping, merging and merged-PR cleanup remain suppressed until an explicit new workflow choice; the follow-up agent stays available

## ADDED Requirements

### Requirement: Standard drafting uses proposal sessions
A managed Draft SHALL use a dedicated proposal branch and worktree regardless of docs auto-merge. It SHALL deliver verified planning artifacts under lifecycle-delivery, preserve configured Draft instructions and title conventions, and reuse existing proposal PRs. Draft sent into an implementation session SHALL NOT publish code as a proposal; mixed work SHALL be blocked with a recovery path.

#### Scenario: Docs automation is disabled
- **WHEN** Draft artifacts starts with docs auto-merge off
- **THEN** it uses `docs/<change>` and a completed proposal is automatically persisted and merged

#### Scenario: Existing proposal branch
- **WHEN** a resumed Draft already has an open proposal PR
- **THEN** checkpoint reconciliation updates that PR instead of opening another

### Requirement: Documentation merge eligibility is shared
Ship, automatic Merge, and their UI SHALL share a documentation-only classification of the exact PR head. It SHALL include `openspec/**`, `docs/**`, and Markdown or reStructuredText documents, and SHALL reject executable scripts, application code, workflows, manifests, lockfiles, and unknown paths. Renames SHALL classify both paths. A nonempty complete diff is required; unavailable or truncated evidence SHALL block merging.

#### Scenario: Documentation outside OpenSpec
- **WHEN** an eligible PR changes only `README.md` and `docs/usage.md`, docs auto-merge is on, and GitHub protections permit merging
- **THEN** it merges automatically using the same policy as an OpenSpec-only PR

#### Scenario: Code disguised by location
- **WHEN** a PR changes `docs/build.sh`, `.github/workflows/docs.yml`, or a package manifest
- **THEN** it is not automatically classified as documentation only

#### Scenario: Missing check evidence
- **WHEN** the cached PR has no checks and applicable required-check evidence cannot be read
- **THEN** the UI explains the verification blocker and no automatic merge occurs
