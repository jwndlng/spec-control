# agent-sessions Specification

## Purpose
Defines agent sessions: starting a user-configured agent CLI for a change from the dashboard, in a terminal shown in the dashboard and inside a git worktree of its own — when sessions are available, how agents are configured and started, what a session is and how long it lives, what the dashboard may claim about its state, where its records are kept, and when its worktree may be removed.

## Requirements

### Requirement: Agent sessions are off until enabled, then apply to every tracked repository
Agent sessions SHALL be available only when the global `agentSessions.enabled` setting is true. That switch SHALL be in the Agent sessions section of Settings. Once it is on, agent sessions apply to every tracked (enabled) repository by default. A repository MAY be excluded individually, and MAY be given an agent profile other than the default, with that repository's agent-session toggle and agent picker on the projects overview, which take effect at once. The Agent sessions section of Settings SHALL also hold the editor command of the `editor-launch` capability. It SHALL NOT list repositories; it SHALL say that agent sessions are switched on or off per project on the projects overview, and link there. An excluded or untracked repository MUST NOT show session starters and MUST be refused by the API. A fresh or migrated configuration MUST have the feature disabled. A repository entry without agent settings counts as included.

#### Scenario: Default configuration
- **WHEN** the dashboard starts with a configuration that predates this feature
- **THEN** agent sessions are disabled and no card shows a session starter

#### Scenario: One switch enables all tracked repositories
- **WHEN** the user turns agent sessions on and has not changed any per-repository setting
- **THEN** cards of every tracked repository offer the starters their stage and agent allow, and every project's toggle on the overview reads Enabled

#### Scenario: Repository switched off
- **WHEN** agent sessions are enabled and the user switches `alpha-infra` to Disabled on the projects overview
- **THEN** cards of `alpha-infra` show no session starter and opening a session for it is refused, while other repositories are unaffected

#### Scenario: Settings points to the overview
- **WHEN** the user opens the Agent sessions section of Settings
- **THEN** it has the global switch, the agent profiles, the shortcuts, the console folder and the editor command, lists no repository, and links to the projects overview for per-project settings

### Requirement: An agent is a configurable profile, not a built-in integration
The dashboard SHALL start agents from user-configurable profiles. A profile consists of an id, a display name, a command given as an argument list, an opening prompt per session starter, optional additional instructions per prompt, an optional resume command and an optional list of environment variables to remove. The dashboard MUST NOT depend on any vendor-specific protocol or output format of an agent: any program that runs interactively in a terminal SHALL be usable. One profile is the default; a repository MAY select a different one with its agent picker on the projects overview. Removing a profile in Settings SHALL return every repository that selected it, and the main console when it selected it, to the default agent. The dashboard SHALL ship **presets** — ready-made profiles — for Claude Code (`claude`), Codex (`codex`) and Antigravity (`agy`). A preset SHALL be an ordinary profile with nothing a user-written profile could not express, and once added it SHALL be edited, made the default or removed like any other profile. Only the Claude Code preset SHALL be configured by default; another preset SHALL become a profile only when the user adds it in Settings, never because its executable was found on this machine. No preset SHALL carry additional instructions for any of its prompts, and no preset's command, resume command or prompt SHALL contain a permission-bypass mode or flag. The dashboard MUST NOT read, store, log or transmit an agent's credentials and MUST NOT offer a login flow; an agent uses its own login and its own settings.

#### Scenario: A second agent
- **WHEN** the user adds a profile with command `my-agent-cli`, `{prompt}` and an Implement prompt, and selects it for repository `demo-ops` on the projects overview
- **THEN** Implement on a `demo-ops` card starts `my-agent-cli` and other repositories keep using the default agent

#### Scenario: Removing a selected profile
- **WHEN** `demo-ops` uses the profile `my-agent` and the user removes `my-agent` in Settings and saves
- **THEN** `demo-ops` uses the default agent and the configuration is saved without an "unknown agent" error

#### Scenario: Removing the console's profile
- **WHEN** the main console uses the profile `my-agent` and the user removes `my-agent` in Settings and saves
- **THEN** the configuration is saved without an "unknown agent" error and the next console starts the default agent

#### Scenario: Agent not installed
- **WHEN** the executable of a repository's agent cannot be found on this machine
- **THEN** that repository's starters are disabled with an explanation, and opening a session is refused with that reason

#### Scenario: API key variables are removed for the preconfigured agent
- **WHEN** the dashboard was started from a shell that exports `ANTHROPIC_API_KEY` and a Claude Code session is opened with the default profile
- **THEN** the agent's environment does not contain `ANTHROPIC_API_KEY`, so its own login is used

#### Scenario: An installed agent is not added on its own
- **WHEN** `agy` and `codex` are found on this machine and the configuration has never listed them
- **THEN** the loaded configuration still has the Claude Code profile as its only agent

#### Scenario: Antigravity preset takes its prompt as one argument
- **WHEN** the user has added the Antigravity preset and starts **Implement** on change `cache-api-calls` with it
- **THEN** the agent is started with two arguments, `agy` and one argument `--prompt-interactive=` followed by a prompt that names `cache-api-calls`, and resuming that session starts `agy --continue`

#### Scenario: Antigravity preset starts without a prompt
- **WHEN** the Antigravity preset is the agent of a main console or a project console
- **THEN** `agy` is started alone, with no option left over that expects a value

#### Scenario: Codex preset takes its prompt as one argument
- **WHEN** the user has added the Codex preset and starts **Implement** on change `cache-api-calls` with it
- **THEN** the agent is started with two arguments, `codex` and one prompt that names `cache-api-calls`

#### Scenario: Every preset is a valid profile
- **WHEN** a configuration listing every preset unchanged is validated
- **THEN** it is accepted, including the rule against permission-bypass modes and flags

#### Scenario: A saved profile from before additional instructions existed
- **WHEN** a configuration saved without any additional instructions is loaded
- **THEN** every prompt of every profile is composed exactly as it was, and the profile carries no additional instructions

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

### Requirement: Additional instructions extend an action's prompt without replacing it
A profile SHALL be able to carry **additional instructions** for each of its prompts — the session starters, Ship and Integrate — kept separately from the prompt itself. Whenever the dashboard produces the prompt of an action, it SHALL append that action's additional instructions to the prompt it would otherwise have sent, and SHALL send nothing else: the prompt template stays as configured, and additional instructions for one action MUST NOT reach another. This applies wherever that prompt is used — starting a session, sending a starter's prompt into a running session, Ship on a running or an ended session, and Integrate.

The composed text SHALL be one line: additional instructions SHALL be trimmed and any run of whitespace in them, including a line break, SHALL become a single space before they are appended, separated from the prompt by one space. Placeholders SHALL be substituted in the composed text under the rules of the prompt being extended, so additional instructions for a starter or for Ship MAY use `{change}` and MUST use no other placeholder, additional Integrate instructions MUST contain no placeholder at all, and no additional instructions may carry a permission-bypass mode or flag. Additional instructions that break these rules SHALL be refused when the configuration is saved, with a message naming the field, leaving the stored configuration unchanged.

Additional instructions SHALL be an addition, never a prompt of their own: an action whose prompt is not configured SHALL stay unavailable and its additional instructions SHALL NOT be sent anywhere. Ship, Resolve conflicts and Integrate SHALL be the exceptions in effect, because each has an agent-neutral default prompt: their additional instructions SHALL be appended to the profile's own prompt for that action, or to that action's default when the profile has none. Settings SHALL offer the additional instructions of each prompt beside that prompt, saying that the text is appended to it; empty additional instructions SHALL be stored as absent.

#### Scenario: Additional instructions reach a starter's prompt
- **WHEN** the repository's agent has the Implement prompt `/opsx:apply {change}` and additional Implement instructions `Run the linter before you finish.`, and Implement is started for change `cache-api-calls`
- **THEN** the agent receives one prompt reading `/opsx:apply cache-api-calls Run the linter before you finish.`

#### Scenario: Additional instructions extend the default Ship prompt
- **WHEN** a profile has no Ship prompt of its own but additional Ship instructions `Add the checklist from CONTRIBUTING.md to the pull request body.`, and Ship is used on a session whose work is `unpushed`
- **THEN** the text submitted to the agent is the agent-neutral default Ship prompt followed by one space and that sentence

#### Scenario: Additional instructions extend the default Integrate prompt
- **WHEN** the default agent's profile has no Integrate prompt of its own but additional Integrate instructions `Commit nothing.`, and **Integrate** is activated
- **THEN** the agent receives the agent-neutral default Integrate prompt followed by one space and `Commit nothing.`

#### Scenario: Additional instructions are one line
- **WHEN** additional Archive instructions are saved as two lines with trailing blanks
- **THEN** the composed Archive prompt is a single line in which those lines are joined by one space, so that a prompt typed into a terminal is not submitted early

#### Scenario: Additional instructions stay with their own action
- **WHEN** a profile carries additional instructions for Implement only
- **THEN** the Draft, Validate, Archive, Ship and Integrate prompts are sent exactly as they are configured

#### Scenario: Additional instructions do not make an action available
- **WHEN** a profile has no Archive prompt but additional Archive instructions, and a change is in `Done`
- **THEN** Archive is still not offered for that change, an Archive request is still refused with the reason that the agent has no Archive prompt, and the additional instructions are not sent

#### Scenario: Unknown placeholder is refused
- **WHEN** additional Implement instructions containing `{repo}` are saved
- **THEN** the response is `400` naming that field, and the stored configuration is unchanged

#### Scenario: Placeholder in additional Integrate instructions is refused
- **WHEN** additional Integrate instructions containing `{change}` are saved
- **THEN** the response is `400` naming that field, and the stored configuration is unchanged

#### Scenario: Permission bypass is refused
- **WHEN** additional Draft instructions asking the agent to run with `--dangerously-skip-permissions` are saved
- **THEN** the response is `400` naming that field, and the stored configuration is unchanged

#### Scenario: Prompt sent into a running session
- **WHEN** a session for `cache-api-calls` is running and the Implement prompt is sent into it, with additional Implement instructions configured
- **THEN** the composed prompt, including those instructions, is what is typed into the terminal under the rules for text sent on the user's behalf

### Requirement: A session is the agent's own terminal
A session SHALL run the agent attached to a pseudo-terminal, and the session panel SHALL show that terminal: what the agent prints is displayed as the agent rendered it, and what the user types is delivered to the agent unchanged. The dashboard MUST NOT parse, summarise or filter the agent's output, with one exception: after typing text on the user's behalf it MAY check whether that same text appeared in the terminal, solely to decide whether to press Enter. It MUST NOT derive anything else from the output, MUST NOT classify the agent's state from it, and MUST NOT store, log or forward what it observed for that check. Keystrokes typed by the user MUST NOT be observed in this way. The agent's own prompts — including its permission and trust questions — SHALL be answered by the user in the terminal. The terminal SHALL follow the size of the panel. Several viewers MAY be attached to one session at once; a viewer that attaches later SHALL first receive what the terminal has shown so far (bounded), then follow live. Closing the panel MUST NOT end the session.

#### Scenario: Typing reaches the agent
- **WHEN** the user types a follow-up instruction into the session's terminal and presses Enter
- **THEN** the agent receives exactly those keystrokes and its response appears in the terminal

#### Scenario: The agent asks for permission
- **WHEN** the agent asks whether it may run a command
- **THEN** its question appears in the terminal as it would in any terminal and the user's keystroke answers it

#### Scenario: Reattaching
- **WHEN** the user closes the session panel and opens it again, or opens the same session in a second tab
- **THEN** the terminal shows the earlier output and continues live; the agent was not interrupted

