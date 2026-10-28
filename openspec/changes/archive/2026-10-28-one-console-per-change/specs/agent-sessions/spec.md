## ADDED Requirements

### Requirement: The proposal session gives way to the next step
While a change's running session is a **Draft artifacts** session on `docs/<change>`, the dashboard SHALL accept a request to open **Implement**, **Validate** or **Archive** for that change — never Draft, which goes into that session, and never Fast-forward — that explicitly asks to end the proposal session first. It SHALL first apply every refusal an opening is subject to (the change's stage, its dependencies, the repository's agent), so a refused request ends nothing. It SHALL then end the proposal session as **End session** does and wait until its agent has ended, and only then open the requested action as a new session under the usual rules — Implement on `feat/<change>`, created from the local `docs/<change>` while the default branch does not hold the change, as "Every session works in its own git worktree, created by the dashboard" specifies. Ending it SHALL keep the proposal session's worktree and branch whatever their work status, because its pull request may still be open: it MUST NOT remove a worktree, delete a branch or run any git command beyond those the new session's worktree needs. The ended proposal session SHALL keep its auto-merge record. When its agent does not end, the request SHALL be refused and nothing SHALL be started. The result SHALL be the new session. A request without that explicit ask is refused as "Session lifecycle and control" says, so a card or a stale page can never end an agent by starting a step.

#### Scenario: Implement after the proposal
- **WHEN** the Draft session of `rotate-keys` runs on `docs/rotate-keys`, the change is in `Ready`, the proposal is pushed with `#90` open, and Implement is opened asking to end the proposal session first
- **THEN** the Draft session ends, worktree `docs-rotate-keys` and branch `docs/rotate-keys` are kept, a new session starts on `feat/rotate-keys` created from `docs/rotate-keys`, and exactly one session of `rotate-keys` is running

#### Scenario: Not available yet
- **WHEN** the change is still in `Drafts` and Implement is opened asking to end its proposal session first
- **THEN** the request is refused because Implement is not available, and the Draft session keeps running

#### Scenario: The agent does not end
- **WHEN** the proposal session's agent cannot be ended
- **THEN** the request is refused, no new session or worktree is created, and the proposal session is shown as it is

### Requirement: An ended proposal session's pull request is merged through the change's running session
A Draft session on `docs/<change>` that has ended, carries the auto-merge record, was not ended by the dashboard (`autoEnded`) and whose worktree still exists is an **ended proposal session**. Its pull request — the open pull request whose head branch is `docs/<change>` — SHALL be handed to the change's running session to merge: whenever a pull-request query for the repository completes with a good list, the dashboard SHALL apply every condition of "A ready docs-only pull request is handed to its agent to merge" to that pull request and to the ended proposal session's worktree, except that instead of the proposal session running it SHALL require that exactly one session of the change runs, that it is not in place and did not adopt its worktree. When all hold, it SHALL send that running session the Merge prompt, composed as "Merge asks the agent to merge its ready pull request" composes it and followed by one more fixed sentence saying that this pull request is the change's proposal from branch `docs/<change>`, not the branch of this worktree. It SHALL record the pull request and head commit on the ended proposal session before anything is typed, so the at-most-once rule holds per proposal pull request and head commit whichever session received it. The running session's panel SHALL offer the same Merge for that pull request while it is ready, composed the same way. Without a running session of the change nothing SHALL be sent and no agent started; the pull request is shown as ready, as for any session whose agent does not run. Once a query lists that pull request merged, "A merged auto-merge pull request ends its session" applies to the ended proposal session unchanged, so its clean worktree is removed and its branch kept. The dashboard itself MUST NOT merge, run `gh` or git that writes, start a query, a timer or a fetch for any of this.

#### Scenario: The proposal goes green while implementing
- **WHEN** `demo-ops` has docs auto-merge on, the Draft session of `rotate-keys` ended when Implement started, it carries the auto-merge record, its worktree is at `#90`'s head commit with only `openspec/` changes, the Implement session on `feat/rotate-keys` runs, and a refresh lists `#90` from `docs/rotate-keys` ready and docs-only
- **THEN** one Merge prompt naming `#90`, its head commit and branch `docs/rotate-keys` is submitted to the Implement session's terminal, and the ended Draft session records it

