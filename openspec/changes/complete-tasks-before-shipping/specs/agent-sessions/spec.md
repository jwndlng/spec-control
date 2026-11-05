## ADDED Requirements

### Requirement: Implementation prompts request complete verified tasks
The preset Implement and Fast-forward prompts SHALL ask the agent to complete and verify every task it can, tick only verified tasks, and report unresolved work with the precise blocker. They SHALL reserve `- [~]` for work that truly requires the user and ask the agent to do all automatable parts first.

#### Scenario: An automated check is left open
- **WHEN** an implementation agent can run a task's check itself
- **THEN** its prompt asks it to run and verify the check and tick the task only after it passes, rather than leave it open or mark it as needing a person

#### Scenario: A human-only task remains
- **WHEN** a task requires a person's action or confirmation
- **THEN** the prompt asks the agent to complete the parts it can, mark the task `- [~]`, and state exactly what the person must do

### Requirement: Ship preflight exposes unfinished tasks
Before Ship is sent, the dashboard SHALL read task state from the session's own checkout and show unresolved tasks. When any remain, it SHALL offer to ask the agent to finish them and SHALL require explicit confirmation to ship with unresolved tasks. It MUST NOT change task files itself.

#### Scenario: Open tasks before shipping
- **WHEN** Ship is activated and the session checkout has an open task
- **THEN** the preflight names it, offers to ask the agent to complete it, and does not send Ship without an explicit choice to ship anyway

#### Scenario: Person needed before shipping
- **WHEN** Ship is activated and a task is marked `- [~]`
- **THEN** the preflight shows that task and asks the user to review it; the dashboard does not mark it complete

#### Scenario: A check requires a pull request
- **WHEN** a task can only be verified after a PR is opened
- **THEN** the user can explicitly ship despite that unfinished task, and the agent is asked to report the pending check and revisit it after evidence is available

#### Scenario: All tasks are complete
- **WHEN** the session checkout has readable tasks and every task is checked
- **THEN** Ship proceeds without an unfinished-task confirmation

#### Scenario: Task state is unavailable
- **WHEN** tasks cannot be read or their state is unknown
- **THEN** the preflight says it cannot verify completion and requires explicit confirmation before Ship

### Requirement: Finish tasks after a merged implementation
For a change with unresolved tasks and a linked merged implementation PR, the dashboard SHALL offer **Finish checks** to ask an agent to verify and finish remaining tasks. It SHALL use the relevant session or a safe session worktree, and SHALL ask the agent to prepare a reviewable task update after verification.

#### Scenario: CI passed on a merged PR
- **WHEN** an implementation PR merged and a task still says to verify its checks
- **THEN** Finish checks asks the agent to inspect the actual check result and tick the task only if the evidence satisfies it, then prepare the update for review

#### Scenario: Evidence is missing or a person is needed
- **WHEN** the agent cannot verify a task or a task needs a person
- **THEN** its instruction says to leave the appropriate task unresolved and report what remains; merge status alone is not evidence of completion

#### Scenario: No session record remains
- **WHEN** a merged implementation has unresolved tasks but no usable session or worktree
- **THEN** Finish checks offers a safe new session based on the change's current checkout, or explains why one cannot be started

## MODIFIED Requirements

### Requirement: Ship asks the agent to commit, push and open a pull request
Ship SHALL first apply "Ship preflight exposes unfinished tasks"; the prompt below SHALL be sent only when tasks are settled or the user confirms the current unresolved-task preview. The fixed completion instruction SHALL follow the profile's Ship text (or default), before the title, record and additional instructions, including for customized prompts.

For a session whose worktree has status `uncommitted`, `unpushed` or `pushed` the dashboard SHALL offer a Ship action. It uses the agent profile's Ship prompt, or an agent-neutral default asking to commit with a message that follows the repository's own conventions, push the branch, open a pull request against the default branch if none exists, not to merge it, and to report its URL. When the session is running the prompt SHALL be submitted to its terminal under the rules for text sent on the user's behalf, so that one activation sends it; otherwise the agent SHALL be started in the session's worktree — with its resume command and the prompt submitted after start-up when it has one, else with its command and the prompt as opening prompt — in the same session record, under the same checks as resuming. The result of Ship SHALL state whether the prompt was submitted, and when it was only typed the panel SHALL say so. The dashboard itself MUST NOT commit, push, merge, enable auto-merge or contact a remote.