#### Scenario: Output is not interpreted
- **WHEN** the agent prints that it is waiting for input, or prints an error
- **THEN** the dashboard shows that output in the terminal and derives nothing from it

### Requirement: Text sent on the user's behalf is submitted only after the agent showed it
Whenever the dashboard sends text to an agent's terminal on the user's behalf and is meant to submit it — a default response, the Ship prompt, or an opening prompt that is typed after start-up — it SHALL first write the text without Enter, then wait until the terminal's output produced after that write shows the text, and only then press Enter, as a separate key press after a short pause. The text SHALL be written in consecutive pieces of a bounded size, each small enough to reach the agent as one whole read through any terminal's input queue (at most 1024 bytes on any supported platform), never splitting a character across two pieces, in order, with a short pause after each piece; the wait for the text to show SHALL begin once the last piece is written. A text longer than a terminal's input queue MUST NOT be written in one burst, so that the agent never receives it cut at a point the terminal chose. If the text does not appear within a bounded time, the dashboard MUST NOT press Enter or send any other key; the text SHALL be left as typed. Whether the text appeared SHALL be decided independently of how the agent draws it: escape sequences and whitespace, including line wrapping, MUST be disregarded, and for long text a leading portion SHALL be sufficient. Submissions to one session SHALL be processed one after another. When a text was typed but not submitted, the dashboard SHALL tell the user so, stating that nothing was confirmed; it MUST NOT fail silently. The mechanism MUST NOT depend on any particular agent.

#### Scenario: Text prompt
- **WHEN** the agent waits at a text prompt that shows typed characters, and the dashboard submits `Yes, go ahead`
- **THEN** the text is typed, the terminal shows it, Enter is pressed as a separate key press, and the agent receives the answer

#### Scenario: Selection menu
- **WHEN** the agent shows a selection menu with an option highlighted, and the dashboard submits any text
- **THEN** the typed text does not appear, no Enter is pressed, the highlighted option is not confirmed, the session keeps running, and the user is told that the text was typed but not sent

#### Scenario: Long prompt
- **WHEN** the dashboard submits a prompt of several hundred characters that the agent wraps over several lines of its input box
- **THEN** the prompt is recognised as shown, Enter is pressed separately, and the agent starts working on it instead of leaving it in the input box

#### Scenario: Prompt longer than the terminal's input queue
- **WHEN** the user presses **Archive** for a change whose agent is running, and the composed Archive prompt — with the docs auto-merge and record instructions — is longer than 1024 bytes
- **THEN** the agent receives the whole prompt in order, in pieces none of which is larger than the bound, its input box shows the prompt's text rather than a paste placeholder followed by a fragment, and the prompt is submitted with a separate Enter

#### Scenario: Multi-byte characters at a piece boundary
- **WHEN** the dashboard submits a text containing multi-byte characters such as `—` where a piece boundary would fall inside one
- **THEN** every character reaches the agent intact and the text the agent receives equals the text submitted

#### Scenario: Agent that redraws with escape sequences
- **WHEN** the agent renders the typed text interleaved with cursor movement and colour sequences
- **THEN** the text is still recognised as shown

#### Scenario: Two submissions at once
- **WHEN** two texts are submitted to the same session within the same moment
- **THEN** the second is typed only after the first has been submitted or given up, and their characters never interleave

#### Scenario: A line-based agent
- **WHEN** the agent is a line-based program whose terminal echoes input
- **THEN** the echoed text counts as shown and the line is submitted

### Requirement: Every session works in its own git worktree, created by the dashboard
In a git repository a session MUST NOT run in the repository's main checkout, except for the in-place cases below. Before starting the agent, the dashboard SHALL ensure a git worktree for the session under `~/.spec-control/worktrees/<repository id>/`, outside the repository's working tree, on branch `feat/<change>` in worktree `<change>` — or, for **Archive**, in a worktree and branch of its own (`archive-<change>`, `chore/archive-<change>`), and, for a **Draft artifacts** session started while the repository has docs auto-merge switched on, in a worktree and branch of its own (`docs-<change>`, `docs/<change>`). Whether a Draft session gets `docs/<change>` SHALL be decided once, when it starts, and kept as the session's branch for its whole life; without docs auto-merge a Draft session works on `feat/<change>` as before. An existing worktree for that name SHALL be reused; an existing branch SHALL be checked out; otherwise the branch SHALL be created from the repository's default branch as currently known locally (`origin/HEAD`, else `HEAD`) — except that when an **Implement** or **Validate** session has to create `feat/<change>`, it SHALL be created from the local branch `docs/<change>` when that branch exists and the default branch's tree as known locally does not hold `openspec/changes/<change>/`, so that the implementation builds on the proposal that is not merged yet. That choice SHALL be made with read-only git only. A session on `feat/<change>` MUST NOT be started on, or adopt a worktree of, `docs/<change>`. A git repository whose scan reports that it has **no commit to branch from** — `HEAD` names no commit and there is no `origin/HEAD`, as **New project** leaves it — has no default branch to create a session's branch from; its change sessions SHALL run in place, as the paragraph on repositories with no commit below specifies, and MUST NOT be refused for lacking a commit. Should the scan be out of date and the branch still have to be created from a `HEAD` that names no commit, starting the session SHALL be refused before any worktree or branch is created and before any agent is started, with a reason that says the repository has no commit yet, rather than git's own error; that check SHALL be read-only. As the one exception, when a Draft or Implement session's branch — `feat/<change>`, or `docs/<change>` for a Draft session that has it — is already checked out in another linked worktree of the repository, the session SHALL adopt that worktree — run the agent there instead of creating one — and SHALL record and show that the worktree was adopted. The dashboard MUST NOT contact a remote for this. If the change's directory is missing from the session's worktree, the dashboard SHALL copy it from the checkout the change's data comes from (the main checkout or a linked worktree), including when it exists there only uncommitted. The main checkout's branch, index and working tree MUST NOT be changed. The session record and panel SHALL show the worktree path and branch.

A tracked folder that holds an `openspec/` tree but is **not a git repository** is a supported repository, and its sessions SHALL run **in place**: the agent's working directory SHALL be the repository folder itself, no worktree SHALL be created, no branch SHALL be made, and no git command SHALL be run for the session. Whether a session runs in place SHALL be decided from the repository's own scan result, never by attempting a git command and reacting to its failure. An in-place session SHALL be recorded as such and MUST NOT carry a branch. The panel SHALL name the folder the agent runs in and SHALL state plainly that the agent edits the tracked folder directly, with no branch, no commit and no undo. Session starters MUST NOT be hidden or disabled because a repository is not a git repository.

An **integration session** — the session started by **Integrate** for a repository that is not tracked and has no `openspec/` tree — is the second in-place case and the first one in a git repository. It SHALL run in place under exactly the rules of the paragraph above: the repository folder is the working directory, no worktree, no branch, no git command for the session, recorded as in place, with the same panel wording. The reason it does not get a worktree is that its whole purpose is to leave `openspec/config.yaml` in the checkout the user works in; on a branch in a worktree the marker would never appear where discovery looks. Whether a session runs in place SHALL still be decided from what the dashboard already knows about the folder, never by attempting a git command and reacting to its failure.

A **project console** — the one session per tracked project for general project tasks, specified in the `project-console` capability — is the third in-place case and the second one in a git repository's main checkout. It SHALL run in place under the same rules: the tracked folder is the working directory, no worktree, no branch, no git command for the session, recorded as in place, with the same panel wording. It runs there because it belongs to no change and so to no branch, and because work on the project as the user sees it — including a project with no commit yet, where no worktree can be made — happens in that checkout. Apart from the case in the next paragraph, these two kinds are the only sessions that MAY run in a git repository's main checkout.

A **change session in a git repository with no commit yet** is the fourth in-place case and the only one in which a change session runs in a git repository's main checkout. When the repository's scan reports that it has no commit to branch from, a change session of any action SHALL run in place under the same rules as in a folder without git: the main checkout is the working directory, no worktree SHALL be created, no branch made and no git command run for the session, the session SHALL be recorded as in place and MUST NOT carry a branch. Whether it runs in place SHALL be decided from the scan result, never by attempting a git command and reacting to its failure. A session started in place SHALL stay in place for its whole life, including when it is resumed or started again after the repository got its first commit; a session started once the scan reports a commit SHALL get its own worktree and branch as usual. The panel SHALL name the folder and SHALL state that the agent works in the repository's checkout because there is no commit to branch from yet, with no branch of its own and no undo; it MUST NOT claim that the folder is not a git repository. Such a session has no work status, no Ship, no worktree to remove and no pull offer, exactly as an in-place session in a folder without git. At most one agent SHALL run in that checkout at a time: a change session SHALL be refused while another in-place session — a change session or the project console — runs there, with a reason naming the change or saying that the project console is running in that folder. In every git repository that has a commit to branch from, a change session never runs in the main checkout.

#### Scenario: Two sessions in one repository
- **WHEN** sessions are open for changes `audit-trail` and `upgrade-runtime` of the same repository
- **THEN** they run in two different worktrees on two different branches and the main checkout's branch and `git status` are unchanged

#### Scenario: Uncommitted change directory
- **WHEN** a session is opened for a change whose directory exists only uncommitted in the main checkout
- **THEN** the worktree contains a copy of that directory before the agent starts

#### Scenario: Change lives only in another worktree on another branch
- **WHEN** a session is opened for change `audit-trail`, which exists only in a worktree on branch `wip/compliance`
- **THEN** a session worktree on `feat/audit-trail` is created and contains a copy of the change directory from that worktree before the agent starts

#### Scenario: The change's branch is already checked out
- **WHEN** an Implement session is opened for change `audit-trail` and branch `feat/audit-trail` is checked out in a linked worktree that the user created
- **THEN** the agent runs in that worktree, no new worktree is created, and the panel shows the worktree as adopted

#### Scenario: Archiving does not reuse the implementation worktree
- **WHEN** a change was implemented in a session whose worktree still exists, and the user later starts **Archive** for it
- **THEN** the archive session runs in a separate worktree on a `chore/archive-<change>` branch

#### Scenario: Worktree cannot be created
- **WHEN** git refuses to create the worktree in a git repository
- **THEN** the request fails with git's reason and no agent is started

#### Scenario: Repository without a commit
- **WHEN** the user starts **Draft artifacts** for change `first-feature` in the tracked git repository `/w/acme/fresh-app`, which was initialised but has no commit, and has no `origin/HEAD`
- **THEN** the agent starts with `/w/acme/fresh-app` as its working directory, the session is recorded as in place without a branch, no worktree or branch is created, and the dashboard runs no git command for the session

#### Scenario: The panel of a session in a repository without a commit
- **WHEN** the panel of the in-place `first-feature` session in `/w/acme/fresh-app` is open
- **THEN** it names `/w/acme/fresh-app`, shows no branch, says the agent works in the checkout because there is no commit to branch from yet and that there is no undo, and does not say the folder is not a git repository

#### Scenario: A second agent in a repository without a commit
- **WHEN** the in-place `first-feature` session runs in `/w/acme/fresh-app` and the user starts Implement for change `second-feature` of the same repository
- **THEN** the request is refused with a reason naming `first-feature`, and no second agent is started

#### Scenario: After the first commit
- **WHEN** the agent of the in-place `first-feature` session has made the first commit in `/w/acme/fresh-app`, a scan has run, and the user starts **Draft artifacts** for change `second-feature`
- **THEN** the `second-feature` session runs in its own worktree on branch `feat/second-feature`, and a resumed `first-feature` session still runs in place