#### Scenario: Nobody to ask
- **WHEN** the same holds but no session of `rotate-keys` runs
- **THEN** nothing is typed, no agent is started, and the card shows `#90` as ready

#### Scenario: The proposal merges
- **WHEN** a later refresh lists `#90` merged after the recorded time
- **THEN** the clean worktree `docs-rotate-keys` is removed, branch `docs/rotate-keys` is kept, and the Implement session keeps running

## MODIFIED Requirements

### Requirement: Session lifecycle and control
A session SHALL be `running` while its agent process lives, `exited` with the process's exit code once it has ended, or `failed` when the agent could not be started. At most one session per change may be running, and no two sessions may run in the same worktree. A **Draft artifacts** session on `docs/<change>` ("A Draft session in a docs auto-merge project opens its proposal pull request") counts like any other, so a change never has two consoles and no other session of the change runs beside it. A request to open a session for a change that already has one running SHALL return that running session and SHALL start no second process, create no second worktree and send nothing to a terminal, whatever action was asked for — **Archive** included — except that a running session on `docs/<change>` SHALL be returned only for Draft: a request for any other action SHALL be refused with a reason naming that branch unless it asks to end that session first ("The proposal session gives way to the next step"), and sending any action but Draft into the session on `docs/<change>` SHALL be refused with a reason naming its branch. A card SHALL offer no starter while any session of its change runs, the session on `docs/<change>` included (`kanban-board`: "Cards offer session starters and show session state"). The refusals an opening is subject to still come first, so an action the change's stage does not allow is refused rather than answered with the running session. Where a session runs in place, in a tracked folder that is not a git repository, the same rule keeps a second agent out of that folder. **End session** SHALL terminate the agent as closing its terminal window would (hang-up, then a forced kill if it does not exit). When the agent's profile has a resume command, an ended session SHALL offer **Resume**, which starts that command in the same worktree within the same session; Resume SHALL be refused, and nothing started, while another session of the same change is running. Because a terminal cannot outlive the process that owns it, stopping the dashboard MUST end every agent, and sessions recorded as running at start-up MUST be shown as ended with that reason.

#### Scenario: Duplicate open
- **WHEN** a session for a change is running and the same starter is used again
- **THEN** the existing session is returned and no second process is started

#### Scenario: Archive next to a running session
- **WHEN** a change's Implement session is still running, the change is in `Done`, and Archive is opened for it
- **THEN** no second session starts: the running session is returned, no archive worktree or branch is created, and Archive can instead be sent into that session

#### Scenario: A folder without git keeps one agent
- **WHEN** a session is running for a change in a tracked folder that has no `.git`, and Archive is opened for that change
- **THEN** the running session is returned and no second agent is started in that folder

#### Scenario: Agent exits
- **WHEN** the user quits the agent from within the terminal
- **THEN** the session becomes `exited` with the exit code, every attached viewer is told, and the terminal's output remains viewable

#### Scenario: Resume
- **WHEN** an ended session's agent has the resume command `claude`, `--continue` and the user presses Resume
- **THEN** that command is started in the session's worktree and the session is `running` again

#### Scenario: Dashboard stopped
- **WHEN** the dashboard receives a termination signal while a session is running
- **THEN** the agent is ended and the session is recorded as ended because the dashboard was stopped

#### Scenario: Implement beside the proposal session
- **WHEN** the Draft session of `rotate-keys` runs on `docs/rotate-keys` and Implement is opened for `rotate-keys` without asking to end that session
- **THEN** the request is refused with a reason naming `docs/rotate-keys`, no second session starts and no worktree is created

#### Scenario: Resume beside a running session
- **WHEN** the ended Draft session of `rotate-keys` on `docs/rotate-keys` has a resume command and the change's Implement session on `feat/rotate-keys` is running
- **THEN** Resume of the Draft session is refused and no process is started

