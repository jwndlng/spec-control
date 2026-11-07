# Spec Delta

## ADDED Requirements

### Requirement: A merged pull request ends its session when nothing would be lost
Unless `agentSessions.endMergedSessions` is `false` (absent means on), whenever a pull-request query for a repository completes — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL look in that query's result for each change session of that repository that is not in place, did not adopt its worktree, does not already carry an automatic end, is not decided by "A merged auto-merge pull request ends its session", and whose worktree still exists or whose agent still runs. It SHALL act on a session only when the result holds a pull request that is in the merged state, whose head branch is the session's branch, that the list says is not from a fork, whose base is the repository's default branch as known locally, and whose merge time is later than the time the session's agent was last started; and only when read-only git shows, at that moment, that the session's worktree holds no uncommitted or untracked change and either has that pull request's head commit checked out or has the work status `merged`. When any of these does not hold, nothing SHALL be ended, removed or recorded, so a later query decides afresh.

When they all hold the dashboard SHALL, without asking, end the session's agent as ending the session does, and then remove its worktree under exactly the rules of "Worktree clean-up is offered only when safe" and "A worktree is not removed while another session runs in it": by a non-forcing `git worktree remove`, and keeping the worktree, with the reason, when those checks refuse at that moment. It SHALL decide this only from the completed query's result and read-only git; it MUST NOT start a pull-request query, a `gh` process or a timer for it, MUST NOT fetch, and MUST NOT delete the session's branch or any other ref — the branch is left for repository cleanup, and a stale change's leftovers for **Clean up leftovers…** on the board. A session this ended SHALL keep, and its panel and card SHALL show, exactly as for "A merged auto-merge pull request ends its session", that it was ended because pull request `#<number>` merged and whether its worktree was removed or why it was kept; the same merged pull request found again SHALL change nothing more. In the demo nothing SHALL be ended or removed.

#### Scenario: Archive pull request merged by the user
- **WHEN** docs auto-merge is off for `demo-ops`, the archive session of `rotate-keys` on `chore/archive-rotate-keys` opened `#88`, the user merged `#88` on GitHub, and the board's pull-request watch lists it merged while the worktree is clean with `#88`'s head commit checked out
- **THEN** the session's agent is ended, its worktree is removed by a non-forcing `git worktree remove`, branch `chore/archive-rotate-keys` still exists locally, and the panel and card say the session ended because `#88` merged and its worktree was removed

#### Scenario: Session already ended by the user
- **WHEN** the user ended the Implement session of `rotate-keys` and kept its clean worktree, and a later refresh lists the session's pull request merged after the agent was last started
- **THEN** the worktree is removed when the checks allow it, no agent is started or ended, and the session records that it ended because that pull request merged

#### Scenario: The agent has moved on
- **WHEN** a session's pull request `#91` is listed merged, but its worktree holds an uncommitted file or has a commit checked out that is not `#91`'s head commit and its work status is not `merged`
- **THEN** the session keeps running, its worktree is kept, and nothing is recorded

#### Scenario: A pull request that merged before the agent was resumed
- **WHEN** a session's pull request `#91` merged at 10:00 and the user resumed the session at 10:05 to keep working on the same branch
- **THEN** no later query listing `#91` ends the session or removes its worktree

#### Scenario: Switched off
- **WHEN** `agentSessions.endMergedSessions` is `false`, docs auto-merge is off, and a refresh lists a session's pull request merged while its worktree is clean on that pull request's head commit
- **THEN** the session keeps running and its worktree is kept

#### Scenario: Not its own pull request
- **WHEN** the merged pull request with the session's branch as head is from a fork, or was merged into `release-1` instead of the default branch
- **THEN** the session keeps running and its worktree is kept

#### Scenario: Sessions this never touches
- **WHEN** a refresh lists merged a pull request whose head branch is the branch of an in-place session, of a session that adopted a worktree the user created, or of nothing but a project console's checkout
- **THEN** nothing is ended or removed

#### Scenario: No query, no action
- **WHEN** a session's pull request merges on GitHub while no view that queries pull requests is open
- **THEN** the session keeps running and no `gh` or git process is started for it until a pull-request query runs

### Requirement: Ending sessions on merge is a setting in Agent sessions
The configuration's `agentSessions.endMergedSessions` SHALL decide whether "A merged pull request ends its session when nothing would be lost" applies; absent means `true`. The Settings page SHALL show it in its **Agent sessions** section as a checkbox labelled **End sessions whose pull request merged**, ticked when the value is absent or `true`, saved with the rest of Settings; its hover description SHALL say that once a session's own pull request is seen merged, the dashboard ends its agent and removes its worktree when nothing in it would be lost, keeps its branch, and that the session can be resumed. Saving it ticked SHALL save the configuration without the key; saving it cleared SHALL save `false`. It SHALL NOT change "A merged auto-merge pull request ends its session", which the project's Docs auto-merge setting governs.

