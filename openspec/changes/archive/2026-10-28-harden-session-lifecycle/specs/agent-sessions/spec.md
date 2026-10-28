## ADDED Requirements

### Requirement: A prompt the dashboard types is checked before anything is started or recorded
Every prompt the dashboard types into an agent's terminal — an opening prompt typed after start-up because the profile's command has no `{prompt}` argument, a Ship or Resolve conflicts prompt handed to a resume command, and any prompt sent into a running session (a sent action, Ship, Resolve conflicts, Merge) — SHALL be typed as one line: every run of whitespace in it, line breaks included, SHALL be replaced by one space and leading and trailing whitespace removed. A prompt passed to the agent as an argument SHALL be passed unchanged.

Before the dashboard starts or restarts an agent for such a prompt, and before it changes the session's recorded action or its auto-merge record, it SHALL check that one-line form against the rules for submitted text (plain text of at most 4096 characters, no control character). When the form does not satisfy them, the request SHALL be refused with a reason saying why, no agent SHALL be started, restarted or typed into, and the session's action and auto-merge record SHALL stay as they were. A refusal of text to be submitted SHALL always be reported to the caller of the submission as a failed result, never raised outside it, and nothing the dashboard types into a terminal — on a timer after start-up included — SHALL be able to end the dashboard or any other session.

#### Scenario: A multi-line prompt typed after start-up
- **WHEN** a profile's command has no `{prompt}` argument, its Implement prompt is `implement {change}` followed by a line break and `and run the tests`, and the user starts Implement for `upgrade-runtime`
- **THEN** the agent starts, the prompt `implement upgrade-runtime and run the tests` is typed as one line and submitted under the usual echo rule, and the dashboard and every other session keep running

#### Scenario: Ship through the resume command with a prompt that cannot be typed
- **WHEN** an ended session's profile has a resume command, and the composed Ship prompt is longer than 4096 characters even as one line
- **THEN** Ship is refused with a reason naming the length, no agent is started, the session stays ended, and it carries no new auto-merge record

#### Scenario: An action sent into a running session is refused
- **WHEN** Archive is sent into the running Implement session of `rotate-keys` with docs auto-merge on, and the composed Archive prompt cannot be typed
- **THEN** the request is refused, nothing is typed, the session's action is still Implement, and its auto-merge record is unchanged

#### Scenario: The session ends before the typed prompt
- **WHEN** an agent started for a typed opening prompt exits before the prompt is typed
- **THEN** nothing is typed, and the dashboard and every other session keep running

### Requirement: A worktree is not removed while another session runs in it
Removing a session's worktree — when the user ends the session with removal confirmed, and when a merged auto-merge pull request ends a session ("A merged auto-merge pull request ends its session") — SHALL be refused when any session other than the one being ended is running in that worktree, or a session that would run in it is being started, compared as canonical paths. The refusal SHALL be decided after the ended session's agent has ended and before any git command that writes runs. The ended session's agent SHALL still be ended, the worktree SHALL be kept, and the reason SHALL say that a session is running in this worktree; for a session ended because its pull request merged, that outcome SHALL be recorded as for any other check that keeps the worktree, and a later query listing the same pull request SHALL change nothing more.

#### Scenario: A merged auto-merge pull request while a later session works in the worktree
- **WHEN** the Implement session of `rotate-keys` carried the auto-merge instruction and was ended with its worktree kept, a new Implement session of `rotate-keys` runs in that same worktree, and a refresh lists the first session's pull request merged after its record
- **THEN** the worktree is not removed, the running session and its agent are untouched, and the first session records that it ended because the pull request merged and that its worktree was kept because a session is running in it

#### Scenario: Ending one of two sessions in one worktree
- **WHEN** two session records share a worktree, one of them is running, and the user ends the other with worktree removal confirmed
- **THEN** the ended session's agent is ended, the worktree is kept, and the dialog says that a session is running in this worktree