#### Scenario: Implement sent into the proposal session
- **WHEN** Implement is sent into the running session on `docs/rotate-keys`
- **THEN** it is refused with a reason naming `docs/rotate-keys`, and nothing is typed


### Requirement: A ready docs-only pull request is handed to its agent to merge
Whenever a pull-request query for a repository completes with a good list — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL, for each change session of that repository that carries the auto-merge record of "A merged auto-merge pull request ends its session", is running, is not in place and did not adopt its worktree — and for each ended proposal session as "An ended proposal session's pull request is merged through the change's running session" extends this — look in that query's result for an open pull request whose head branch is the session's branch, and SHALL send that session a Merge prompt, exactly as the Merge action composes and submits it, only when **all** of these hold at that moment:

- agent sessions are enabled, the repository has docs auto-merge switched on, and this is not the demo;
- the pull request is open and not a draft, its base branch is the repository's default branch, its mergeability is `mergeable` and its checks are `passing` — checks `none` SHALL NOT count, because a pull request whose checks have not registered yet looks the same;
- the pull request is docs-only (`pull-requests`: "What a pull-request list contains") and carries a head commit;
- the session's worktree's checked-out commit is that head commit, and the worktree holds only OpenSpec documents under the check Ship makes — decided with read-only git, without contacting a remote, at that moment; a git command that fails counts as not holding;
- no Merge prompt was sent to this session, by the dashboard or by the user, for this pull request at this head commit.

When it sends one, the session SHALL record the pull request's number, the head commit and the time, whether or not the prompt was submitted, before anything is typed, so that a second query completing meanwhile sends nothing more. At most one Merge prompt SHALL be sent per session, pull request and head commit; a new head commit makes the pull request eligible again. A Merge prompt that was typed but not confirmed SHALL NOT be retyped automatically: the panel SHALL say that the Merge prompt was typed but not sent and that Enter in the terminal sends it. The dashboard SHALL decide this only from the completed query and read-only git: it MUST NOT start a pull-request query, a `gh` process, a timer or a fetch for it, and MUST NOT start, resume or restart an agent — a session whose agent does not run gets nothing, and its card and panel show the pull request as ready like any other, with Merge offered once it is resumed. While a Merge prompt sent for a pull request's current head commit has not been followed by that pull request merging or closing, the session's panel and its card SHALL say that the agent was asked to merge `#<number>`. Sessions started by Fast-forward never carry the record and SHALL never be sent a Merge prompt on their own.

#### Scenario: Archive pull request goes green
- **WHEN** `demo-ops` has docs auto-merge on, the running archive session of `rotate-keys` carries the auto-merge record, its worktree is at commit `c0ffee…` with only `openspec/` changes, and a watch refresh lists `#88` from `archive-rotate-keys` open against the default branch, not a draft, mergeable, checks passing, docs-only, head commit `c0ffee…`
- **THEN** the Merge prompt naming `#88` and `c0ffee…` is submitted to that session's terminal, the session records it, its card says the agent was asked to merge `#88`, and the dashboard ran no `gh` and no git that writes for it

#### Scenario: No checks at all
- **WHEN** everything holds except that `#88` has no checks
- **THEN** no Merge prompt is sent and `#88` is shown as ready as before

#### Scenario: A file outside openspec
- **WHEN** everything holds except that `#88` is not docs-only
- **THEN** no Merge prompt is sent

#### Scenario: Draft, conflict or another base
- **WHEN** everything holds except that `#88` is a draft, or conflicts with its base, or targets a branch other than the default branch
- **THEN** no Merge prompt is sent

#### Scenario: The worktree is ahead of the pull request
- **WHEN** everything holds except that the worktree's commit is not `#88`'s head commit
- **THEN** no Merge prompt is sent

#### Scenario: Seen again
- **WHEN** a later refresh lists `#88` still open at the same head commit after a Merge prompt for it was sent
- **THEN** nothing more is typed into the session