#### Scenario: On by default
- **WHEN** the configuration has no `endMergedSessions` and the user opens Settings
- **THEN** **End sessions whose pull request merged** is ticked in the Agent sessions section

#### Scenario: Switching it off
- **WHEN** the user clears the checkbox and saves Settings
- **THEN** the saved configuration has `agentSessions.endMergedSessions: false` and every other setting is unchanged

#### Scenario: Switching it back on
- **WHEN** `endMergedSessions` is `false` and the user ticks the checkbox and saves
- **THEN** the saved configuration holds no `endMergedSessions` key

### Requirement: A session records when its agent was last started
A change session SHALL record the time its agent was last started — when the session is opened, resumed, or started again for Ship or Resolve conflicts — persisted with the session record. A session record that predates this SHALL read its creation time instead. Starting the agent of a session that carries an automatic end — from "A merged auto-merge pull request ends its session" or "A merged pull request ends its session when nothing would be lost" — SHALL clear that end, so the panel and card no longer show it and the session can be ended again by a pull request that merges after this start, never by the one it was ended for. Resuming such a session SHALL re-create its worktree on its kept branch under the existing resume rules.

#### Scenario: Re-opening a session the dashboard ended
- **WHEN** the dashboard ended the archive session of `rotate-keys` because `#88` merged and removed its worktree, and the user resumes the session
- **THEN** the worktree is re-created on `chore/archive-rotate-keys`, the agent starts, the panel no longer says it ended because `#88` merged, and later queries listing `#88` merged end nothing

#### Scenario: A record from before
- **WHEN** a session record saved by an earlier version has no start time and a refresh lists its pull request merged after the record's creation time
- **THEN** the creation time is used as the time the agent was last started

## MODIFIED Requirements

### Requirement: Worktree clean-up is offered only when safe
When ending or cleaning up a session, or for a worktree that has no session record, the dashboard SHALL offer to remove the worktree only if the dashboard created it, it has no uncommitted changes, and either its work status is `merged` or it has no commits that exist nowhere else (nothing ahead of its upstream, or, without an upstream, no commit that is unreachable from every other local or remote-tracking branch). Removal SHALL happen only after the user confirms, by a non-forcing `git worktree remove` — the exceptions are the automatic removals when a session's own pull request has merged, under the same checks, as specified in "A merged auto-merge pull request ends its session" and "A merged pull request ends its session when nothing would be lost"; removing a session's worktree from the session views never deletes its branch — deleting merged branches is done only by repository cleanup, as specified in the `repository-cleanup` capability. Otherwise the worktree MUST be kept and the reason shown. A worktree MUST NOT be removed while a session is running in it. A worktree that a session adopted MUST NOT be offered for removal by the session views and MUST NOT be removed by them; it MAY be removed by repository cleanup under that capability's rules, like any other linked worktree the user created, when no session is running in it. An in-place session has no worktree: removal MUST NOT be offered for it, and ending it SHALL end the agent and nothing else.

#### Scenario: Unpushed work
- **WHEN** the user ends a session whose worktree has commits that exist only on its branch
- **THEN** removal is not offered, the worktree is kept, and the panel explains why

#### Scenario: Clean worktree
- **WHEN** the worktree is clean, its commits exist elsewhere, and the user confirms removal
- **THEN** the worktree is removed

#### Scenario: Squash-merged and the remote branch is gone
- **WHEN** the worktree is clean, its work status is `merged`, its upstream no longer exists, and the user confirms removal
- **THEN** the worktree is removed and its local branch still exists

#### Scenario: Adopted worktree
- **WHEN** the user ends a session that adopted a worktree the user had created, and that worktree is clean
- **THEN** removal is not offered and the worktree is kept

#### Scenario: Adopted worktree in repository cleanup
- **WHEN** the session that adopted a clean, merged worktree has ended and the user opens repository cleanup
- **THEN** the worktree is listed as removable there, and is removed only if the user confirms

#### Scenario: Ending an in-place session
- **WHEN** the user ends a session that ran in a folder that is not a git repository
- **THEN** the dialog offers neither a worktree removal nor a pull, and confirming ends the agent and leaves the folder untouched

