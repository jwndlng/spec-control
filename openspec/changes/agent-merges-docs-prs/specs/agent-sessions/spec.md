## MODIFIED Requirements

### Requirement: Session starters run a fixed prompt for a validated change
The dashboard SHALL offer the starters **Draft artifacts** (while at least one artifact of the change is not done), **Implement** (change in `Ready` or `Implementing`), **Validate** (change in `Done` with the sub-state `validate`) and **Archive** (change in `Done`, in either sub-state), each only when the repository's agent has an opening prompt configured for it, and none for archived changes. **Implement** SHALL NOT be offered for a change in `Done`: nothing is left to implement there, and offering it is what sends an agent back into finished code. **Implement** SHALL NOT be offered for a change that is **blocked** by its dependencies (change-dependencies), whatever its stage: it is offered again on the first scan after the change stops being blocked. Being blocked SHALL NOT withhold **Draft artifacts**, **Validate** or **Archive**, and SHALL NOT end, interrupt or send anything to a session that is already running. A request to start a starter that is not available for the change's current stage, sub-state and dependencies SHALL be refused; a request for **Implement** refused because the change is blocked SHALL name, as its reason, each dependency that is not `met` together with its state, or say that the change's `depends-on.yaml` could not be read. The opening prompt SHALL be produced from the profile's template, in which `{change}` is the only placeholder, replaced by the change name after it passed change-name validation. The agent MUST be started without a shell from an argument list; the prompt MUST reach it either as exactly one argument (where the command contains `{prompt}`) or by being submitted to its terminal after start-up under the rules for text sent on the user's behalf (where it does not). No text from the browser other than the validated change name may become part of the command line.

Every preset's prompts SHALL carry the meaning of the `- [~]` task marker, which OpenSpec itself does not define: the **Implement** prompt SHALL instruct the agent to leave a task only a person can verify as `- [~]` rather than ticking it; the **Validate** prompt SHALL instruct the agent to take the change's `- [~]` tasks one at a time, say what to check, and tick off only those the user confirms, leaving the rest; and the **Archive** prompt SHALL instruct the agent to sync the change's delta specs into the main specs and then archive the change, without asking whether to sync, to archive right away when nothing is left to sync, and to tick off the tasks left for the user to validate once the user has confirmed them. Each preset's prompts SHALL invoke the OpenSpec workflow in the form that `openspec init --tools <tool>` installs for that agent — Claude Code's `/opsx:<workflow>` commands, Antigravity's `/opsx-<workflow>` workflows, and, for Codex, which gets skills and no commands, a plain-language instruction that names the OpenSpec skill and `{change}`. Each SHALL remain an ordinary prompt template the user can edit or remove, and each SHALL be a single line, so that it can be typed into a terminal.

A saved configuration in which a profile whose id is a preset's id still carries one of that preset's former prompts for a starter verbatim SHALL be read as carrying that preset's current prompt for that starter; any other prompt, a removed one, and every prompt of a profile whose id is no preset's SHALL be left as saved. This SHALL apply per preset and per starter, so upgrading one prompt never rewrites another and one preset's former prompts never upgrade another preset's profile.

When an **Archive** prompt is produced for a session of a git repository that has auto-merge of docs-only pull requests switched on, the dashboard SHALL decide whether the session's worktree holds **nothing outside OpenSpec documents**: that holds when the worktree's base is known and every path that differs between the base and the branch's last commit, and every path reported by the worktree's status — modified, staged, deleted, untracked, and both sides of a rename — lies under `openspec/` at the repository root. Unlike the check Ship makes, no path at all also holds: an Archive session normally starts in a fresh worktree on its own branch from the base, where nothing has changed yet. It SHALL be decided with read-only git, without contacting a remote, after the session's worktree exists and before the prompt is sent, and never from a cached status or from anything the agent printed. A git command that fails, an unknown base, or any path outside `openspec/` SHALL count as not holding. Only when it holds SHALL the dashboard append to the Archive prompt, after the profile's additional Archive instructions, a fixed agent-neutral instruction — the archive **auto-merge instruction** — that: states that this project lets a pull request changing only files under `openspec/` merge without review once its checks pass, and that the dashboard will ask the agent to merge such a pull request when it is ready; tells the agent not to open a pull request only because of this; and asks the agent, **if** it opens a pull request for this work, not to merge it and not to enable GitHub's auto-merge on it, and to say whether every file it changes is under `openspec/`. It MUST NOT ask the agent to enable auto-merge. In every other case — the setting off or absent, an in-place session, the check failing — the Archive prompt SHALL be exactly the prompt without this setting. No other starter's prompt SHALL ever carry this instruction. The result of starting a session SHALL state whether the instruction was included — never for a session that was already open and was returned instead of started — and when it was, the session's panel SHALL say that, because only OpenSpec documents changed, an archive pull request the agent opens will be handed back to it to merge once its checks pass. Opening a pull request is the agent's action under its own permission prompts; the dashboard MUST NOT itself open, merge or enable auto-merge on a pull request.

