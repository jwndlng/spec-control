## MODIFIED Requirements

### Requirement: Session starters run a fixed prompt for a validated change
The dashboard SHALL offer the starters **Draft artifacts** (change in `Unknown`, `Backlog` or `Drafts`, or in `Ready` while an artifact the schema does not require for implementing is not done), **Implement** (change in `Ready` or `Implementing`), **Validate** (change in `Done` with the sub-state `validate`) and **Archive** (change in `Done`, in either sub-state), each only when the repository's agent has an opening prompt configured for it, and none for archived changes. **Implement** SHALL NOT be offered for a change in `Done`: nothing is left to implement there, and offering it is what sends an agent back into finished code. **Draft artifacts** SHALL NOT be offered for a change in `Implementing` or `Done`, whatever artifacts it lacks: an artifact the schema does not require is no reason to send an agent back to planning once implementation started, and a request for it SHALL be refused with the reason that the change is past drafting. Which of the available starters a card or the Console tab recommends is a matter of display (`kanban-board`: "A change's actions are one split button"); the available starters and every refusal SHALL be decided by stage, sub-state and dependencies alone, never by a linked pull request. **Implement** SHALL NOT be offered for a change that is **blocked** by its dependencies (change-dependencies), whatever its stage: it is offered again on the first scan after the change stops being blocked. Being blocked SHALL NOT withhold **Draft artifacts**, **Validate** or **Archive**, and SHALL NOT end, interrupt or send anything to a session that is already running. A request to start a starter that is not available for the change's current stage, sub-state and dependencies SHALL be refused; a request for **Implement** refused because the change is blocked SHALL name, as its reason, each dependency that is not `met` together with its state, or say that the change's `depends-on.yaml` could not be read. The opening prompt SHALL be produced from the profile's template, in which `{change}` is the only placeholder, replaced by the change name after it passed change-name validation. The agent MUST be started without a shell from an argument list; the prompt MUST reach it either as exactly one argument (where the command contains `{prompt}`) or by being submitted to its terminal after start-up under the rules for text sent on the user's behalf (where it does not). No text from the browser other than the validated change name may become part of the command line.

Every preset's prompts SHALL carry the meaning of the `- [~]` task marker, which OpenSpec itself does not define: `- [~]` means that a task **needs the user**: the agent did every part of it it can, and what is left is for a person — either to verify the result or to carry out a step only they can (enter a secret, sign in to an account, try it on a real device). The **Implement** prompt SHALL instruct the agent, for a task only the user can verify or carry out, to do every part of it it can, then leave it as `- [~]` rather than ticking it or leaving it open, and add to that task's own line, after its text, what exactly the user has to check or do; the **Validate** prompt SHALL instruct the agent to take the change's `- [~]` tasks one at a time, tell the user exactly what to check or do, help with what it can, and tick off only those the user confirms as done, leaving the rest as `- [~]`; and the **Archive** prompt SHALL instruct the agent to sync the change's delta specs into the main specs and then archive the change, without asking whether to sync, to archive right away when nothing is left to sync, to tick off the tasks left for the user to validate once the user has confirmed them, and to include in its commit every file the archive moved or removed, so that no part of the move is left uncommitted in the worktree. Each preset's prompts SHALL invoke the OpenSpec workflow in the form that `openspec init --tools <tool>` installs for that agent — Claude Code's `/opsx:<workflow>` commands, Antigravity's `/opsx-<workflow>` workflows, and, for Codex, which gets skills and no commands, a plain-language instruction that names the OpenSpec skill and `{change}`. Each SHALL remain an ordinary prompt template the user can edit or remove, and each SHALL be a single line, so that it can be typed into a terminal.

A saved configuration in which a profile whose id is a preset's id still carries one of that preset's former prompts for a starter verbatim SHALL be read as carrying that preset's current prompt for that starter; any other prompt, a removed one, and every prompt of a profile whose id is no preset's SHALL be left as saved. This SHALL apply per preset and per starter, so upgrading one prompt never rewrites another and one preset's former prompts never upgrade another preset's profile.