### Requirement: A merged auto-merge pull request ends its session
When the dashboard appends the Ship or Archive auto-merge instruction, or the proposal instruction of a Draft session ("A Draft session in a docs auto-merge project opens its proposal pull request"), to a prompt for a change session — starting the session, sending the action into its running session, or Ship — it SHALL record on that session the time it did so (the latest such time when it happens more than once). The same record is what makes a session eligible for an automatic Merge prompt ("A ready docs-only pull request is handed to its agent to merge"); a Merge prompt SHALL NOT change it. A session without that record SHALL never be ended or have its worktree removed by this requirement; it MAY still be ended by "A merged pull request ends its session when nothing would be lost". A session this requirement applies to at the moment a query completes SHALL be decided by this requirement alone, whatever `agentSessions.endMergedSessions` says.

Whenever a pull-request query for a repository completes — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL look in that query's result for each session of that repository that carries the record, is not in place and did not adopt its worktree, and whose worktree still exists or whose agent still runs. When the result holds a pull request in the merged state whose head branch is that session's branch and whose merge time is later than the recorded time, and the repository has auto-merge of docs-only pull requests switched on at that moment, the dashboard SHALL, without asking, end the session's agent as ending the session does, and then remove its worktree under exactly the rules of "Worktree clean-up is offered only when safe": by a non-forcing `git worktree remove`, only when it holds no uncommitted change and either its work status is `merged` or no commit exists only on its branch. When those checks refuse, the agent SHALL still be ended, the worktree SHALL be kept, and the session SHALL keep the reason. It SHALL decide this only from the pull-request query's result and read-only git; it MUST NOT start a pull-request query, a `gh` process or a timer for it, MUST NOT fetch, and MUST NOT delete the session's branch or any other ref — the branch is left for repository cleanup. A session that this ended SHALL keep, and its panel and card SHALL show, that it was ended because pull request `#<number>` merged, and whether its worktree was removed or why it was kept. A merged pull request found again in a later query SHALL change nothing more. In the demo nothing SHALL be ended or removed.

#### Scenario: Archive pull request merges while the board is watching
- **WHEN** a repository has docs auto-merge on, the archive session of `rotate-keys` was started with the archive auto-merge instruction, its agent pushed branch `archive-rotate-keys` and opened `#88`, the dashboard sent it a Merge prompt once `#88` was ready, and a later pull-request watch refresh shows `#88` merged
- **THEN** the session's agent is ended, its clean, pushed worktree is removed, branch `archive-rotate-keys` still exists locally, and the panel says the session ended because `#88` merged and its worktree was removed

#### Scenario: Nothing was asked
- **WHEN** a pull-request refresh shows the pull request of an Implement session's branch merged, that session's prompts never carried the auto-merge instruction, and `agentSessions.endMergedSessions` is `false`
- **THEN** the session keeps running and its worktree is kept

#### Scenario: Auto-merge switched off since
- **WHEN** the user switched docs auto-merge off for the repository after the Ship that carried the instruction, `agentSessions.endMergedSessions` is `false`, and a refresh then shows that pull request merged
- **THEN** the session keeps running and its worktree is kept

#### Scenario: Uncommitted work with auto-merge still ends the agent
- **WHEN** the auto-merge pull request of a session in a project with docs auto-merge on has merged, `agentSessions.endMergedSessions` is absent, and the worktree has an uncommitted file
- **THEN** this requirement decides: the agent is ended and the worktree is kept with the reason, as without the setting

#### Scenario: An earlier pull request of the same branch
- **WHEN** a session's prompt carried the auto-merge instruction at 10:00 and the refresh shows a pull request of its branch that merged at 09:30
- **THEN** nothing is ended or removed

#### Scenario: Uncommitted work keeps the worktree
- **WHEN** the auto-merge pull request of a session has merged and its worktree has an uncommitted file
- **THEN** the agent is ended, the worktree is kept, and the panel says the worktree was kept because it has uncommitted changes

#### Scenario: Already ended by the user
- **WHEN** the user ended a session but kept its worktree, and a later refresh shows its auto-merge pull request merged
- **THEN** the worktree is removed when the checks allow it, and no agent is started or ended

#### Scenario: No query, no action
- **WHEN** the auto-merge pull request of a running session merges on GitHub while no view that queries pull requests is open
- **THEN** the session keeps running and no `gh` or git process is started for it until a pull-request query runs

#### Scenario: Seen again
- **WHEN** a later refresh shows the same merged pull request for a session this already ended
- **THEN** nothing else is ended, removed or recorded

#### Scenario: Proposal pull request merges
- **WHEN** the Draft session of `rotate-keys` on `docs/rotate-keys` was started with the proposal instruction, its agent opened `#90`, and a later refresh shows `#90` merged after that time while docs auto-merge is on
- **THEN** the session's agent is ended, its clean, pushed worktree `docs-rotate-keys` is removed, branch `docs/rotate-keys` still exists locally, and the panel says the session ended because `#90` merged