Syncing, archiving and ticking off a validated task are done by the agent in the session's working directory; the dashboard itself MUST NOT write specs, move a change or change a checkbox in `tasks.md`.

A starter that does not result in a session MUST NOT fail silently. When starting is refused or fails, the dashboard SHALL show the reason to the user in the place the starter was activated from, without requiring a session panel to be open — a session that could not be created has no panel to report itself in. The message SHALL be the reason the request was refused with. It SHALL be cleared once a later start from the same place succeeds.

#### Scenario: Implement on a ready change
- **WHEN** the user starts **Implement** on change `cache-api-calls` with the preconfigured profile
- **THEN** the agent is started with two arguments, `claude` and one prompt that begins with `/opsx:apply cache-api-calls` and tells it to leave a task only the user can verify as `- [~]` instead of ticking it

#### Scenario: Validate on a change awaiting validation
- **WHEN** change `cache-api-calls` is in `Done` with `tasks.awaiting` `2` and the repository's agent has a Validate prompt
- **THEN** the **Validate** starter is offered for it, and starting it opens a session whose prompt names the change and asks the agent to walk the user through its `- [~]` tasks

#### Scenario: Implement is not offered next to Validate
- **WHEN** a change is in `Done` with the sub-state `validate`
- **THEN** its starters are **Validate** and **Archive**, and **Implement** is not among them

#### Scenario: Validate is refused while tasks are open
- **WHEN** a Validate session is requested for a change in `Implementing`
- **THEN** the request is refused, no worktree is created and no process is started

#### Scenario: Archive on a change awaiting validation
- **WHEN** change `cache-api-calls` is in `Done` with `tasks.awaiting` `2` and the repository's agent has an Archive prompt
- **THEN** the **Archive** starter is offered for it, and starting it opens an archive session

#### Scenario: Preconfigured Archive prompt syncs without asking
- **WHEN** the user starts **Archive** on change `cache-api-calls` with the preconfigured profile
- **THEN** the agent is started with two arguments, `claude` and one prompt that begins with `/opsx:archive cache-api-calls`, tells it to sync the delta specs before archiving without asking, and tells it to tick off the tasks left for the user to validate once the user has confirmed them

#### Scenario: Agent without a Validate prompt
- **WHEN** a repository's agent has no Validate prompt and a change is in `Done` with the sub-state `validate`
- **THEN** no Validate starter is offered for it, and **Archive** still is

#### Scenario: Former preconfigured Archive prompt is upgraded
- **WHEN** a saved configuration's `claude` profile has the Archive prompt `/opsx:archive {change}`
- **THEN** the loaded configuration carries the current preconfigured Archive prompt for that profile

#### Scenario: Edited Archive prompt is kept
- **WHEN** a saved configuration's `claude` profile has the Archive prompt `/opsx:archive {change} and ask me before syncing`
- **THEN** the loaded configuration carries exactly that prompt

#### Scenario: Shell metacharacters are inert
- **WHEN** a profile's prompt template produces text containing quotes, `;` or `$(…)`
- **THEN** the agent receives that text as one argument and no shell interprets it

#### Scenario: Invalid change name
- **WHEN** a session is requested for a change name containing characters outside the allowed set
- **THEN** the request is refused, no worktree is created and no process is started

#### Scenario: A refused start is reported on the card
- **WHEN** the user activates a starter and the request is refused, so that no session is created
- **THEN** the card that starter belongs to shows the reason, and no session panel is required for it to be visible

#### Scenario: Former preconfigured prompts upgrade per starter
- **WHEN** a saved configuration's `claude` profile has a former preconfigured Archive prompt verbatim and an edited Implement prompt
- **THEN** the loaded configuration carries the current preconfigured Archive prompt and exactly the edited Implement prompt

#### Scenario: Antigravity preset uses its installed workflows
- **WHEN** the user starts **Archive** on change `cache-api-calls` with the Antigravity preset
- **THEN** the prompt begins with `/opsx-archive cache-api-calls`, tells the agent to sync the delta specs before archiving without asking, and tells it to tick off the tasks left for the user to validate once the user has confirmed them