When the session's repository has auto-merge of docs-only pull requests switched on, the dashboard SHALL decide before composing the prompt whether the session ships **only OpenSpec documents**: that holds when the worktree's base is known and every path that differs between the base and the branch's last commit, and every path reported by the worktree's status — modified, staged, deleted, untracked, and both sides of a rename — lies under `openspec/` at the repository root, and at least one such path exists. It SHALL be decided with read-only git, without contacting a remote, at the moment of the Ship request and never from a cached status or from anything the agent printed. A git command that fails, an unknown base, or any path outside `openspec/` SHALL count as not only OpenSpec documents. Only when task completion is verified and the session ships only OpenSpec documents SHALL the dashboard append to the Ship prompt, after the profile's additional Ship instructions, a fixed agent-neutral instruction — Ship's **auto-merge instruction** — that: states that this project lets a pull request changing only files under `openspec/` merge without review once its checks pass, and that the dashboard will ask the agent to merge it when it is ready; asks the agent to open the pull request as the prompt says, not to merge it and not to enable GitHub's auto-merge on it; and asks the agent to say whether every file the pull request changes is under `openspec/`. It MUST NOT ask the agent to enable auto-merge or to merge. In every other case — the setting off or absent, the check failing — the Ship prompt SHALL be exactly the prompt without this setting. The result of Ship SHALL state whether the instruction was included, and when it was, the panel SHALL say that, because only OpenSpec documents changed, the pull request will be handed back to the agent to merge once its checks pass. Whether and when that happens is decided under "A ready docs-only pull request is handed to its agent to merge", never from anything the agent printed. An in-place session has no worktree and no branch: it has no work status, Ship MUST NOT be offered for it, and a Ship request for it SHALL be refused.

#### Scenario: Ship in a running session
- **WHEN** Ship is used on a running session whose agent waits at its text prompt
- **THEN** the Ship prompt is typed, shown by the agent, submitted with a separate Enter, the agent starts working on it, and no process is started

#### Scenario: Ship while the agent shows a menu
- **WHEN** Ship is used on a running session whose agent shows a selection menu
- **THEN** no Enter is pressed, nothing is confirmed, and the panel says that the Ship prompt was typed but not sent

#### Scenario: Ship after the session ended
- **WHEN** Ship is used on an ended session of an agent with a resume command
- **THEN** the agent is started with the resume command in the session's worktree, the prompt is submitted to it after start-up, and the session is `running` again

#### Scenario: Nothing to ship
- **WHEN** Ship is requested for a session whose worktree is `merged`, `clean` or `missing`
- **THEN** the request is refused and nothing is started

#### Scenario: Ship is not offered without git
- **WHEN** the panel of an in-place session is open
- **THEN** no Ship control is shown, no work status is shown for it, and a Ship request for that session is refused

#### Scenario: Shipping an archive branch with auto-merge on
- **WHEN** Ship is used on the archive session of `rotate-keys` in a repository with auto-merge of docs-only pull requests on, task completion is verified, and the branch only moves `openspec/changes/rotate-keys/` under `openspec/changes/archive/` and changes `openspec/specs/secrets/spec.md`
- **THEN** the Ship prompt ends with the auto-merge instruction, which asks the agent not to merge and not to enable auto-merge, the result states that it was included, and the panel says the pull request will be handed back to the agent to merge once its checks pass

#### Scenario: Code in the branch
- **WHEN** Ship is used in a repository with auto-merge on and the branch changes `openspec/changes/rotate-keys/tasks.md` and `src/keys.ts`
- **THEN** the Ship prompt carries no auto-merge instruction and the result states that it was not included

#### Scenario: An uncommitted file outside openspec
- **WHEN** Ship is used in a repository with auto-merge on, every committed change of the branch is under `openspec/`, and the worktree has an untracked `notes.txt` at its root
- **THEN** the Ship prompt carries no auto-merge instruction

#### Scenario: Auto-merge off
- **WHEN** Ship is used on a branch that changes only files under `openspec/` in a repository without auto-merge of docs-only pull requests
- **THEN** the Ship prompt is the profile's Ship prompt with the fixed completion instruction, branch-recording instruction when available and its additional instructions, and the result states that no auto-merge instruction was included

#### Scenario: Base unknown
- **WHEN** Ship is used in a repository with auto-merge on and the worktree's base cannot be determined
- **THEN** the Ship prompt carries no auto-merge instruction