#### Scenario: Out-of-date scan
- **WHEN** a session's branch would be created from a `HEAD` that names no commit although the last scan reported a commit
- **THEN** the request is refused with a reason saying the repository has no commit yet, no worktree, branch or file is created, and no agent is started

#### Scenario: Archiving a change in a folder that is not a git repository
- **WHEN** the user starts **Archive** for a completed change in a tracked folder that has an `openspec/` tree but no `.git`
- **THEN** the agent starts with the tracked folder as its working directory, no worktree and no branch are created, and no git command is run for the session

#### Scenario: The panel names the folder for an in-place session
- **WHEN** the panel of an in-place session is open
- **THEN** it names the repository folder the agent runs in, shows no branch, and states that the agent edits that folder directly with no branch, no commit and no undo

#### Scenario: An integration session runs in the checkout
- **WHEN** the user activates **Integrate** for a git repository that has no `openspec/config.yaml`
- **THEN** the agent starts with that repository folder as its working directory, no worktree and no branch are created, and the dashboard runs no git command for the session

#### Scenario: The integration panel states the risk
- **WHEN** the panel of an integration session is open
- **THEN** it names the repository folder, shows no branch, and states that the agent edits that folder directly with no branch, no commit and no undo

#### Scenario: A project console runs in the checkout
- **WHEN** the user opens the project console of the tracked git repository `/w/acme/demo-ops`
- **THEN** the agent starts with `/w/acme/demo-ops` as its working directory, no worktree and no branch are created, and the dashboard runs no git command for the session

#### Scenario: Change sessions still never run in the main checkout
- **WHEN** a project console runs in `/w/acme/demo-ops`, which has commits, and the user starts Implement for a change of `demo-ops`
- **THEN** the Implement session runs in its own worktree on its own branch, not in the main checkout

#### Scenario: Draft in a project with docs auto-merge
- **WHEN** `demo-ops` has docs auto-merge on and the user starts **Draft artifacts** for change `rotate-keys`
- **THEN** the session runs in worktree `docs-rotate-keys` on a new branch `docs/rotate-keys` created from the default branch, and the main checkout is unchanged

#### Scenario: Draft without docs auto-merge
- **WHEN** `demo-ops` has docs auto-merge off and the user starts **Draft artifacts** for change `rotate-keys`
- **THEN** the session runs in worktree `rotate-keys` on branch `feat/rotate-keys`, as before

#### Scenario: Implement while the proposal pull request is open
- **WHEN** the local branch `docs/rotate-keys` holds the proposal, `origin/HEAD`'s tree has no `openspec/changes/rotate-keys/`, no branch `feat/rotate-keys` exists, and the user starts **Implement**
- **THEN** the session runs in worktree `rotate-keys` on a new branch `feat/rotate-keys` created from `docs/rotate-keys`, and the `docs-rotate-keys` worktree is neither adopted nor changed

#### Scenario: Implement after the proposal merged
- **WHEN** `origin/HEAD`'s tree holds `openspec/changes/rotate-keys/`, the local branch `docs/rotate-keys` still exists, and the user starts **Implement**
- **THEN** `feat/rotate-keys` is created from `origin/HEAD`

#### Scenario: Implement never works on the proposal branch
- **WHEN** `docs/rotate-keys` is checked out in the running Draft session's worktree and the user starts **Implement** for `rotate-keys`
- **THEN** the Implement session gets its own worktree on `feat/rotate-keys` and does not adopt the Draft session's worktree

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

### Requirement: Configured shortcuts can be sent to a running session
The session panel SHALL offer the configured shortcuts next to the terminal, in their configured order. A shortcut is a
**title**, shown on its control, and a **prompt**, which is the text sent to the agent; the two are independent and the
title SHALL NOT be sent. The shortcuts SHALL be preceded by the visible label `Shortcuts:`, which is not itself a
control and SHALL serve as the accessible name of the group. Activating a shortcut SHALL send it to the agent with one
activation: exactly its prompt SHALL be submitted to the agent's terminal under the rules for text sent on the user's
behalf, so that it is submitted where the agent shows a text prompt and is only typed, never confirmed, where it does
not. The dashboard MUST NOT add to or alter the prompt, MUST NOT substitute anything into it, and MUST NOT interpret the
agent's output to decide which shortcuts to offer. Shortcuts SHALL be offered only while the session is running and its
terminal is connected, and SHALL be the same for every kind of session and every agent profile. Each shortcut SHALL
state, as its tooltip or accessible description, the prompt that will be sent. When no shortcuts are configured, neither
the label nor any control SHALL be shown. After activation, keyboard focus SHALL return to the terminal, and the same
shortcut MUST NOT be sent a second time while its first activation is still in progress. When a prompt was typed but not
submitted, the panel SHALL say so next to the shortcuts. Typed input SHALL keep working exactly as before.

#### Scenario: One click answers the agent
- **WHEN** a session is running, the agent waits at its text prompt, and the user activates the shortcut titled `Yes, go ahead` whose prompt is `Yes, go ahead`
- **THEN** the agent receives `Yes, go ahead` as a submitted answer without any further key press, and keyboard focus is in the terminal

#### Scenario: The title is not the prompt
- **WHEN** a shortcut titled `Ship it` has the prompt `Commit the work, push the branch and open a pull request; ask me before force-pushing.` and the user activates it
- **THEN** the agent receives exactly that prompt as a submitted answer, the title is sent nowhere, and the control shows `Ship it` with the prompt as its tooltip

#### Scenario: A response never confirms a menu
- **WHEN** the agent shows a selection menu with an option highlighted and the user activates any shortcut
- **THEN** no Enter is sent, the highlighted option is not confirmed, the session keeps running, and the panel says that the text was typed but not sent

#### Scenario: The set and its order
- **WHEN** the configuration lists the shortcuts `Review`, `Yes, go ahead` and `No, stop here` in that order and the panel of a running, connected session is open
- **THEN** it offers exactly those three, in that order, and no others

#### Scenario: Nothing configured
- **WHEN** the configured list of shortcuts is empty and the panel of a running, connected session is open
- **THEN** no shortcut controls and no `Shortcuts:` label are shown, and typing into the terminal still works

#### Scenario: The row is labelled
- **WHEN** the panel of a running, connected session is open and at least one shortcut is configured
- **THEN** the label `Shortcuts:` is shown in front of the first shortcut, activating it sends nothing, and assistive technology announces the group as "Shortcuts"

#### Scenario: Asking the agent to resolve conflicts
- **WHEN** a session is running, the agent waits at its text prompt, and the user activates the shortcut whose prompt is `Resolve PR conflicts`
- **THEN** the agent receives exactly `Resolve PR conflicts` as a submitted answer, and the dashboard runs no git command and contacts no remote because of it

#### Scenario: Not offered when the session is not running
- **WHEN** the agent has exited, or the session failed to start
- **THEN** no shortcuts and no `Shortcuts:` label are shown

#### Scenario: Not offered while disconnected
- **WHEN** the session is running but the panel's terminal connection is not open
- **THEN** no shortcuts are offered until the terminal is connected again

#### Scenario: Double activation
- **WHEN** the user double-clicks a shortcut
- **THEN** the agent receives its prompt once

#### Scenario: Keep typing
- **WHEN** the user has sent a shortcut and then types on the keyboard without clicking anything
- **THEN** the keystrokes go to the terminal

#### Scenario: Any agent
- **WHEN** the session runs an agent from a user-defined profile rather than the preconfigured one, or is the main console or an Integrate session
- **THEN** the same configured shortcuts are offered and sent in the same way

### Requirement: Shortcuts are configurable, with the shipped set as the default
Shortcuts SHALL be part of the dashboard's own configuration, not built in. Each SHALL have a stable identifier, a
title and a prompt. The configuration SHALL be accepted only when every title is non-empty after trimming and short
enough to read on a control, every prompt is non-empty after trimming and a **single line** without control characters,
every identifier is unique, and no prompt carries permission-bypass wording — the same rule that applies to every other
prompt the dashboard sends to an agent. A prompt SHALL support no placeholder: it is sent exactly as written. An empty
list SHALL be valid. A configuration that does not mention shortcuts at all — every configuration saved before they
became configurable — SHALL be read as carrying the shipped defaults, which SHALL be, in this order, `Yes, go ahead`,
`Yes, create a PR`, `Resolve PR conflicts` and `No, stop here`, each with its title as its prompt. A user's saved list
SHALL never be replaced or extended by the dashboard, not even when the shipped defaults change.

#### Scenario: A configuration from before shortcuts were configurable
- **WHEN** the dashboard loads a saved configuration that has no shortcuts
- **THEN** the loaded configuration carries the four shipped defaults in their order, and the console offers exactly them

#### Scenario: A saved list is left alone
- **WHEN** a saved configuration lists two shortcuts of the user's own and none of the shipped ones
- **THEN** the loaded configuration carries exactly those two, and no default is added back

#### Scenario: An empty list is kept
- **WHEN** the user saves a configuration with no shortcuts
- **THEN** it is accepted and reloading the dashboard still shows no shortcuts

#### Scenario: A prompt spanning several lines is refused
- **WHEN** a configuration is saved with a shortcut whose prompt contains a line break
- **THEN** the save is refused with a message naming that shortcut's prompt, and the stored configuration is unchanged

#### Scenario: An empty title is refused
- **WHEN** a configuration is saved with a shortcut whose title is blank or only spaces
- **THEN** the save is refused and the stored configuration is unchanged

#### Scenario: Bypass wording is refused
- **WHEN** a configuration is saved with a shortcut prompt that tells an agent to skip its permission checks
- **THEN** the save is refused, exactly as for an agent's other prompts

### Requirement: Shortcuts are edited in the Agent sessions settings
The Settings page SHALL let the user manage shortcuts within its **Agent sessions** section, without adding a section of
its own. The section SHALL list the configured shortcuts in their order and allow, for each, editing its title and its
prompt, removing it, and moving it earlier or later in the order; it SHALL allow adding a shortcut and restoring the
shipped defaults. The prompt SHALL be presented as the text that will be sent to the agent and the title as what the
control will read. Edits SHALL take part in the page's single draft and save bar like every other setting: they survive
navigating between sections, count towards "unsaved changes", and reach the configuration only when the page is saved.
A refused save SHALL keep the user's edits in the page and say what is wrong.

#### Scenario: Editing a title and a prompt
- **WHEN** the user renames a shortcut to `Ship it`, replaces its prompt with two sentences on one line, and saves
- **THEN** the configuration carries that title and prompt, and the console's control reads `Ship it` and sends the prompt

#### Scenario: Adding a shortcut
- **WHEN** the user adds a shortcut, gives it a title and a prompt, and saves
- **THEN** it appears last in the console's shortcuts and sends its prompt

#### Scenario: Reordering
- **WHEN** the user moves the last shortcut to the first position and saves
- **THEN** the console offers the shortcuts in the new order

#### Scenario: Removing all of them
- **WHEN** the user removes every shortcut and saves
- **THEN** the save is accepted and the console shows no shortcut row

#### Scenario: Restoring the defaults
- **WHEN** the user has changed the shortcuts, activates the restore control, and saves
- **THEN** the configuration carries exactly the four shipped defaults in their order

#### Scenario: Edits survive navigation
- **WHEN** the user edits a shortcut's prompt, navigates to another section and back
- **THEN** the edited prompt is still in the field and the save bar still shows "unsaved changes"