#### Scenario: Codex preset names the skill in plain language
- **WHEN** the user starts **Implement** on change `cache-api-calls` with the Codex preset
- **THEN** the prompt contains no slash command, names the OpenSpec apply skill and `cache-api-calls`, and tells the agent to leave a task only the user can verify as `- [~]` instead of ticking it

#### Scenario: Former prompts do not cross presets
- **WHEN** a saved configuration's `agy` profile carries, verbatim, a former prompt of the Claude Code preset that was never one of the Antigravity preset's
- **THEN** the loaded configuration carries exactly that prompt for the `agy` profile

#### Scenario: Agent without a prompt for a starter
- **WHEN** a repository's agent has no Archive prompt and a change is in `Done`
- **THEN** no Archive starter is offered for it

#### Scenario: Command without a prompt placeholder
- **WHEN** an agent's command does not contain `{prompt}` and the agent shows its text prompt after start-up
- **THEN** the agent is started as given and the opening prompt is typed into its terminal and submitted with a separate Enter once the agent shows it

#### Scenario: Agent starts with a dialog instead of a prompt
- **WHEN** an agent whose opening prompt is typed shows a first-run dialog with a highlighted option after start-up
- **THEN** no Enter is pressed and the dialog is left for the user to answer in the terminal

#### Scenario: Archive on a synced change
- **WHEN** change `cache-api-calls` is in `Done` with its delta specs already synced and the repository's agent has an Archive prompt
- **THEN** the Archive starter is offered for it, and starting it opens an archive session

#### Scenario: Archive is refused before every task is done
- **WHEN** an Archive session is requested for a change in `Implementing`
- **THEN** the request is refused, no worktree is created and no process is started

#### Scenario: The reason goes away on the next successful start
- **WHEN** a starter was refused, its reason is shown, and a later start from the same card succeeds
- **THEN** the reason is no longer shown

#### Scenario: Implement is withheld while a dependency waits
- **WHEN** change `add-billing-ui` is in `Ready` and depends on `add-billing-api`, which is `waiting`
- **THEN** **Implement** is not among its starters, and **Draft artifacts** is offered only if one of its artifacts is not done

#### Scenario: A blocked Implement is refused with the dependencies as reason
- **WHEN** an Implement session is requested for `add-billing-ui` while it depends on `add-billing-api` (`waiting`) and `add-billing-scheme` (`missing`)
- **THEN** the request is refused naming `add-billing-api` as waiting and `add-billing-scheme` as missing, no worktree is created and no process is started

#### Scenario: Drafting a blocked change
- **WHEN** change `add-billing-ui` is in `Drafts` and depends on a change that is `waiting`
- **THEN** **Draft artifacts** is offered and starting it opens a session as for any other change

#### Scenario: Implement returns once the dependency is met
- **WHEN** `add-billing-ui` is in `Ready` and its only dependency becomes `met` on the next scan
- **THEN** its **Implement** starter is offered again

#### Scenario: A running session is left alone
- **WHEN** an Implement session of `add-billing-ui` is running and a `depends-on.yaml` naming a `waiting` change is added to it
- **THEN** the session keeps running and nothing is sent to it, and no new **Implement** is offered for the change

#### Scenario: Archive in a fresh worktree with auto-merge on
- **WHEN** a repository has auto-merge of docs-only pull requests on and the user starts **Archive** on change `rotate-keys`, whose worktree is created fresh from the base
- **THEN** the opening prompt is the profile's Archive prompt with its additional Archive instructions, followed by the archive auto-merge instruction, and the start result states that it was included

#### Scenario: The archive instruction presumes no pull request
- **WHEN** the archive auto-merge instruction is included
- **THEN** it tells the agent not to open a pull request only because of it, and asks for auto-merge only on a pull request the agent opens for this work

#### Scenario: Archive with auto-merge off
- **WHEN** a repository without auto-merge of docs-only pull requests starts **Archive** on `rotate-keys`
- **THEN** the opening prompt is the profile's Archive prompt with its additional instructions and nothing else, and the start result states that no auto-merge instruction was included

#### Scenario: Archive branch already carrying code
- **WHEN** a repository has auto-merge on and **Archive** is started for `rotate-keys` whose archive branch already exists with a commit changing `src/keys.ts`
- **THEN** the opening prompt carries no auto-merge instruction

#### Scenario: Archive without git
- **WHEN** a folder without git has auto-merge recorded in its configuration and **Archive** is started in place
- **THEN** no git command runs for the check and the opening prompt carries no auto-merge instruction

