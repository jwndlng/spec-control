# Proposal

## Why

Docs auto-merge does not work for private repositories on GitHub's free plan. Ship and Archive append
`AUTO_MERGE_DOCS_INSTRUCTION` / `AUTO_MERGE_DOCS_ARCHIVE_INSTRUCTION`, which ask the agent to *enable GitHub's
auto-merge* on a docs-only pull request. That depends on three things the dashboard cannot rely on:

1. GitHub offers auto-merge (and branch protection and rulesets) on private repositories only on paid plans. On a free
   private repository `allow_auto_merge` stays `false`, so the agent's `gh pr merge --auto` is refused.
2. Auto-merge only queues a pull request that has something to wait for (required checks or reviews). Without branch
   protection no check is required, so a docs pull request that is already clean and green is never queued. GitHub
   expects a manual merge.
3. When enabling it fails, nothing retries. The pull request sits open with `autoMergeRequest: null`, and "A merged
   auto-merge pull request ends its session" never fires.

The dashboard already knows when such a pull request is ready. The board's pull-request watch reads `state`, `isDraft`,
`mergeable` and `statusCheckRollup` for the cards' pull requests every minute while checks run
(`src/ui/pullRequestsState.ts` `watchPlan`, `src/shared/pullRequestReadiness.ts`). So instead of asking the agent to
hand the decision to GitHub, the dashboard decides when the pull request is ready and then asks the agent to merge it.

The dashboard itself still never writes to GitHub. The agent opens the pull request today and will merge it too, in its
own session and behind its own permission prompts. This keeps invariants 1 and 4 unchanged: the dashboard's `gh` stays
read-only, and **Merge** becomes a third prompt-only action next to Ship and Resolve conflicts.

## What Changes

- **No more "enable auto-merge" instruction.** With docs auto-merge on, Ship and Archive no longer ask the agent to
  enable GitHub's auto-merge. They append a shorter instruction: open the pull request, do not merge it, and say
  whether it changes only files under `openspec/`. The session still records when it was asked (`autoMergeAskedAt`),
  which is what makes it eligible below.
- **The dashboard decides when the pull request is ready to merge.** Whenever a pull-request query for a repository
  completes (whatever started it), for each session that carries the record, still runs, and has an open pull request
  whose head branch is the session's branch, the dashboard checks all of the following from that query's result:
  - the repository still has docs auto-merge on, and this is not the demo;
  - the pull request is open, not a draft, its base is the repository's default branch, and `mergeable` is
    `mergeable`;
  - its checks are `passing`. **`none` does not count:** no checks at all could just mean CI has not registered yet,
    so a pull request without checks is never merged by this (it stays "ready" on the card, as today);
  - every file the pull request changes is under `openspec/`, as reported by GitHub for that pull request, not by the
    local worktree. The query gains the `files` JSON field of `gh pr list` (same subcommand, read-only), or a
    documented equivalent the design picks;
  - the dashboard has not already sent a Merge prompt for this head commit.