### Requirement: Status shown for a session is limited to what a terminal can tell
The dashboard SHALL show a session as running, ended (with a non-zero exit code or an error highlighted) or failed, and SHALL record when the terminal last produced output that counts as activity.

Output **counts as activity** unless it arrives within the echo window after the dashboard resized the session's terminal or passed input to it — a viewer's keystrokes, input the browser terminal generates by itself (focus reports, replies to the agent's queries), or text submitted on the user's behalf. The echo window SHALL be at most 3 seconds after the latest such event. Output inside the window SHALL still be relayed to every viewer and kept in the scrollback unchanged; it only does not move the time of the last output. Attaching, resizing, focusing or detaching a viewer therefore MUST NOT change a session's state.

A running session for which the agent has not reported a state (see "An agent can report its state through a file") SHALL be shown in one of two named states, decided **only** by how long ago its terminal last produced output that counts as activity:

- while such output arrived within the silence threshold, a state that says the terminal is producing output;
- once the terminal has been silent for longer than the threshold, a state that says the session may need the user, together with how long the silence has lasted.

The silence threshold SHALL be short enough that a session blocked on a question is surfaced within seconds rather than after a minute, and SHALL be at most 30 seconds. Every running state SHALL be equally prominent wherever a running session's status is shown, and SHALL be told apart by their words, not by colour or motion alone. The state that says the session may need the user SHALL be phrased as a possibility, never as a fact.

The decision MUST NOT use anything but the times of the output that counts, of the dashboard's own resizes and input, and the agent's report: the agent's output MUST NOT be read, parsed, matched or classified for it, and nothing vendor-specific SHALL be introduced. The dashboard MUST NOT claim on its own to know that an agent is waiting, working, or how much it has cost; a reported state SHALL be shown as the agent's report.

#### Scenario: Terminal is producing output
- **WHEN** a running session's terminal printed something that counts as activity within the silence threshold
- **THEN** its badge reads as the producing-output state, and does not suggest that the user is needed

#### Scenario: Terminal falls silent
- **WHEN** a running session's terminal has printed nothing that counts as activity for longer than the silence threshold
- **THEN** its badge changes, within one refresh, to the state that says the session may need the user, and states how long the terminal has been silent

#### Scenario: Quiet terminal
- **WHEN** a running session's terminal has printed nothing for ten minutes
- **THEN** its badge says the session may need the user and that the terminal has been silent for 10 minutes

#### Scenario: Output resumes
- **WHEN** the terminal of a session shown as possibly needing the user prints something again that counts as activity
- **THEN** its badge returns to the producing-output state and the silence duration is dropped

#### Scenario: Opening the console does not wake the badge
- **WHEN** a session has been shown as possibly needing the user for two minutes, and the user opens its console, so that the terminal is resized and focused and the agent redraws its screen
- **THEN** the redraw is shown in the terminal, and the badge still says the session may need the user and that the terminal has been silent for two minutes

#### Scenario: Typing is not the agent working
- **WHEN** the user types into a silent session's terminal and the agent echoes the keystrokes
- **THEN** the echo does not count as activity; output the agent produces after the echo window does

#### Scenario: Work that outlasts the echo window counts
- **WHEN** the user presses Enter in a session's terminal and the agent prints output continuously for a minute
- **THEN** the badge shows the producing-output state once output arrives after the echo window

#### Scenario: Both states readable without colour
- **WHEN** any running state is shown with colour and motion removed
- **THEN** the states are still told apart by their words

#### Scenario: Status on a board card
- **WHEN** a change's card carries a chip for a running session
- **THEN** that chip shows which of the running states the session is in

#### Scenario: The dashboard does not claim to know
- **WHEN** an agent that reports no state is in fact busy but has printed nothing for longer than the threshold
- **THEN** the dashboard still shows the possibly-needs-you state, worded as a possibility, and never asserts that the agent is waiting or working

### Requirement: Session records live outside repositories
Session metadata SHALL be stored only under `~/.spec-control/sessions/<session-id>/`, written atomically and readable by the user only; when a session ends, the bounded tail of its terminal output SHALL be stored there too, so that an ended session still shows what happened. The agent's state file (see "An agent can report its state through a file") SHALL be in the same folder. The dashboard SHALL keep the newest 50 ended sessions, and a session's record SHALL be deletable from the UI once it has ended; deleting or pruning a record removes its state file with it.

#### Scenario: Looking at an ended session
- **WHEN** the user opens the panel of a session that ended before the dashboard was restarted
- **THEN** the stored terminal output is shown and no input is accepted

#### Scenario: State file goes with its record
- **WHEN** an ended session's record is deleted or pruned
- **THEN** its state file is gone as well, and nothing of it remains outside `~/.spec-control/sessions/`

### Requirement: An agent can report its state through a file
Every agent session — change sessions, the main console, project consoles and integrations alike — SHALL be started with the environment variable `SPEC_CONTROL_STATE_FILE` set to the absolute path of a file named for that purpose in the session's record folder. Before the agent is started or restarted, the dashboard SHALL remove any file left at that path, so a report never outlives the process that wrote it. The dashboard MUST NOT write that file otherwise, MUST NOT change the agent's configuration to write it, and MUST NOT ask the agent in a prompt to write it: wiring it up — for example in hooks the agent runs when it ends a turn or asks for permission — is the user's own configuration.

The dashboard SHALL read the file's modification time and at most its first 64 bytes, and SHALL recognise exactly two reports: `waiting` and `working`, as the whole content apart from surrounding whitespace and case. Anything else, an unreadable file, a file that is not a regular file, or a missing file SHALL be treated as no report. A report is **current** while it was written after the session's process started and after the latest input the user gave the session — keystrokes, mouse input, or text submitted on the user's behalf; input the browser terminal generates by itself (focus reports, replies to the agent's queries) and resizes MUST NOT make a report stale.

While the current report is `waiting`, a running session SHALL be shown in a state that says the agent reported that it is waiting for the user, with how long ago it reported, worded as the agent's report. While the current report is `working`, or there is no current report, the silence-based states of "Status shown for a session is limited to what a terminal can tell" SHALL apply. Reported states SHALL be read at least as often as the session list is refreshed. An ended or failed session SHALL be shown as today, whatever its last report was.

#### Scenario: Variable is set
- **WHEN** any agent session is started or resumed
- **THEN** the agent's environment contains `SPEC_CONTROL_STATE_FILE`, naming a path under `~/.spec-control/sessions/<session-id>/`, and no file exists at that path yet

#### Scenario: Agent reports waiting
- **WHEN** a running session's agent writes `waiting` into the file
- **THEN** within one refresh its badge says the agent reported that it is waiting for the user and how long ago, even while the terminal is still printing or opened in a console

#### Scenario: User answers
- **WHEN** a session shows the agent's waiting report and the user types into its terminal or the dashboard submits a shortcut to it
- **THEN** the report is no longer current and the badge falls back to the silence-based states

#### Scenario: Opening the console keeps the report
- **WHEN** a session shows the agent's waiting report and the user opens its console, so that the terminal is resized and sends a focus report
- **THEN** the badge still shows the agent's waiting report

#### Scenario: Agent resumes on its own
- **WHEN** a session shows the agent's waiting report and the agent writes `working` into the file
- **THEN** the badge falls back to the silence-based states

#### Scenario: Unrecognised content
- **WHEN** the file holds anything other than `waiting` or `working`, is larger than 64 bytes, or is a directory or a symbolic link
- **THEN** the session is shown as if it had reported nothing

#### Scenario: Agent without reports
- **WHEN** no file is ever written for a session
- **THEN** its badge behaves exactly as the silence-based states describe

#### Scenario: Report from an earlier run
- **WHEN** a session whose last report was `waiting` is resumed
- **THEN** the old report is removed before the agent starts and the resumed session shows the silence-based states until it reports again

### Requirement: Worktree clean-up is offered only when safe
When ending or cleaning up a session, or for a worktree that has no session record, the dashboard SHALL offer to remove the worktree only if the dashboard created it, it has no uncommitted changes, and either its work status is `merged` or it has no commits that exist nowhere else (nothing ahead of its upstream, or, without an upstream, no commit that is unreachable from every other local or remote-tracking branch). Removal SHALL happen only after the user confirms, by a non-forcing `git worktree remove` — the one exception is the automatic removal when a session's auto-merge pull request has merged, under the same checks, as specified in "A merged auto-merge pull request ends its session"; removing a session's worktree from the session views never deletes its branch — deleting merged branches is done only by repository cleanup, as specified in the `repository-cleanup` capability. Otherwise the worktree MUST be kept and the reason shown. A worktree MUST NOT be removed while a session is running in it. A worktree that a session adopted MUST NOT be offered for removal by the session views and MUST NOT be removed by them; it MAY be removed by repository cleanup under that capability's rules, like any other linked worktree the user created, when no session is running in it. An in-place session has no worktree: removal MUST NOT be offered for it, and ending it SHALL end the agent and nothing else.

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

### Requirement: Every session worktree has a work status
For every directory under `~/.spec-control/worktrees/<repoId>/` of a configured repository the dashboard SHALL derive a work status from local git, using read-only commands and without contacting a remote. The base is the repository's default branch as locally known (`origin/HEAD`), or the main checkout's `HEAD` when there is none. The status SHALL be the first that applies: `missing` when the directory is not a git worktree; `uncommitted` with the number of changed or untracked files; `merged` when the branch has no commit that the base lacks and a remote-tracking branch of the same name exists, or when every file the branch changed has the same content in the base (which also recognises squash and rebase merges); `clean` when the branch has no commit that the base lacks; `unpushed` with the number of commits ahead of its upstream, or all commits the base lacks when it has no upstream; otherwise `pushed`. Statuses MAY be cached for up to 15 seconds and MUST be recomputed after a session ends, a Ship action or a worktree removal. Because nothing is fetched, `merged` reflects the user's last fetch; the UI MUST say so.

For a status of `uncommitted`, `unpushed` or `pushed` the dashboard SHALL additionally determine whether merging the worktree's branch into that same base would conflict, and report the conflicting paths with it, capped at a bounded number. The check SHALL be made by merging the two commits in memory only: it MUST NOT change the worktree's or the main checkout's working tree, index, `HEAD` or any ref, MUST NOT contact a remote, and any objects git writes for it MUST be directed into a scratch object store under `~/.spec-control/`, so that nothing is created inside the tracked repository. When the check cannot be made — there is no base, git is too old for it, or it fails for any other reason — the work status SHALL simply carry no conflict information, and the dashboard MUST NOT treat that as an error or fall back to a check that writes. Because nothing is fetched, a conflict is a statement about the base as of the user's last fetch, and the UI MUST say so and MUST point at the pull action as the way to refresh the base.

#### Scenario: Uncommitted files
- **WHEN** a session's worktree contains two modified files and one untracked file
- **THEN** its work status is `uncommitted` with a count of 3

#### Scenario: Committed but not pushed
- **WHEN** the worktree is clean and its branch has two commits and no upstream
- **THEN** its work status is `unpushed` with a count of 2

#### Scenario: Pushed
- **WHEN** the worktree is clean and its branch equals its upstream but the base lacks its commits and content
- **THEN** its work status is `pushed`

#### Scenario: Squash-merged
- **WHEN** the base contains one commit with the same file content as the branch's three commits
- **THEN** its work status is `merged`

#### Scenario: Worktree without a session record
- **WHEN** a session's record is deleted while its worktree holds uncommitted files
- **THEN** the worktree is still listed with status `uncommitted`

#### Scenario: No network
- **WHEN** work statuses are computed
- **THEN** no git command that contacts a remote is run