#### Scenario: A look-alike path
- **WHEN** Ship is used in a repository with auto-merge on and the branch changes `docs/openspec/notes.md` and `openspec-notes.md`
- **THEN** the Ship prompt carries no auto-merge instruction

#### Scenario: The dashboard still merges nothing
- **WHEN** Ship with the auto-merge instruction is used
- **THEN** the dashboard ran no `gh` process, no git command that writes, and contacted no remote for it

#### Scenario: Auto-merge is never asked for
- **WHEN** Ship or Archive carries the auto-merge instruction
- **THEN** neither the instruction nor anything else the dashboard sends for it asks the agent to enable GitHub's auto-merge

#### Scenario: The default prompt prescribes no convention
- **WHEN** Ship is used for a repository without a pull request title convention and the profile has no Ship prompt of its own
- **THEN** the submitted prompt asks for commit messages that follow the repository's own conventions and does not mention Conventional Commits

### Requirement: A repository can require Conventional Commits pull request titles
Each repository entry in the configuration MAY carry `prTitleConvention`, whose only valid value is `conventional-commits`; absent means the repository has no pull request title convention. A configuration without the field SHALL load unchanged with no convention for any repository, and a configuration carrying any other value SHALL be rejected when saved, leaving the stored configuration unchanged. The setting SHALL be stored only in the dashboard's own configuration and MUST NOT be written to, or read from, any tracked repository.

Whenever the dashboard produces the Ship prompt for a session of a repository whose convention is `conventional-commits`, it SHALL append, separated by one space, a fixed sentence asking the agent to title the pull request as a Conventional Commit — `<type>(<optional scope>): <summary>`, with an example — and to write the commit messages in the same form. The sentence SHALL be appended to the profile's own Ship prompt or, when the profile has none, to the default, after the fixed completion instruction, and the profile's additional Ship instructions SHALL follow it; the auto-merge instruction for docs-only pull requests, when included, SHALL still come after both. The composed prompt SHALL remain one line and `{change}` SHALL be substituted in it as before. This SHALL apply wherever the Ship prompt is used — typed into a running session or handed to an ended session's agent on start-up. For a repository without a convention the Ship prompt SHALL be exactly what it would be without this requirement. No other prompt — the session starters, Resolve conflicts, Integrate — SHALL carry the sentence. The dashboard MUST NOT title, rename or edit a pull request itself, and the setting MUST NOT change whether Ship is offered.

#### Scenario: Ship for a repository with the convention
- **WHEN** `demo-ops` has `prTitleConvention: conventional-commits`, its agent has no Ship prompt and no additional Ship instructions, and Ship is used on a session whose work is `unpushed`
- **THEN** the submitted prompt is the default Ship prompt followed by the fixed completion instruction and the Conventional Commits sentence, on one line

#### Scenario: The convention and additional instructions
- **WHEN** the repository has the convention and the profile has its own Ship prompt and additional Ship instructions `Add the checklist from CONTRIBUTING.md.`
- **THEN** the submitted prompt is the profile's Ship prompt, then the fixed completion instruction, then the Conventional Commits sentence, then `Add the checklist from CONTRIBUTING.md.`, each separated by one space

#### Scenario: The convention and auto-merge of docs-only pull requests
- **WHEN** the repository has the convention and auto-merge of docs-only pull requests on, and Ship is used on a session that ships only OpenSpec documents
- **THEN** the submitted prompt is the Ship prompt, then the fixed completion instruction, then the Conventional Commits sentence, then the profile's additional Ship instructions if any, then the auto-merge instruction

#### Scenario: Ship after the session ended
- **WHEN** the repository has the convention and Ship is used on an ended session of an agent with a resume command
- **THEN** the prompt submitted to the resumed agent carries the Conventional Commits sentence

#### Scenario: Repository without the convention
- **WHEN** a repository has no `prTitleConvention` and Ship is used
- **THEN** the submitted prompt contains no Conventional Commits sentence

#### Scenario: Other prompts are unaffected
- **WHEN** the repository has the convention and Implement or Resolve conflicts is started for one of its changes
- **THEN** that prompt is sent exactly as it would be without the convention

#### Scenario: Unknown convention is refused
- **WHEN** a configuration is saved in which a repository carries `prTitleConvention: angular`
- **THEN** it is rejected naming the field and the stored configuration is unchanged