#### Scenario: Other starters never carry it
- **WHEN** a repository has auto-merge on and **Draft artifacts**, **Implement** or **Validate** is started in a worktree that holds only OpenSpec documents
- **THEN** the opening prompt carries no auto-merge instruction

#### Scenario: A session that was already open
- **WHEN** a repository has auto-merge on and **Archive** is requested for a change whose session is already open, so that session is returned
- **THEN** nothing is typed into it and the result states that no auto-merge instruction was included

### Requirement: Ship asks the agent to commit, push and open a pull request
For a session whose worktree has status `uncommitted`, `unpushed` or `pushed` the dashboard SHALL offer a Ship action. It uses the agent profile's Ship prompt, or an agent-neutral default asking to commit with a message that follows the repository's own conventions, push the branch, open a pull request against the default branch if none exists, not to merge it, and to report its URL. When the session is running the prompt SHALL be submitted to its terminal under the rules for text sent on the user's behalf, so that one activation sends it; otherwise the agent SHALL be started in the session's worktree — with its resume command and the prompt submitted after start-up when it has one, else with its command and the prompt as opening prompt — in the same session record, under the same checks as resuming. The result of Ship SHALL state whether the prompt was submitted, and when it was only typed the panel SHALL say so. The dashboard itself MUST NOT commit, push, merge, enable auto-merge or contact a remote.

When the session's repository has auto-merge of docs-only pull requests switched on, the dashboard SHALL decide before composing the prompt whether the session ships **only OpenSpec documents**: that holds when the worktree's base is known and every path that differs between the base and the branch's last commit, and every path reported by the worktree's status — modified, staged, deleted, untracked, and both sides of a rename — lies under `openspec/` at the repository root, and at least one such path exists. It SHALL be decided with read-only git, without contacting a remote, at the moment of the Ship request and never from a cached status or from anything the agent printed. A git command that fails, an unknown base, or any path outside `openspec/` SHALL count as not only OpenSpec documents. Only when the session ships only OpenSpec documents SHALL the dashboard append to the Ship prompt, after the profile's additional Ship instructions, a fixed agent-neutral instruction — Ship's **auto-merge instruction** — that: states that this project lets a pull request changing only files under `openspec/` merge without review once its checks pass, and that the dashboard will ask the agent to merge it when it is ready; asks the agent to open the pull request as the prompt says, not to merge it and not to enable GitHub's auto-merge on it; and asks the agent to say whether every file the pull request changes is under `openspec/`. It MUST NOT ask the agent to enable auto-merge or to merge. In every other case — the setting off or absent, the check failing — the Ship prompt SHALL be exactly the prompt without this setting. The result of Ship SHALL state whether the instruction was included, and when it was, the panel SHALL say that, because only OpenSpec documents changed, the pull request will be handed back to the agent to merge once its checks pass. Whether and when that happens is decided under "A ready docs-only pull request is handed to its agent to merge", never from anything the agent printed. An in-place session has no worktree and no branch: it has no work status, Ship MUST NOT be offered for it, and a Ship request for it SHALL be refused.

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
- **WHEN** Ship is used on the archive session of `rotate-keys` in a repository with auto-merge of docs-only pull requests on, and the branch only moves `openspec/changes/rotate-keys/` under `openspec/changes/archive/` and changes `openspec/specs/secrets/spec.md`
- **THEN** the Ship prompt ends with the auto-merge instruction, which asks the agent not to merge and not to enable auto-merge, the result states that it was included, and the panel says the pull request will be handed back to the agent to merge once its checks pass

#### Scenario: Code in the branch
- **WHEN** Ship is used in a repository with auto-merge on and the branch changes `openspec/changes/rotate-keys/tasks.md` and `src/keys.ts`
- **THEN** the Ship prompt carries no auto-merge instruction and the result states that it was not included

#### Scenario: An uncommitted file outside openspec
- **WHEN** Ship is used in a repository with auto-merge on, every committed change of the branch is under `openspec/`, and the worktree has an untracked `notes.txt` at its root
- **THEN** the Ship prompt carries no auto-merge instruction

#### Scenario: Auto-merge off
- **WHEN** Ship is used on a branch that changes only files under `openspec/` in a repository without auto-merge of docs-only pull requests
- **THEN** the Ship prompt is the profile's Ship prompt with its additional instructions and nothing else, and the result states that no auto-merge instruction was included

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