#### Scenario: Branch that no longer merges
- **WHEN** the base and the worktree's pushed branch have both changed the same lines of two files
- **THEN** the work status is `pushed` and reports a conflict naming those two files

#### Scenario: Branch that still merges
- **WHEN** the base has moved ahead with commits that touch other files than the worktree's branch
- **THEN** the work status reports no conflict

#### Scenario: The check leaves the repository untouched
- **WHEN** work statuses including the conflict check are computed for a repository whose branch conflicts
- **THEN** no file in the repository's working tree, index, refs or object database is created, modified or deleted, and the worktree's `HEAD` and `git status` are unchanged

#### Scenario: The check is unavailable
- **WHEN** the installed git cannot merge two commits without touching the working tree
- **THEN** every work status is still reported, none carries conflict information, and no error is shown

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

### Requirement: A repository can require Conventional Commits pull request titles
Each repository entry in the configuration MAY carry `prTitleConvention`, whose only valid value is `conventional-commits`; absent means the repository has no pull request title convention. A configuration without the field SHALL load unchanged with no convention for any repository, and a configuration carrying any other value SHALL be rejected when saved, leaving the stored configuration unchanged. The setting SHALL be stored only in the dashboard's own configuration and MUST NOT be written to, or read from, any tracked repository.

Whenever the dashboard produces the Ship prompt for a session of a repository whose convention is `conventional-commits`, it SHALL append, separated by one space, a fixed sentence asking the agent to title the pull request as a Conventional Commit — `<type>(<optional scope>): <summary>`, with an example — and to write the commit messages in the same form. The sentence SHALL be appended to the profile's own Ship prompt or, when the profile has none, to the default, and the profile's additional Ship instructions SHALL follow it; the auto-merge instruction for docs-only pull requests, when included, SHALL still come after both. The composed prompt SHALL remain one line and `{change}` SHALL be substituted in it as before. This SHALL apply wherever the Ship prompt is used — typed into a running session or handed to an ended session's agent on start-up. For a repository without a convention the Ship prompt SHALL be exactly what it would be without this requirement. No other prompt — the session starters, Resolve conflicts, Integrate — SHALL carry the sentence. The dashboard MUST NOT title, rename or edit a pull request itself, and the setting MUST NOT change whether Ship is offered.

#### Scenario: Ship for a repository with the convention
- **WHEN** `demo-ops` has `prTitleConvention: conventional-commits`, its agent has no Ship prompt and no additional Ship instructions, and Ship is used on a session whose work is `unpushed`
- **THEN** the submitted prompt is the default Ship prompt followed by one space and the Conventional Commits sentence, on one line

#### Scenario: The convention and additional instructions
- **WHEN** the repository has the convention and the profile has its own Ship prompt and additional Ship instructions `Add the checklist from CONTRIBUTING.md.`
- **THEN** the submitted prompt is the profile's Ship prompt, then the Conventional Commits sentence, then `Add the checklist from CONTRIBUTING.md.`, each separated by one space

#### Scenario: The convention and auto-merge of docs-only pull requests
- **WHEN** the repository has the convention and auto-merge of docs-only pull requests on, and Ship is used on a session that ships only OpenSpec documents
- **THEN** the submitted prompt is the Ship prompt, then the Conventional Commits sentence, then the profile's additional Ship instructions if any, then the auto-merge instruction

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

### Requirement: Any available action can be sent to the change's running session
For a running session of a change the dashboard SHALL be able to send the opening prompt of any starter to that session instead of opening a new one, under the same conditions as opening: the action must be available in the change's current stage and the session's agent must have a prompt for it. Every action qualifies, **Archive** included — it is how a completed change is archived without ending the agent that worked on it — and the action the session itself was started with SHALL NOT restrict what may be sent to it. The prompt SHALL be submitted to the session's terminal under the rules for text sent on the user's behalf, so that one activation sends it where the agent shows a text prompt and it is only typed, never confirmed, where it does not. The result SHALL state whether the prompt was submitted, and when it was only typed the dashboard SHALL say so as it does for any other text sent on the user's behalf. The session's recorded action SHALL become the one sent, whether or not the prompt was submitted. When **Archive** is sent, the dashboard SHALL decide, under the rules of the session starters' requirement and in the session's own working directory, whether to append the archive auto-merge instruction, and the result SHALL state whether it was included; that check is the only git it runs for a prompt, and it is read-only. Nothing SHALL be sent to a session that is not running, and sending a prompt SHALL create no worktree, run no git command that writes and start no process.

#### Scenario: Draft finished, Implement next
- **WHEN** a Draft session is still running, the change has reached `Ready`, and Implement is sent to it
- **THEN** the agent's Implement prompt for that change is typed into the terminal, Enter is pressed as a separate key press once the terminal shows it, the agent receives the prompt without any further key press from the user, no second process is started, and the session's action is `implement`

#### Scenario: Archive goes into the running session
- **WHEN** a change is in `Done`, its session is still running, and Archive is sent to it
- **THEN** the agent's Archive prompt for that change is submitted to that terminal, no second session is opened and no worktree is created, and the session's action is `archive`

#### Scenario: An archiving session takes the next step
- **WHEN** a change's only running session was started as Archive, the change's stage still allows Validate, and Validate is sent to it
- **THEN** the prompt is submitted to that same session and no second session is opened

#### Scenario: The agent shows a selection menu
- **WHEN** Implement is sent to a running session whose agent shows a selection menu with an option highlighted
- **THEN** no Enter is pressed, the highlighted option is not confirmed, the session keeps running, the result says the prompt was not submitted, and the dashboard tells the user that it was typed but not sent

#### Scenario: Stage does not allow it
- **WHEN** Implement is sent to a running session of a change that still lacks artifacts
- **THEN** the request is refused and nothing is written to the terminal

#### Scenario: The session has ended
- **WHEN** a starter's prompt is sent to a session that is no longer running
- **THEN** the request is refused, nothing is written to the terminal and no process is started

#### Scenario: Archive into an implementing session that holds code
- **WHEN** a repository has auto-merge on, a change's Implement session is running in a worktree whose branch changes `src/keys.ts`, and Archive is sent to it
- **THEN** the Archive prompt is submitted without the auto-merge instruction and the result states that it was not included

#### Scenario: Archive into a session that holds only OpenSpec documents
- **WHEN** a repository has auto-merge on, a change's Draft session is running in a worktree whose branch changes only files under `openspec/`, and Archive is sent to it
- **THEN** the submitted Archive prompt ends with the archive auto-merge instruction and the result states that it was included

#### Scenario: Other actions sent stay unchanged
- **WHEN** a repository has auto-merge on and Validate is sent to a running session
- **THEN** no git command runs for it and the prompt carries no auto-merge instruction

### Requirement: Ending a session removes a removable worktree by default
Wherever the dashboard asks the user to confirm ending or cleaning up a session and offers to remove its worktree, that
offer SHALL be pre-selected whenever it is made — that is, whenever the worktree may be removed under "Worktree clean-up
is offered only when safe" — whatever the worktree's work status, and not only when it is `merged`. The offer SHALL
remain a visible control the user can clear before confirming. When the worktree may not be removed, nothing SHALL be
pre-selected and the reason SHALL be shown as before. Confirming with the offer cleared SHALL keep the worktree;
cancelling SHALL end, remove and pull nothing. Every such dialog SHALL start from this default: a choice the user made
in an earlier dialog SHALL NOT carry over. The removal SHALL still be decided by the server's own checks at the moment
of confirmation, so a worktree that became unsafe to remove after the dialog opened is kept and the reason reported. For a session of a change that is stale under the `stale-changes` capability, or would be once the session has ended, the stale cleanup of the requirement "Ending a session cleans up a stale change's leftovers" takes the place of this removal offer.

#### Scenario: Pushed work, removal pre-selected
- **WHEN** the user ends a session whose worktree is clean and whose commits are all on its upstream, while its work
  status is still `pushed` because the merge has not been fetched yet
- **THEN** the dialog offers to remove the worktree, already selected, and confirming removes the worktree and keeps
  its branch

#### Scenario: Merged work, removal pre-selected
- **WHEN** the user ends a session whose worktree is clean and whose work status is `merged`
- **THEN** the dialog offers to remove the worktree, already selected

#### Scenario: Removal cleared
- **WHEN** the user clears the removal offer and confirms
- **THEN** the session ends and the worktree is kept

#### Scenario: Worktree that cannot be removed
- **WHEN** the user ends a session of a change that is not archived and merged, whose worktree has an uncommitted file
- **THEN** no removal is offered or selected, and the dialog says why the worktree is kept

#### Scenario: Earlier choice not remembered
- **WHEN** the user cleared the removal offer when ending one session and then ends another session whose worktree may
  be removed
- **THEN** the second dialog offers the removal already selected

### Requirement: Ending a session also offers to pull the repository
Wherever the dashboard offers to remove a session's worktree when the session ends, it SHALL — for a repository the
pull action can run in, meaning a tracked git repository that was scanned without error — also offer to pull that
repository, so that the main checkout the dashboard reads archives, specs and progress from catches up with work that
was merged. The offer SHALL be pre-selected whenever it is made, whatever the worktree's work status, and SHALL remain
a visible control the user can clear before confirming; a choice the user made in an earlier dialog SHALL NOT carry
over. It SHALL be shown whether or not the worktree itself can be removed. When the user confirms with the offer
selected, the pull SHALL run after the session has ended and after the worktree was removed, and SHALL be the same
action the repository's own Pull control runs, with the same safety rules and the same outcomes. A pull that is
already running for that repository SHALL NOT be started a second time. Nothing SHALL be pulled when the offer is not
selected, when the user cancels, or for a repository the pull action cannot run in.

#### Scenario: Merged work, pull pre-selected
- **WHEN** the user ends a session whose worktree's work status is `merged`, in a tracked git repository
- **THEN** the dialog offers both the worktree removal and the pull, both already selected

#### Scenario: Pushed work, pull pre-selected
- **WHEN** the user ends a session whose worktree's work status is `pushed`, in a tracked git repository
- **THEN** the dialog offers the pull, already selected

#### Scenario: Confirming pulls after the worktree is gone
- **WHEN** the user confirms with both offers selected
- **THEN** the session ends, the worktree is removed, and only then is the repository fetched and fast-forwarded

#### Scenario: Unshipped work
- **WHEN** the user ends a session whose worktree has commits that exist only on its branch
- **THEN** the worktree removal is not offered, the pull is offered and already selected, and confirming ends the
  session, keeps the worktree and pulls the repository

#### Scenario: Offer declined
- **WHEN** the user clears the pull offer and confirms
- **THEN** the session ends and no remote is contacted

#### Scenario: Cancelled dialog
- **WHEN** the user cancels the dialog while the pull offer is selected
- **THEN** nothing is ended, removed or pulled

#### Scenario: Not a repository the pull action can run in
- **WHEN** the session's repository is not a git repository, or its last scan failed
- **THEN** no pull is offered and ending the session pulls nothing

### Requirement: A pull the user needs to know about is stated before the dialog closes
When a pull started from the end-session dialog leaves the main checkout behind — it only fetched, was refused, or
failed — the dialog SHALL stay open, SHALL name that outcome with git's reason available, and SHALL say that the
session has already ended, so that the user learns the view may still be outdated. A pull that fast-forwarded the
checkout, found it already up to date, or found the repository has no remote to pull from SHALL close the
dialog. While the pull runs the dialog SHALL show that it is
running and SHALL NOT accept a second confirmation. The outcome SHALL also be reported next to the repository's own
Pull control, as any other pull's is.