When an **Archive** prompt is produced for a session of a git repository that has auto-merge of docs-only pull requests switched on, the dashboard SHALL decide whether the session's worktree holds **nothing outside OpenSpec documents**: that holds when the worktree's base is known and every path that differs between the base and the branch's last commit, and every path reported by the worktree's status — modified, staged, deleted, untracked, and both sides of a rename — lies under `openspec/` at the repository root. Unlike the check Ship makes, no path at all also holds: an Archive session normally starts in a fresh worktree on its own branch from the base, where nothing has changed yet. It SHALL be decided with read-only git, without contacting a remote, after the session's worktree exists and before the prompt is sent, and never from a cached status or from anything the agent printed. A git command that fails, an unknown base, or any path outside `openspec/` SHALL count as not holding. Only when it holds SHALL the dashboard append to the Archive prompt, after the profile's additional Archive instructions, a fixed agent-neutral instruction — the archive **auto-merge instruction** — that: states that this project lets a pull request changing only files under `openspec/` merge without review once its checks pass, and that the dashboard will ask the agent to merge such a pull request when it is ready; tells the agent not to open a pull request only because of this; and asks the agent, **if** it opens a pull request for this work, not to merge it and not to enable GitHub's auto-merge on it, and to say whether every file it changes is under `openspec/`. It MUST NOT ask the agent to enable auto-merge. In every other case — the setting off or absent, an in-place session, the check failing — the Archive prompt SHALL be exactly the prompt without this setting. No other starter's prompt SHALL ever carry this instruction. The result of starting a session SHALL state whether the instruction was included — never for a session that was already open and was returned instead of started — and when it was, the session's panel SHALL say that, because only OpenSpec documents changed, an archive pull request the agent opens will be handed back to it to merge once its checks pass. Opening a pull request is the agent's action under its own permission prompts; the dashboard MUST NOT itself open, merge or enable auto-merge on a pull request.

Syncing, archiving and ticking off a validated task are done by the agent in the session's working directory; the dashboard itself MUST NOT write specs, move a change or change a checkbox in `tasks.md`.

A starter that does not result in a session MUST NOT fail silently. When starting is refused or fails, the dashboard SHALL show the reason to the user in the place the starter was activated from, without requiring a session panel to be open — a session that could not be created has no panel to report itself in. The message SHALL be the reason the request was refused with. It SHALL be cleared once a later start from the same place succeeds.

#### Scenario: Implement on a ready change
- **WHEN** the user starts **Implement** on change `cache-api-calls` with the preconfigured profile
- **THEN** the agent is started with two arguments, `claude` and one prompt that begins with `/opsx:apply cache-api-calls` and tells it to leave a task only the user can verify or carry out as `- [~]`, with what the user has to check or do added to the task's line

#### Scenario: A step only the user can carry out
- **WHEN** an Implement session for `cache-api-calls` reaches the task `Add the API token to the deployment secrets`, which the agent cannot do itself, and every other task is ticked
- **THEN** the preconfigured prompt has told the agent to leave it as `- [~]` with what the user has to do on its line, the change moves to `Done` with the sub-state `validate`, **Validate** and **Archive** are offered, and **Implement** is not

#### Scenario: Former preconfigured Implement and Validate prompts are upgraded
- **WHEN** a saved configuration's `claude` profile carries, verbatim, the Implement and Validate prompts that only spoke of tasks the user can verify
- **THEN** the loaded configuration carries the current preconfigured Implement and Validate prompts, which also cover tasks only the user can carry out

#### Scenario: Validate on a change awaiting validation
- **WHEN** change `cache-api-calls` is in `Done` with `tasks.awaiting` `2` and the repository's agent has a Validate prompt
- **THEN** the **Validate** starter is offered for it, and starting it opens a session whose prompt names the change and asks the agent to walk the user through its `- [~]` tasks, saying for each what to check or do

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
- **THEN** the prompt contains no slash command, names the OpenSpec apply skill and `cache-api-calls`, and tells the agent to leave a task only the user can verify or carry out as `- [~]`, with what the user has to check or do added to the task's line

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

#### Scenario: Done change without a design offers no Draft
- **WHEN** change `rotate-keys` is in `Done`, its `design.md` was never written and the schema does not require it for implementing
- **THEN** its available starters are **Archive** only, and a request to start **Draft artifacts** for it is refused with the reason that the change is past drafting

#### Scenario: Implementing change without a design
- **WHEN** change `rotate-keys` is in `Implementing` and its optional `design.md` is not written
- **THEN** its available starters are **Implement** only

#### Scenario: Ready change may still draft its design
- **WHEN** change `rotate-keys` is in `Ready` and its optional `design.md` is not written
- **THEN** its available starters are **Implement** and **Draft artifacts**, and a Draft session for it may be started

#### Scenario: Ready change with every artifact written
- **WHEN** change `rotate-keys` is in `Ready` and every artifact is written
- **THEN** its available starters are **Implement** only

#### Scenario: The Archive prompt asks for the whole move to be committed
- **WHEN** the Claude Code preset's Archive prompt is composed for `cache-api-calls`
- **THEN** it also tells the agent to include in its commit every file the archive moved or removed, and a saved
  configuration still carrying the previous preconfigured Archive prompt verbatim is read as carrying this one