### Requirement: A change's sessions are started one at a time
Every start of a change session — opening a session for a change, opening one on a pull request's head branch to resolve conflicts, resuming an ended session, and restarting an ended session for Ship or Resolve conflicts — and every removal of a session worktree of that change SHALL wait until any other of these in progress for the same change has finished, and SHALL then make its checks afresh. A second request to open a session for a change while the first is still starting SHALL therefore return the session the first one started, and a second request to resume a session while the first is still starting SHALL find it running and return it; neither SHALL start a second agent process or create a second worktree. Ending a session without removing its worktree SHALL NOT wait for a start of its change.

#### Scenario: Two opens at once
- **WHEN** the worktree of `rotate-keys` was kept by an ended session and two requests to open Implement for `rotate-keys` arrive in the same moment
- **THEN** exactly one agent is started, both requests return the same session, and exactly one session runs in that worktree

#### Scenario: Two resumes at once
- **WHEN** two requests to resume the same ended session arrive in the same moment
- **THEN** exactly one agent process is started, and ending the session afterwards leaves no agent process of it running

### Requirement: A reused worktree belongs to the repository and the session's branch
When a new session finds its worktree's directory already present, it SHALL reuse it only when read-only git proves that the directory is a linked worktree of the session's repository — its common git directory is the repository's — and that its checked-out branch is the session's branch. Otherwise starting the session SHALL be refused with a reason naming what the directory is (another repository's, not a git worktree, or on another branch, naming that branch), before any agent is started and without creating, removing or changing anything. When an ended session is started again in its own worktree, the directory SHALL only have to be a linked worktree of the session's repository; the branch its agent has checked out there is accepted, and its work status keeps reporting the branch git reports.

#### Scenario: Left on another branch
- **WHEN** Resolve conflicts left the worktree `rotate-keys` on `feat/rotate-keys-v2` and the user then starts Implement for `rotate-keys`
- **THEN** starting is refused with a reason saying the worktree is on `feat/rotate-keys-v2`, not `feat/rotate-keys`, no agent is started, and the worktree is unchanged

#### Scenario: A leftover folder inside another repository
- **WHEN** the worktree directory for `rotate-keys` exists but is an empty folder inside a different git repository, and the user starts Implement for `rotate-keys`
- **THEN** starting is refused with a reason saying the folder is not a worktree of this repository, and nothing is created

#### Scenario: Resuming after the agent switched branch
- **WHEN** a session's agent checked out another branch in its own worktree, the session ended, and the user resumes it
- **THEN** the agent is started again in that worktree

### Requirement: A merged pull request ends only its own session
"A merged auto-merge pull request ends its session" SHALL apply to a merged pull request only when, besides its head branch being the session's branch and its merge time later than the session's record, it is not from a fork — the pull-request list says its head is in the same repository — and its base is the repository's default branch as known locally. A merged pull request from a fork, one whose list entry does not say whether it is from a fork, and one into another base SHALL end nothing and remove nothing.

#### Scenario: A fork's pull request with the same branch name
- **WHEN** a session on `feat/rotate-keys` carries the auto-merge record and a refresh lists a merged pull request whose head is `feat/rotate-keys` in a fork
- **THEN** the session keeps running and its worktree is kept

#### Scenario: Into another base
- **WHEN** the merged pull request of the session's branch was merged into `release-1`, not into the default branch
- **THEN** the session keeps running and its worktree is kept

### Requirement: A prompt placed inside an argument is inserted literally
When a profile's command holds `{prompt}` inside a longer argument, such as `--prompt-interactive={prompt}`, the dashboard SHALL replace it with the prompt exactly as composed, so that no character sequence in the prompt — `$&`, `` $` ``, `$'` or any other — is interpreted.

#### Scenario: Dollar signs in a prompt
- **WHEN** a profile's command is `agy`, `--prompt-interactive={prompt}` and its Implement prompt for `rotate-keys` contains `cost is $& and $'`
- **THEN** the agent is started with the argument `--prompt-interactive=` followed by the prompt containing `cost is $& and $'` unchanged