#### Scenario: Refused pull
- **WHEN** the pull is refused because local and remote history have diverged
- **THEN** the dialog stays open, says the pull was refused and why, and says the session has ended

#### Scenario: Failed pull
- **WHEN** the remote cannot be reached
- **THEN** the dialog stays open with git's reason, and the session and the worktree removal are unaffected

#### Scenario: Successful pull
- **WHEN** the pull fast-forwards the main checkout by two commits
- **THEN** the dialog closes, the board shows the repository's new state without a page reload, and `+2 commits` is
  reported next to the repository's Pull control

#### Scenario: While it runs
- **WHEN** the pull started from the dialog has not finished
- **THEN** the dialog shows that it is running and confirming again starts nothing

### Requirement: Ending an in-place change session can always be confirmed
When the user asks to end or clean up a change session that runs in place (in a tracked folder that is not a git
repository, or in a git repository with no commit yet), the confirmation dialog SHALL let them confirm at once. It SHALL
NOT wait for, ask for or show a worktree status, SHALL NOT offer to remove a worktree, and SHALL NOT offer to pull the
repository. Confirming SHALL end the agent as **End session** does everywhere else and SHALL leave the folder as the
agent left it. Cancelling SHALL end nothing. A session that has a worktree SHALL keep its current dialog, including
waiting for its worktree status before it can be confirmed.

#### Scenario: Running in-place session in a repository with no commit
- **WHEN** a change session runs in place in a git repository with no commit, and the user clicks **End session**
- **THEN** the dialog's **End session** button can be clicked straight away, no pull or worktree removal is offered,
  and confirming stops the agent

#### Scenario: In-place session in a folder without git
- **WHEN** the user ends a change session that runs in place in a folder that is not a git repository
- **THEN** the dialog can be confirmed straight away and offers no pull

#### Scenario: Ended in-place session
- **WHEN** an in-place change session has already ended and the user clicks **Clean up**
- **THEN** the dialog's **Done** button can be clicked straight away

#### Scenario: In-place session after the repository got its first commit
- **WHEN** a change session that started in place keeps running after the repository got its first commit and an
  upstream, and the user ends it
- **THEN** the dialog still offers no pull or worktree removal and can be confirmed straight away

#### Scenario: Worktree session still waits for its status
- **WHEN** the user ends a session that has a worktree, and its worktree status has not arrived yet
- **THEN** the confirm button stays disabled until the status arrives, as before

### Requirement: Resolve conflicts asks the agent to make the branch mergeable again
The dashboard SHALL offer a Resolve conflicts action for a change when either of two **conflict signals** holds: the
**local signal** — a session worktree of the change reports a conflict in its work status — or the **GitHub signal** —
the change's linked pull request is `open` (drafts included) and has mergeability `conflicting` in the cached
pull-request list. Both signals SHALL be derived by one shared rule, so that the change detail, the session panel and
the server's refusals never disagree. Where a pull request is linked, the local signal SHALL be read from the session
worktree on that pull request's head branch. The offered action SHALL name, for each signal that holds, the base it
conflicts with and how fresh it is: the local signal "as of your last fetch", pointing at the pull action; the GitHub
signal as of the last refresh of that repository's pull-request list. When both signals are available and disagree,
the action SHALL still be offered and both SHALL be shown. When the change's worktree on the head branch has a `HEAD`
other than the pull request's cached head commit, the GitHub signal SHALL still offer the action and SHALL carry a
**push pending** hint saying that the worktree has commits GitHub has not seen, so the conflict may already be resolved
locally. Offering, showing or running the action MUST NOT
start a `gh` query or a fetch.

The action uses the agent profile's resolve-conflicts prompt, or an agent-neutral default asking the agent to bring the
branch up to date with the base, resolve the conflicts while keeping what the branch set out to do, run the project's
checks and push the result. When a pull request is linked, a fixed sentence SHALL follow the prompt and its additional
instructions, naming the pull request's number, head branch and base branch — all taken from the server's cached list,
never from the request — and asking the agent to bring the branch level with `origin/<head branch>` first if it is
behind, resolve against that base and push to that head branch. Where the action runs is decided before anything is
created:

- when a session for the change is **running** in a worktree on the pull request's head branch (or, with no pull
  request, in any session worktree of the change), the prompt SHALL be submitted to its terminal under the rules for text
  sent on the user's behalf, so that one activation sends it;
- otherwise, when a session worktree of the change on that branch exists, the agent SHALL be started there — with its
  resume command and the prompt submitted after start-up when it has one, else with its command and the prompt as
  opening prompt — in the same session record, under the same checks as Ship;
- otherwise, for the GitHub signal, a session SHALL be started on the pull request's head branch as the requirement "A
  conflicting pull request without a worktree gets a session on its head branch" specifies.

The result SHALL state whether the prompt was submitted, and when it was only typed the panel SHALL say so.

The dashboard itself MUST NOT resolve anything: it MUST NOT merge, rebase, cherry-pick, commit, push, or write any file
in the repository for this action, and MUST NOT check out anything beyond creating a session's worktree as specified.
Everything beyond handing over the prompt is the agent's doing under its own permission prompts.

The resolve-conflicts prompt SHALL be a configurable prompt of the profile like any other: it MAY use `{change}` and no
other placeholder, MUST NOT carry a permission-bypass mode or flag, SHALL be offered in Settings beside the other
prompts, and SHALL take that key's additional instructions — appended to the profile's prompt, or to the agent-neutral
default when the profile has none, exactly as Ship does. Additional instructions for another action MUST NOT reach it.
The fixed pull-request sentence is not configurable.

The action SHALL NOT be offered, and a request for it SHALL be refused with the reason, when neither signal holds — the
local signal does not hold for a worktree whose status is `missing`, `clean` or `merged` or whose conflict check was
unavailable; when a session for the change is running in a worktree on another branch than the pull request's head
branch, naming that session and branch; when a session worktree of the change exists on another branch than the pull
request's head branch, naming it; and for an in-place session, which has no worktree and no branch.

#### Scenario: Resolving in a running session
- **WHEN** Resolve conflicts is used on a running session whose worktree conflicts and whose agent waits at its text
  prompt
- **THEN** the prompt is typed, shown by the agent, submitted with a separate Enter, and no git command that changes the
  repository is run by the dashboard

#### Scenario: The agent shows a menu
- **WHEN** Resolve conflicts is used on a running session whose agent shows a selection menu
- **THEN** no Enter is pressed, nothing is confirmed, and the panel says the prompt was typed but not sent

#### Scenario: Resolving after the session ended
- **WHEN** Resolve conflicts is used on an ended session of an agent with a resume command
- **THEN** the agent is started again in the same worktree and session record, and the prompt is submitted after
  start-up

#### Scenario: GitHub reports a conflict the local check does not see
- **WHEN** change `rotate-keys` has an ended session whose worktree on `feat/rotate-keys` reports no conflict as of the
  last fetch, and its linked open pull request `#88` from `feat/rotate-keys` into `main` is cached as `conflicting`
- **THEN** Resolve conflicts is offered, saying GitHub reports conflicts with `main` as of the last pull-request refresh,
  and using it resumes the agent in that worktree with the prompt followed by the sentence naming `#88`,
  `feat/rotate-keys` and `main`

#### Scenario: Both signals
- **WHEN** a change's worktree reports a conflict with `origin/main` and its linked pull request is cached as
  `conflicting`
- **THEN** the action is offered once, and both signals are shown, each with its own freshness

#### Scenario: A local fix not pushed yet
- **WHEN** the linked pull request `#88` is cached as `conflicting` at head commit `a1…` and the worktree on
  `feat/rotate-keys` is at commit `b2…`
- **THEN** Resolve conflicts is still offered, and the GitHub signal says push pending: the worktree has commits GitHub
  has not seen

#### Scenario: Nothing to resolve
- **WHEN** Resolve conflicts is requested for a change whose worktree reports no conflict and whose linked pull request
  is cached as `mergeable`
- **THEN** the request is refused with the reason and no process is started

#### Scenario: A session running on another branch
- **WHEN** a session for `rotate-keys` is running on `wip/rotate-keys-spike` and the linked pull request `#88` from
  `feat/rotate-keys` is cached as `conflicting`
- **THEN** Resolve conflicts is refused with a reason naming that session and `wip/rotate-keys-spike`, and nothing is
  typed into it

#### Scenario: The action starts no query and no fetch
- **WHEN** Resolve conflicts is offered and used
- **THEN** no `gh` process and no `git fetch` is started for it

#### Scenario: Not offered without git
- **WHEN** a session runs in place in a tracked folder that is not a git repository
- **THEN** no conflict is reported for it, no Resolve conflicts control is shown, and a request for it is refused

#### Scenario: A configured prompt and its additional instructions are used
- **WHEN** a profile has no resolve-conflicts prompt of its own but additional resolve-conflicts instructions
  `We rebase here, never merge.`, and Resolve conflicts is used on a conflicting session without a linked pull request
- **THEN** the text handed to the agent is the agent-neutral default followed by one space and that sentence, and a
  configuration carrying either of them survives being saved and loaded

#### Scenario: The user is told how fresh it is
- **WHEN** a worktree's branch is reported as conflicting with `origin/main`
- **THEN** the dashboard names `origin/main`, says that this is as of the user's last fetch, and points at the pull
  action

### Requirement: A former preset command is read as the current one
A saved profile whose id is a preset's and whose command is, argument for argument, one of that preset's former
commands SHALL be loaded with the preset's current command. Any other command — edited, of a profile with no preset's
id, or another preset's former command — is the user's and SHALL be loaded as saved. Loading SHALL NOT write the
configuration file; the upgraded command reaches it with the next save. The Antigravity preset's former command is
`agy`, `-i`, `{prompt}`.

#### Scenario: The former Antigravity command is upgraded
- **WHEN** a configuration whose `agy` profile has the command `agy`, `-i`, `{prompt}` is loaded
- **THEN** the loaded profile's command is `agy`, `--prompt-interactive={prompt}`, its prompts and resume command are unchanged, and the file on disk is unchanged until the next save

#### Scenario: An edited command is the user's
- **WHEN** a configuration whose `agy` profile has the command `agy`, `-i`, `{prompt}`, `--model`, `fast` is loaded
- **THEN** the loaded profile's command is exactly that

#### Scenario: Another profile with the same command is the user's
- **WHEN** a configuration has a profile with id `my-agy` and the command `agy`, `-i`, `{prompt}`
- **THEN** the loaded profile's command is exactly that

### Requirement: A merged auto-merge pull request ends its session
When the dashboard appends the Ship or Archive auto-merge instruction, or the proposal instruction of a Draft session ("A Draft session in a docs auto-merge project opens its proposal pull request"), to a prompt for a change session — starting the session, sending the action into its running session, or Ship — it SHALL record on that session the time it did so (the latest such time when it happens more than once). The same record is what makes a session eligible for an automatic Merge prompt ("A ready docs-only pull request is handed to its agent to merge"); a Merge prompt SHALL NOT change it. A session without that record SHALL never be ended or have its worktree removed by this requirement.

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

#### Scenario: Proposal pull request merges
- **WHEN** the Draft session of `rotate-keys` on `docs/rotate-keys` was started with the proposal instruction, its agent opened `#90`, and a later refresh shows `#90` merged after that time while docs auto-merge is on
- **THEN** the session's agent is ended, its clean, pushed worktree `docs-rotate-keys` is removed, branch `docs/rotate-keys` still exists locally, and the panel says the session ended because `#90` merged

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
straight on to implementing it; the agent's **Implement** prompt with its additional instructions; a fixed agent-neutral
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