#### Scenario: Older configuration loads
- **WHEN** a configuration whose repository entries carry no `prTitleConvention` is loaded
- **THEN** it loads unchanged and no repository has a convention

### Requirement: An agent asked to open a pull request is asked to record its branch
Whenever the dashboard composes text that asks or allows an agent to open a pull request for a change — the Ship
prompt, Fast-forward's prompt through the Ship text it ends with, and the archive auto-merge instruction — it SHALL
include the record instruction the repository's framework module supplies for that change (spec-frameworks: "OpenSpec
changes record their pull request's branch in `.openspec.yaml`"). For a session whose action is archive it SHALL be the
archive branch's instruction; for every other session the implementation branch's. Which one SHALL be decided by the server from the
session record, never from the request or from anything the agent printed.

The instruction SHALL be appended and SHALL NOT replace any part of the prompt: in Ship it SHALL follow the profile's
Ship prompt (or the agent-neutral default), the fixed completion instruction, and the Conventional Commits sentence when the project has one, and precede
the profile's additional Ship instructions and the auto-merge instruction; in Fast-forward it SHALL appear once, as part
of the Ship text; with the archive auto-merge instruction it SHALL follow that instruction. A profile with its own Ship
prompt SHALL get it all the same. When the module supplies no record instruction, the text SHALL be exactly what it is
without this requirement.

The dashboard MUST NOT write the record itself, and MUST NOT check, read back or act on anything the agent printed about
it: what the agent recorded is read from the repository by the scan like any other file.

#### Scenario: Ship carries the implementation record instruction
- **WHEN** Ship is used on the implement session of `rotate-keys` in an OpenSpec repository with no title convention and no additional Ship instructions
- **THEN** the submitted text is the Ship prompt followed by the fixed completion instruction and the implementation record instruction for `rotate-keys`

#### Scenario: Order with every addition
- **WHEN** Ship is used in a project with Conventional Commits titles, additional Ship instructions and auto-merge included
- **THEN** the text is the Ship prompt, the fixed completion instruction, the Conventional Commits sentence, the record instruction, the additional instructions and the auto-merge instruction, in that order

#### Scenario: A custom Ship prompt
- **WHEN** the profile has its own Ship prompt
- **THEN** the record instruction is still appended to it

#### Scenario: Archive session
- **WHEN** Ship is used on the archive session of `rotate-keys`
- **THEN** the record instruction is the archive branch's, naming `archive-branch`

#### Scenario: Fast-forward
- **WHEN** Fast-forward is started for `rotate-keys`
- **THEN** its prompt contains the implementation record instruction exactly once, within its Ship part

#### Scenario: Archive with docs auto-merge
- **WHEN** an Archive prompt is started with the archive auto-merge instruction
- **THEN** the archive record instruction follows that instruction

#### Scenario: Nothing written by the dashboard
- **WHEN** Ship with the record instruction is used
- **THEN** the dashboard wrote no file in the repository or worktree and ran no git command that writes


### Requirement: Fast-forward drafts, implements and ships in one session
The dashboard SHALL offer a fifth starter, **Fast-forward**, for a change that should go from its artifacts to a pull
request without the user reviewing anything in between. It SHALL be offered exactly when all of these hold: **Draft
artifacts** is offered for the change (at least one artifact is not done, the change is not archived); the change is
not planned yet — in `Backlog` or `Drafts` (or without artifacts), not in `Ready` or later, where an optional artifact
may still be missing but **Implement** and **Ship** already apply; the change is not **blocked** by its dependencies (change-dependencies), because fast-forwarding implements it; and the repository's
agent has both a **Draft artifacts** and an **Implement** prompt. A request to start or send **Fast-forward** when any of
these does not hold SHALL be refused like any unavailable starter — a refusal because the change is blocked naming each
dependency that is not `met` with its state, as for **Implement** — and SHALL create no worktree and start no process.

A Fast-forward session SHALL run where a **Draft artifacts** session of the same change would run — in a git repository
in the change's worktree on branch `feat/<change>`, in place where a Draft session would be in place — and SHALL count
as that change's one open session. Its action SHALL be recorded as `fastForward` and shown as **Fast-forward** wherever a
session's action is named (the session panel, Open work and the activity log).