- **Merge prompt.** When every check holds, the dashboard sends a new fixed **Merge** prompt into the session's running
  agent through `submit.ts`: typed, echo-checked, with Enter as a separate key press, and nothing sent when the echo
  never appears, exactly like Ship. The prompt names the pull request number and the head commit the dashboard checked
  (`headRefOid`, added to the query's fields). It tells the agent to merge with the repository's convention and
  `--match-head-commit <sha>` (so GitHub refuses if anything was pushed since), not to delete the branch, and to stop
  and say why if the merge is refused. `prompts.merge` overrides the default. The session records when the prompt was
  sent and for which commit, and it is sent at most once per head commit.
- **Watching continues until the merge.** After a Merge prompt, the board's watch keeps that repository on its
  in-progress cadence until the pull request is merged, closed or gets a new head commit, even though it is "ready".
  Today `watchPlan` stops watching a pull request once it is ready. When the merge shows up, the existing requirement
  "A merged auto-merge pull request ends its session" applies unchanged: the session ends, and the worktree is removed
  under the same safety checks.
- **When nothing can be sent.** A session whose agent no longer runs gets no prompt and no restart. Its card shows that
  the pull request is ready to merge, and the user can open a session and send Merge from the action list like any other
  action. Merge is also offered manually for any change session with an open, ready pull request, with or without the
  opt-in. Only the automatic sending depends on it.
- **Wording.** The opt-in's label and help describe what now happens ("Spec Control asks the agent to merge docs-only
  pull requests once their checks pass"), not GitHub's auto-merge. The config key `agent.autoMergeDocs` keeps its name
  for compatibility.
- **Fast-forward stays as it is.** It never carries an auto-merge instruction, and its sessions get no record and no
  automatic Merge.

## Decisions to settle in design

- **Is the per-head-commit record enough?** It must stop a second Merge prompt while the first is still being
  answered, and allow a new one after the agent pushed a fix.
- **Field cost.** `files` on `gh pr list` can be large. It may need to be requested only for repositories that have the
  opt-in, or capped, with "too many files" treated as not docs-only.
- **What the panel shows** while a Merge prompt was sent and no merge has appeared yet, and when the echo check failed
  ("typed but not confirmed").

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-sessions`: the following requirements change:
  - "Ship asks the agent to commit, push and open a pull request": the docs instruction changes.
  - "Session starters run a fixed prompt for a validated change": the Archive docs instruction changes.
  - New requirement "Merge asks the agent to merge its ready pull request": the manual action.
  - New requirement "A ready docs-only pull request is handed to its agent to merge": when the Merge prompt is sent,
    the checks above, at most once per head commit.
  - "A merged auto-merge pull request ends its session": its trigger text refers to the record of the new instruction;
    the behaviour stays the same.
- `pull-requests`: the query's fields gain `headRefOid`, and `files` with `changedFiles` for opted-in repositories
  (still only `gh pr list`). The board's watch keeps
  a pull request whose Merge prompt is pending on the in-progress cadence.
- `project-overview`: the docs auto-merge setting's tooltip. The label stays: the pull request still merges on its
  own, only no longer through GitHub's auto-merge.
- `activity-feed`: a Merge prompt being sent is recorded, with who sent it and whether it was submitted.
- `dashboard-api`: no change to "The dashboard never writes to tracked repositories". This is stated explicitly
  because the dashboard runs no new git or `gh` subcommand and writes nothing on GitHub.

## Impact

- `src/shared/types.ts`: the Ship/Archive docs instructions, `DEFAULT_MERGE_PROMPT`, `prompts.merge`, and the
  session's Merge-prompt record.
- `src/server/sessions/agents.ts`: composing the Merge prompt.
- `src/server/sessions/manager.ts`: deciding and sending the Merge prompt after a pull-request query completes, next to
  `endMergedAutoMerge`.
- `src/server/pullRequests.ts`: the `headRefOid` and `files` fields, parsed defensively.
- `src/server/api.ts`: `POST /api/sessions/<id>/merge`, and handing a completed query to the Merge decision next to
  `endMergedAutoMerge`.
- `src/server/config.ts`: `prompts.merge` and its additional instructions in the profile schema.
- `src/server/activity/`: the Merge event.
- `src/shared/pullRequestReadiness.ts` and `src/ui/pullRequestsState.ts`: a "merge requested" state and the watch
  cadence for it.
- `src/ui/`: the Merge action, the card and panel wording, and the settings label.
- `test/fixtures/fake-gh.ts` scenarios, and tests for every check above (including `checks: none`, a non-docs file, a
  draft, a conflict, a changed head commit, the agent not running, the opt-in switched off, and the demo).
- `src/ui/changelog.ts`: a What's new entry.
- Invariants 1, 2, 2a and 4 are unchanged: no new network access, no new `gh` or git subcommand, and nothing written to
  a repository or to GitHub by the dashboard. CLAUDE.md's "Agent sessions" section is updated to describe Merge as a
  prompt-only action instead of the agent enabling auto-merge.