### Requirement: Fast-forward asks for confirmation unless switched off
Before a Fast-forward session is started or its prompt is sent into a running session, the dashboard SHALL ask the user
to confirm, unless the configuration's `agentSessions.confirmFastForward` is `false`; absent means `true`. The
confirmation SHALL name the change, SHALL say that the agent will write the change's artifacts, implement it and open a
pull request without stopping for the user's review, and that the pull request will be the only review, and SHALL offer
**Fast-forward**, **Cancel** and an unticked **Don't show this warning again** checkbox. Cancelling — by the control,
Escape or closing the dialog — SHALL start nothing, send nothing and save nothing, whether or not the checkbox was
ticked. Confirming with the checkbox ticked SHALL save `confirmFastForward: false` before the session is started; when
that save fails, the session SHALL still be started and the dialog's failure to save SHALL be reported where the
starter was activated. With `confirmFastForward` `false`, activating **Fast-forward** SHALL start it directly.

The Agent sessions section of Settings SHALL show a **Warn before fast-forwarding** checkbox reflecting
`confirmFastForward` (ticked when absent), saved with the rest of Settings, so a warning switched off can be turned back
on. A configuration without the field SHALL load unchanged, and a value other than a boolean SHALL be rejected when
saved, leaving the stored configuration unchanged.

#### Scenario: First fast-forward warns
- **WHEN** `confirmFastForward` is absent and the user activates **Fast-forward** on `cache-api-calls`
- **THEN** a dialog asks to confirm fast-forwarding `cache-api-calls`, says the pull request will be the only review, and no session is started until the user confirms

#### Scenario: Cancel starts nothing
- **WHEN** the user ticks **Don't show this warning again** and then cancels
- **THEN** no session is started and `confirmFastForward` is unchanged

#### Scenario: Never show again
- **WHEN** the user ticks **Don't show this warning again** and confirms
- **THEN** the session starts, `confirmFastForward` is saved as `false`, and the next **Fast-forward** starts without a dialog

#### Scenario: Turning the warning back on
- **WHEN** `confirmFastForward` is `false` and the user ticks **Warn before fast-forwarding** in Settings and saves
- **THEN** the next **Fast-forward** asks for confirmation again

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

### Requirement: An agent asked to open a pull request is asked to record its branch
Whenever the dashboard composes text that asks or allows an agent to open a pull request for a change — the Ship
prompt, Fast-forward's prompt through the Ship text it ends with, and the archive auto-merge instruction — it SHALL
include the record instruction the repository's framework module supplies for that change (spec-frameworks: "OpenSpec
changes record their pull request's branch in `.openspec.yaml`"). For a session whose action is archive it SHALL be the
archive branch's instruction; for every other session the implementation branch's. Which one SHALL be decided by the server from the
session record, never from the request or from anything the agent printed.

The instruction SHALL be appended and SHALL NOT replace any part of the prompt: in Ship it SHALL follow the profile's
Ship prompt (or the agent-neutral default) and the Conventional Commits sentence when the project has one, and precede
the profile's additional Ship instructions and the auto-merge instruction; in Fast-forward it SHALL appear once, as part
of the Ship text; with the archive auto-merge instruction it SHALL follow that instruction. A profile with its own Ship
prompt SHALL get it all the same. When the module supplies no record instruction, the text SHALL be exactly what it is
without this requirement.

The dashboard MUST NOT write the record itself, and MUST NOT check, read back or act on anything the agent printed about
it: what the agent recorded is read from the repository by the scan like any other file.

#### Scenario: Ship carries the implementation record instruction
- **WHEN** Ship is used on the implement session of `rotate-keys` in an OpenSpec repository with no title convention and no additional Ship instructions
- **THEN** the submitted text is the Ship prompt followed by the implementation record instruction for `rotate-keys`

#### Scenario: Order with every addition
- **WHEN** Ship is used in a project with Conventional Commits titles, additional Ship instructions and auto-merge included
- **THEN** the text is the Ship prompt, the Conventional Commits sentence, the record instruction, the additional instructions and the auto-merge instruction, in that order

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

### Requirement: A conflicting pull request without a worktree gets a session on its head branch
When Resolve conflicts is used for a change whose GitHub signal holds and no session worktree of the change exists, the
dashboard SHALL start a session for the change in a new worktree **on the linked pull request's head branch**, as an
exception to the branch naming of "Every session works in its own git worktree, created by the dashboard", and with the
resolve-conflicts prompt, including its fixed pull-request sentence, as the opening prompt. The session SHALL be
recorded with the action `archive` when the head branch is the change's archive branch — its recorded archive branch,
else `chore/archive-<name>` — and `implement` otherwise, and
its worktree SHALL be placed where a session of that action is placed. The head branch, the pull request's number, its
base and whether it comes from a fork SHALL be taken from the server's own cached list through the shared
link rule, never from the request, and the head branch SHALL be validated as a branch name before any git command.

The worktree SHALL be made with the session worktree commands already enumerated, decided read-only first so that a
refusal creates nothing:

- when a local branch of that name exists, it SHALL be checked out in the new worktree as it is, whether it is level
  with, behind or diverged from `origin/<head branch>`;
- otherwise, when the remote-tracking branch `origin/<head branch>` exists, the branch SHALL be created from it with
  that remote-tracking branch as its upstream;
- when the branch is checked out in a linked worktree in which no session runs, that worktree SHALL be adopted as the
  existing adoption rule specifies.

The dashboard MUST NOT contact a remote for this. The request SHALL be refused with the reason, and nothing created,
when the pull request comes from a fork, or the cached list does not say that it does not, with a one-line reason; when the head
branch is the default branch; when it is checked out in the main checkout; when neither a local branch nor
`origin/<head branch>` exists, saying to fetch or pull first; when agent sessions are disabled or the repository is
excluded from them; and for a repository whose sessions run in place.

#### Scenario: Worktree gone, branch only on the remote
- **WHEN** change `rotate-keys` has no session worktree, no local branch `feat/rotate-keys`, `origin/feat/rotate-keys`
  exists locally, and its linked open pull request `#88` from `feat/rotate-keys` into `main` is cached as `conflicting`
- **THEN** a session starts in a new worktree on a new branch `feat/rotate-keys` created from `origin/feat/rotate-keys`
  with it as upstream, its opening prompt names `#88`, `feat/rotate-keys` and `main`, and no `feat/` branch of another
  name is created

#### Scenario: A pull request recorded on an off-convention branch
- **WHEN** the change `rotate-keys` recorded `fix/rotate-keys` as its branch in its metadata, the pull request `#91`
  from that branch is cached as `conflicting`, and no worktree exists
- **THEN** the session's worktree is on `fix/rotate-keys`, not on `feat/rotate-keys`

#### Scenario: A local branch behind the remote
- **WHEN** a local branch `feat/rotate-keys` exists two commits behind `origin/feat/rotate-keys` and no worktree has it
  checked out
- **THEN** the new worktree checks out the local branch as it is, and the prompt asks the agent to bring it level with
  `origin/feat/rotate-keys` first

#### Scenario: A pull request from a fork
- **WHEN** the conflicting pull request comes from a fork
- **THEN** the request is refused with the one-line reason that its branch is in a fork, and no worktree or branch is
  created

#### Scenario: Branch not known locally
- **WHEN** neither `feat/rotate-keys` nor `origin/feat/rotate-keys` exists in the repository
- **THEN** the request is refused saying to fetch or pull first, and no fetch, worktree or branch is made

#### Scenario: Head branch in the main checkout
- **WHEN** the pull request's head branch is the branch the main checkout is on
- **THEN** the request is refused, and the main checkout's branch, index and working tree are unchanged

#### Scenario: The request cannot choose the branch
- **WHEN** `POST /api/sessions` with `resolveConflicts: true` also carries a branch or a pull-request number
- **THEN** those fields are ignored and the branch comes from the cached list

### Requirement: The end-session dialog is short
The dialog that confirms ending or cleaning up a change session SHALL open with a headline naming what it does and the
change — **End session** for a running session, **Clean up** for one that has ended — followed by at most one line
saying that the options below tidy up after the session and can be chosen. Each option it offers (removing the
worktree, cleaning up a stale change's leftovers, pulling the repository) SHALL be a checkbox whose visible label is a
short phrase of a few words, such as *Remove worktree*, *Clean up leftovers* or *Pull `<repo>`*; what the option does
and why SHALL be its hover description, available to pointer and assistive technology alike, and SHALL NOT be repeated
as visible text. Every option the dialog offers SHALL be selected when the dialog opens.

Only what changes the user's decision SHALL be shown as visible text beside the options, each in one line: the warning
that the worktree holds unshipped work, the reason a worktree cannot be removed, the stale leftovers that would be
removed with the paths outside the change among their uncommitted files, and the leftovers kept with their reasons.
The dialog SHALL NOT show explanatory paragraphs about how ending stops the agent, which branch is kept, or how
backups are made; those MAY be hover descriptions. The reports the dialog turns into after a pull or a cleanup that
needs saying SHALL state the outcome and that the session has ended, without further explanatory sentences.

This requirement changes only what the dialog shows. What confirming, clearing an option or cancelling does SHALL stay
as the other requirements of this capability specify.

#### Scenario: Ending a session with a removable worktree
- **WHEN** the user ends a running session whose worktree is clean and merged, in a tracked git repository
- **THEN** the dialog shows the headline **End session** with the change's name, one line of explanation, and two
  checkboxes labelled *Remove worktree* and *Pull* with the repository's name, both selected, and no further prose

#### Scenario: Hover explains an option
- **WHEN** the user hovers over the *Pull* option
- **THEN** a description says that it fetches the repository's remote and fast-forwards its main checkout, and never
  merges, rebases, stashes or switches branches

#### Scenario: Unshipped work is still visible
- **WHEN** the user ends a session whose worktree has commits that exist only on its branch
- **THEN** the dialog shows the unshipped-work warning and why the worktree is kept, each in one line, and the pull
  option selected

#### Scenario: Cleaning up an ended session
- **WHEN** the user clicks **Clean up** on a session that has already ended
- **THEN** the dialog's headline is **Clean up** with the change's name

### Requirement: Ending a session cleans up a stale change's leftovers
When the user ends or cleans up a change session that has a worktree, and the change is archived on the default branch
as locally known and the session's worktree would be a stale leftover of it once the session has ended (`stale-changes`
capability: "A change that is archived and merged is stale"), the end-session dialog SHALL offer **Clean up leftovers**
in place of the plain worktree removal. It SHALL list the session's worktree and every other stale leftover of the
change, read afresh, with each worktree's uncommitted and untracked paths, and SHALL list the kept leftovers with their
reasons. The note that uncommitted files are copied first and ignored files are deleted without a copy SHALL be the
option's hover description.

The offer SHALL be pre-selected whenever it is made. When any listed uncommitted path lies outside
`openspec/changes/<name>/` and the change's archive directory, those paths SHALL be named in one line with the offer;
confirming with the offer selected is the user's acknowledgement that those files are deleted after a copy is kept. A
choice made in an earlier dialog SHALL NOT carry over.

Confirming with the offer selected SHALL, in this order:
1. end the session;
2. run the stale cleanup for the listed items, with the same server-side re-checks, backups and per-item outcomes as
   **Clean up leftovers…** on the board;
3. run the pull when the pull offer is selected.

So one confirmation ends the session and cleans up. The dialog SHALL report each item's outcome and the backup folder
under the rules for reporting a pull. Confirming with the offer cleared SHALL end the session and keep every leftover,
which stay marked stale on the board. Cancelling SHALL end, remove and pull nothing.