Its opening prompt SHALL be composed, as one line, of, in this order: the agent's **Draft artifacts** prompt with that
prompt's additional instructions; a fixed agent-neutral sentence telling the agent not to stop for the user's review once
every artifact is written, because this change is fast-forwarded and the pull request will be its only review, and to go
straight on to implementing it; the agent's **Implement** prompt with its additional instructions; the fixed evidence-based task completion instruction, even for a custom Implement prompt; a fixed agent-neutral
sentence telling the agent, once every task is settled, to ship the work without asking; and the **Ship** prompt exactly
as Ship would produce it for the change's repository — the profile's Ship prompt or the agent-neutral default, the
project's pull request title convention and the additional Ship instructions. `{change}` SHALL be replaced in every part
by the validated change name and is the only placeholder; nothing else from the browser SHALL reach the prompt. The
profile SHALL NOT have a Fast-forward prompt of its own, so every profile that has a Draft and an Implement prompt can
fast-forward without being configured for it, and editing those prompts or Ship's changes the Fast-forward prompt with
them. The `- [~]` meaning carried by the Implement prompt therefore holds in a Fast-forward session too.

A Fast-forward prompt MUST NOT carry the docs-only auto-merge instruction of Ship or Archive, whatever the project's
auto-merge setting and whatever its worktree holds, and a Fast-forward session SHALL NOT record that auto-merge was
requested; the pull request it asks for is the change's only review and MUST stay open for it. The dashboard itself
SHALL NOT commit, push, open or merge anything for it: as for Ship, it only hands over the prompt.

While a session of the change runs, **Fast-forward** MAY be sent into it as a next step under the rules for sending a
starter's prompt into a running session, under the same availability conditions.

#### Scenario: Fast-forward on a drafted-nothing change
- **WHEN** change `cache-api-calls` is in `Backlog`, is not blocked, and the repository's agent is the preconfigured Claude Code profile
- **THEN** **Fast-forward** is offered next to **Draft artifacts**, and starting it creates the worktree on `feat/cache-api-calls` and starts `claude` with one prompt that begins with `/opsx:ff cache-api-calls`, then says not to stop for review, then contains `/opsx:apply cache-api-calls` with the `- [~]` instruction, then asks to ship, ending with the Ship prompt

#### Scenario: Project with a pull request title convention
- **WHEN** **Fast-forward** is started for a change of a repository whose `prTitleConvention` is `conventional-commits`
- **THEN** its prompt ends with the Ship prompt including the Conventional Commits sentence, followed by the profile's additional Ship instructions if any

#### Scenario: Never auto-merge
- **WHEN** **Fast-forward** is started for a change of a project with docs-only auto-merge switched on
- **THEN** its prompt contains neither auto-merge instruction and the session records no auto-merge request

#### Scenario: Not offered without an Implement prompt
- **WHEN** the repository's agent has a Draft artifacts prompt but no Implement prompt
- **THEN** **Draft artifacts** is offered and **Fast-forward** is not, and a request for it is refused

#### Scenario: Not offered for a blocked change
- **WHEN** change `cache-api-calls` in `Drafts` depends on `add-billing-api`, which is `waiting`
- **THEN** **Draft artifacts** is offered and **Fast-forward** is not, and a request for it is refused naming `add-billing-api — waiting`

#### Scenario: Not offered once planned
- **WHEN** the change is in `Ready` with its tasks written and its optional design not written
- **THEN** **Fast-forward** is not offered and a request for it is refused

#### Scenario: Shell metacharacters stay inert
- **WHEN** the Draft prompt of the profile contains `$(rm -rf ~)` and **Fast-forward** is started
- **THEN** that text reaches the agent only inside the one prompt argument and no shell is started

The combined Fast-forward prompt SHALL disclose in Help and its warning that it cannot enforce the interactive Ship task confirmation.

### Requirement: A ready docs-only pull request is handed to its agent to merge
Whenever a pull-request query for a repository completes with a good list — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL, for each change session of that repository that carries the auto-merge record of "A merged auto-merge pull request ends its session", is running, is not in place and did not adopt its worktree — and for each ended proposal session as "An ended proposal session's pull request is merged through the change's running session" extends this — look in that query's result for an open pull request whose head branch is the session's branch, and SHALL send that session a Merge prompt, exactly as the Merge action composes and submits it, only when **all** of these hold at that moment:

Except for a proposal session, automatic Merge SHALL additionally require a fresh bounded task summary in the session checkout proving every task is checked; unresolved, unknown and truncated tasks SHALL withhold automatic Merge even if a previous Ship carried the auto-merge instruction. Archive sessions use the archived tasks file when the active directory has moved.

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