### Requirement: A merged auto-merge pull request ends its session
When the dashboard appends the Ship or Archive auto-merge instruction to a prompt for a change session — starting the session, sending the action into its running session, or Ship — it SHALL record on that session the time it did so (the latest such time when it happens more than once). The same record is what makes a session eligible for an automatic Merge prompt ("A ready docs-only pull request is handed to its agent to merge"); a Merge prompt SHALL NOT change it. A session without that record SHALL never be ended or have its worktree removed by this requirement.

Whenever a pull-request query for a repository completes — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL look in that query's result for each session of that repository that carries the record, is not in place and did not adopt its worktree, and whose worktree still exists or whose agent still runs. When the result holds a pull request in the merged state whose head branch is that session's branch and whose merge time is later than the recorded time, and the repository has auto-merge of docs-only pull requests switched on at that moment, the dashboard SHALL, without asking, end the session's agent as ending the session does, and then remove its worktree under exactly the rules of "Worktree clean-up is offered only when safe": by a non-forcing `git worktree remove`, only when it holds no uncommitted change and either its work status is `merged` or no commit exists only on its branch. When those checks refuse, the agent SHALL still be ended, the worktree SHALL be kept, and the session SHALL keep the reason. It SHALL decide this only from the pull-request query's result and read-only git; it MUST NOT start a pull-request query, a `gh` process or a timer for it, MUST NOT fetch, and MUST NOT delete the session's branch or any other ref — the branch is left for repository cleanup. A session that this ended SHALL keep, and its panel and card SHALL show, that it was ended because pull request `#<number>` merged, and whether its worktree was removed or why it was kept. A merged pull request found again in a later query SHALL change nothing more. In the demo nothing SHALL be ended or removed.

#### Scenario: Archive pull request merges while the board is watching
- **WHEN** a repository has docs auto-merge on, the archive session of `rotate-keys` was started with the archive auto-merge instruction, its agent pushed branch `archive-rotate-keys` and opened `#88`, the dashboard sent it a Merge prompt once `#88` was ready, and a later pull-request watch refresh shows `#88` merged
- **THEN** the session's agent is ended, its clean, pushed worktree is removed, branch `archive-rotate-keys` still exists locally, and the panel says the session ended because `#88` merged and its worktree was removed

#### Scenario: Nothing was asked
- **WHEN** a pull-request refresh shows the pull request of an Implement session's branch merged, and that session's prompts never carried the auto-merge instruction
- **THEN** the session keeps running and its worktree is kept

#### Scenario: Auto-merge switched off since
- **WHEN** the user switched docs auto-merge off for the repository after the Ship that carried the instruction, and a refresh then shows that pull request merged
- **THEN** the session keeps running and its worktree is kept

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

## ADDED Requirements

### Requirement: Merge asks the agent to merge its ready pull request
For a running change session that is not in place and whose branch is the head branch of an **open** pull request in the session's repository's last good pull-request list, the dashboard SHALL offer a **Merge** action while that pull request is ready (`pull-requests`: "A linked open pull request has a readiness") and carries a head commit, whether or not the project has docs auto-merge on. Merge is a prompt, not a starter: it uses the agent profile's Merge prompt, or an agent-neutral default asking the agent to merge the pull request of this worktree's branch into its base with the merge method this repository uses, only if its head is still the commit named — with the GitHub CLI, `gh pr merge <number> --match-head-commit <commit>` — not to delete the branch, and, if the merge is refused or anything was pushed since, to stop and say why. `{change}` SHALL be the profile prompt's only placeholder. After the profile's prompt and its additional Merge instructions the dashboard SHALL append, separated by one space, a fixed sentence naming the pull request as `#<number>` and its head commit as the full 40-character object name, both taken from the pull-request list after validation (a positive integer; exactly 40 hexadecimal characters) and never from the browser. The composed prompt SHALL be one line and SHALL be submitted to the session's terminal under the rules for text sent on the user's behalf; the result SHALL state whether it was submitted, and when it was only typed the panel SHALL say so.

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

### Requirement: A ready docs-only pull request is handed to its agent to merge
Whenever a pull-request query for a repository completes with a good list — whatever started it: the user's Refresh, opening a view that shows pull requests, or the board's pull-request watch — the dashboard SHALL, for each change session of that repository that carries the auto-merge record of "A merged auto-merge pull request ends its session", is running, is not in place and did not adopt its worktree, look in that query's result for an open pull request whose head branch is the session's branch, and SHALL send that session a Merge prompt, exactly as the Merge action composes and submits it, only when **all** of these hold at that moment:

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