When the change is not stale at that moment — its archive is not on the default branch yet, for example because the
archive's pull request is still open, or its branch holds work the default branch lacks — the dialog SHALL keep the
plain removal offer and its rules. When that removal is not possible, the dialog SHALL say that the worktree is kept and
will be marked stale, with **Clean up leftovers…** on the board, once the change is archived and merged on the default
branch. An in-place session SHALL never get the offer.

#### Scenario: Ending the archive session after the merge
- **WHEN** the user ends the archive session of `rotate-keys`, whose archive is on `origin/main`, whose worktree on
  `chore/archive-rotate-keys` is merged and shows `openspec/changes/rotate-keys/tasks.md` deleted but uncommitted, and
  the merged implementation worktree on `feat/rotate-keys` is still there
- **THEN** the dialog offers Clean up leftovers, already selected, listing both worktrees and that file, and one
  confirmation ends the session, copies the file under `~/.spec-control/branch-backups/` and removes both worktrees
  and their branches

#### Scenario: A source file outside the change
- **WHEN** the session's merged worktree also holds an uncommitted edit to `src/keys.ts`
- **THEN** Clean up leftovers is offered and already selected, `src/keys.ts` is named with it, and confirming copies
  `src/keys.ts` under `~/.spec-control/branch-backups/` before the worktree is removed

#### Scenario: Leftovers kept by clearing the offer
- **WHEN** the user clears Clean up leftovers and confirms
- **THEN** the session ends and every leftover is kept and stays marked stale on the board

#### Scenario: Pull request still open
- **WHEN** the user ends the archive session while its pull request is open and the archive is not on `origin/main`,
  and the worktree has an uncommitted file
- **THEN** no cleanup is offered, the worktree is kept, and the dialog says it will be marked stale once the archive
  is merged into the default branch

#### Scenario: A changed item after the dialog
- **WHEN** another worktree listed in the offer receives a new commit before the user confirms
- **THEN** the session ends, that worktree is kept and reported as changed since the user looked, and the session's own
  worktree is still cleaned up

### Requirement: A Draft session in a docs auto-merge project opens its proposal pull request
When a **Draft artifacts** session works on `docs/<change>` and the repository has docs auto-merge switched on, the dashboard SHALL append a fixed **proposal instruction** to the Draft prompt — after the profile's Draft prompt and its additional Draft instructions, separated by one space — when it starts the session and when Draft is sent into that same running session. The instruction SHALL ask the agent, once every artifact of the change is written, to commit them on the session's branch, push it and open a pull request against the default branch titled `docs(openspec): add <change>` when the project declares Conventional Commits pull request titles and `Add OpenSpec proposal <change>` otherwise, containing only files under `openspec/`; not to merge it and not to enable auto-merge on it, because Spec Control asks for the merge once it is ready; and not to start implementing the change. `<change>` SHALL be the validated change name and nothing in the instruction SHALL come from the request.

The instruction SHALL be appended only when read-only git, in the session's worktree at that moment, proves the worktree holds nothing outside `openspec/` under the check Ship makes, with an empty worktree counting as holding nothing outside; a git command that fails counts as not holding. It SHALL NOT be appended to a Draft session on `feat/<change>`, to a session in place, to a Fast-forward session, or to any other action, and sending Draft into a running session on another branch SHALL NOT carry it. The start or send result SHALL state whether it was included. Appending it SHALL set the session's auto-merge record exactly as the Ship and Archive auto-merge instructions do, so that "A ready docs-only pull request is handed to its agent to merge" and "A merged auto-merge pull request ends its session" apply to the proposal pull request unchanged.

The dashboard itself MUST NOT commit, push, open or merge anything for this, and MUST NOT run any git command beyond the read-only check above and the worktree commands of any session.

#### Scenario: Draft opens the proposal pull request
- **WHEN** `demo-ops` declares Conventional Commits titles, has docs auto-merge on, and the user starts **Draft artifacts** for `rotate-keys`
- **THEN** the opening prompt is the profile's Draft prompt with its additional Draft instructions, followed by the proposal instruction naming `docs(openspec): add rotate-keys`, the session carries the auto-merge record, and the start result states that the instruction was included

#### Scenario: Without a title convention
- **WHEN** the same project declares no title convention
- **THEN** the proposal instruction asks for the title `Add OpenSpec proposal rotate-keys`

#### Scenario: The worktree holds code
- **WHEN** the `docs-rotate-keys` worktree, reused from an earlier session, holds an uncommitted `src/app.ts`, and Draft is started for `rotate-keys`
- **THEN** the proposal instruction is not appended, the session carries no auto-merge record, and the result states that it was not included

#### Scenario: Without docs auto-merge
- **WHEN** `demo-ops` has docs auto-merge off and the user starts **Draft artifacts**
- **THEN** no proposal instruction is appended and the session works on `feat/rotate-keys`

#### Scenario: Draft sent into an Implement session
- **WHEN** Draft is sent into the running Implement session of `rotate-keys` on `feat/rotate-keys`
- **THEN** the prompt carries no proposal instruction

#### Scenario: Fast-forward is unchanged
- **WHEN** the user starts **Fast-forward** for `rotate-keys` in a project with docs auto-merge on
- **THEN** the session works on `feat/rotate-keys`, its prompt carries no proposal instruction, and it never carries the auto-merge record

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

### Requirement: A profile's launch arguments are added to every start of its agent
An agent profile MAY carry **launch arguments**: an argument list the user adds to the agent's command line, for
options such as a mode or a model. Whenever the dashboard starts that profile's agent it SHALL put the launch arguments,
in order and each as one whole argument, directly after the executable — the first argument of the command, or of the
resume command — and before every other argument. This SHALL hold for every start: with an opening prompt, whether
the prompt is an argument or typed after start-up; without one, for a main console or a project console; and with the
resume command, for **Resume** and for Ship or Resolve conflicts on an ended session. A session that is running SHALL
keep the arguments it was started with; edited launch arguments take effect at that agent's next start.

Each launch argument SHALL be non-empty and SHALL contain no placeholder (no `{` … `}` text, `{prompt}` included) and
no control character, and none SHALL carry a permission-bypass mode or flag — the rule that applies to the rest of the
profile. A configuration that breaks these rules SHALL be refused when it is saved, with a message naming the field,
leaving the stored configuration unchanged. An empty list SHALL be stored as no launch arguments. No preset SHALL carry
launch arguments, and launch arguments SHALL play no part in reading a former preset command as the current one: a
preset profile whose command is a former one gets the current command and keeps its launch arguments.

The Agent sessions settings SHALL show a **Launch arguments** field in each agent's Command group, one argument per
line, saying that the arguments are added after the executable each time the agent starts, resumes included.

#### Scenario: Launch arguments with a prompt argument
- **WHEN** the Antigravity profile has the launch arguments `--mode`, `auto` and the user starts **Implement** on change
  `cache-api-calls` with it
- **THEN** the agent is started with the arguments `agy`, `--mode`, `auto` and one argument `--prompt-interactive=`
  followed by a prompt that names `cache-api-calls`

#### Scenario: Launch arguments with a typed prompt
- **WHEN** a profile has the command `my-agent-cli` only, the launch arguments `--model`, `fast`, and a session is opened
  with it
- **THEN** the agent is started as `my-agent-cli`, `--model`, `fast` and the prompt is typed into the terminal after
  start-up

#### Scenario: Launch arguments without a prompt
- **WHEN** the Antigravity profile has the launch arguments `--mode`, `auto` and is the agent of a main console or a
  project console
- **THEN** the agent is started as `agy`, `--mode`, `auto`, with no option left over that expects a value

#### Scenario: Launch arguments on resume
- **WHEN** an ended session's agent has the resume command `agy`, `--continue` and the launch arguments `--mode`, `auto`,
  and the user presses **Resume**, or uses Ship or Resolve conflicts on that session
- **THEN** the agent is started as `agy`, `--mode`, `auto`, `--continue`

#### Scenario: A running session keeps its arguments
- **WHEN** a session of a profile is running and the user adds the launch argument `--verbose` to that profile and saves
- **THEN** the running agent is not restarted, and the next session or resume of that profile starts with `--verbose`

#### Scenario: A placeholder is refused
- **WHEN** the user saves a profile with the launch argument `--prompt={prompt}`
- **THEN** saving is refused with a message naming the launch arguments, and the stored configuration is unchanged

#### Scenario: Permission bypass is refused in launch arguments
- **WHEN** the user saves a profile with the launch argument `--dangerously-skip-permissions`
- **THEN** saving is refused with a message naming the launch arguments, and the stored configuration is unchanged

#### Scenario: Empty launch arguments are not stored
- **WHEN** the user clears a profile's Launch arguments field in Settings and saves
- **THEN** the saved profile carries no launch arguments, and its agent starts exactly as its command says

#### Scenario: A preset command upgrades with launch arguments
- **WHEN** a configuration whose `agy` profile has the command `agy`, `-i`, `{prompt}` and the launch arguments `--mode`,
  `auto` is loaded
- **THEN** the loaded profile's command is `agy`, `--prompt-interactive={prompt}` and its launch arguments are still
  `--mode`, `auto`

#### Scenario: A profile without launch arguments starts as before
- **WHEN** a configuration saved before launch arguments existed is loaded and its agents are started
- **THEN** every agent is started with exactly the arguments it was started with before

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

### Requirement: The end-session dialog stays until its confirmation has finished
While the end-session dialog carries out a confirmation — ending the session, removing its worktree, cleaning up
leftovers or pulling — Escape SHALL do nothing and **Cancel** SHALL be disabled, so that the dialog cannot be closed
while work it started is still running and its report is never lost. Escape SHALL close only the end-session dialog,
never a view behind it such as the change detail view. A confirmation SHALL report only into the dialog of the session
it was started for: when that dialog is no longer the open one, its outcome SHALL NOT change, report into or close the
dialog now open for another session.

#### Scenario: Escape while the end runs
- **WHEN** the user confirms ending a session with **Pull** selected and presses Escape while the pull runs
- **THEN** the dialog stays open, and when the pull is refused over change leftovers it shows that report with
  **Resolve and pull**

#### Scenario: Cancel while busy
- **WHEN** a confirmation is in progress
- **THEN** Cancel is disabled and nothing closes the dialog until the confirmation has finished

#### Scenario: Escape over the change detail view
- **WHEN** the end-session dialog is open over the change detail view of `rotate-keys` and the user presses Escape
  before confirming
- **THEN** the dialog closes, nothing is ended, and the change detail view stays open

#### Scenario: Another session's dialog
- **WHEN** a confirmation for the session of `rotate-keys` is still running and the end-session dialog of the session of
  `add-login` is opened
- **THEN** the outcome of the `rotate-keys` confirmation neither appears in nor closes the `add-login` dialog

### Requirement: A session panel action is sent once per activation
While one of the session panel's header actions — **Ship**, **Resolve conflicts**, **Merge**, **Resume** or **Delete
record** — is in flight, all of them SHALL be disabled, and a further activation SHALL send no request, so that a
double-click sends one request. The panel SHALL enable them again once the request has finished, whether it succeeded
or failed. This is independent of the server refusing a second concurrent start of the same session.

#### Scenario: Double-click on Ship
- **WHEN** the user double-clicks **Ship** on an ended session of `rotate-keys`
- **THEN** one Ship request is sent and one agent is started in its worktree

#### Scenario: Failed request
- **WHEN** a Resume request fails
- **THEN** the panel shows the error and its actions are enabled again