#### Scenario: A fix was pushed
- **WHEN** the agent's merge was refused because a check failed, the agent pushed a fix, and a later refresh lists `#88` ready again at a new head commit with checks passing
- **THEN** one Merge prompt naming the new head commit is sent

#### Scenario: The agent has exited
- **WHEN** everything holds except that the session's agent no longer runs
- **THEN** no agent is started or resumed, nothing is typed, and the card shows `#88` as ready

#### Scenario: Docs auto-merge switched off
- **WHEN** the user switched docs auto-merge off for `demo-ops` after Ship carried the instruction, and a refresh lists `#88` ready and docs-only
- **THEN** no Merge prompt is sent

#### Scenario: Typed but not confirmed
- **WHEN** the dashboard sends the Merge prompt while the agent shows a selection menu, so its echo never appears
- **THEN** no Enter is pressed, the session records the Merge prompt for that head commit, the panel says it was typed but not sent, and later refreshes do not type it again

#### Scenario: Demo
- **WHEN** the demo lists a ready docs-only pull request for a session that carries the record
- **THEN** nothing is sent


### Requirement: Merge asks the agent to merge its ready pull request
For a running change session that is not in place and whose branch is the head branch of an **open** pull request in the session's repository's last good pull-request list, — and, for the proposal pull request of the change's ended proposal session, as "An ended proposal session's pull request is merged through the change's running session" extends this — the dashboard SHALL offer a **Merge** action while that pull request is ready (`pull-requests`: "A linked open pull request has a readiness") and carries a head commit, whether or not the project has docs auto-merge on. Merge is a prompt, not a starter: it uses the agent profile's Merge prompt, or an agent-neutral default asking the agent to merge the pull request of this worktree's branch into its base with the merge method this repository uses, only if its head is still the commit named — with the GitHub CLI, `gh pr merge <number> --match-head-commit <commit>` — not to delete the branch, and, if the merge is refused or anything was pushed since, to stop and say why. `{change}` SHALL be the profile prompt's only placeholder. After the profile's prompt and its additional Merge instructions the dashboard SHALL append, separated by one space, a fixed sentence naming the pull request as `#<number>` and its head commit as the full 40-character object name, both taken from the pull-request list after validation (a positive integer; exactly 40 hexadecimal characters) and never from the browser. The composed prompt SHALL be one line and SHALL be submitted to the session's terminal under the rules for text sent on the user's behalf; the result SHALL state whether it was submitted, and when it was only typed the panel SHALL say so.

A Merge request SHALL be refused, and nothing written to the terminal, when the session is not running, is in place, has no linked open pull request in the last good list, or that pull request is not ready or has no head commit. Merge SHALL NOT start, resume or restart an agent: for an ended session the user resumes it first. The dashboard itself MUST NOT merge, enable auto-merge, run `gh` or git, or contact a remote for it; whether the pull request merged is learned only from a later pull-request query. No other prompt SHALL carry the Merge sentence.

#### Scenario: Merging a ready pull request by hand
- **WHEN** the Implement session of `cache-api-calls` runs, its branch `feat/cache-api-calls` heads open pull request `#41` whose checks pass and which is mergeable, and the user activates Merge in its panel
- **THEN** one line is submitted to its terminal: the default Merge prompt followed by a sentence naming `#41` and its head commit, Enter is pressed as a separate key press once the terminal shows it, and no `gh` or git process is started by the dashboard

#### Scenario: Not ready
- **WHEN** Merge is requested for a session whose pull request's checks are still running
- **THEN** the request is refused and nothing is written to the terminal

#### Scenario: Ended session
- **WHEN** Merge is requested for a session whose agent has exited
- **THEN** the request is refused, nothing is started, and the panel offers to resume the session first

#### Scenario: A profile's own Merge prompt
- **WHEN** the profile's Merge prompt is `Squash-merge the pull request for {change}.` and Merge is used for `cache-api-calls`
- **THEN** the submitted line is `Squash-merge the pull request for cache-api-calls.` followed by the sentence naming the pull request and its head commit

