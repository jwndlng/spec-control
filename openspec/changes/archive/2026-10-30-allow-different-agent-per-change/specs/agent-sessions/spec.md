# Spec Delta

## ADDED Requirements

### Requirement: A change may use an agent other than its project's
A change MAY carry an **agent override**: the id of one configured agent profile. **The change's agent** SHALL be the
profile its override names, else the profile its repository selected, else the default agent. The override SHALL be
kept in the dashboard's own configuration under its repository, keyed by the change name after it passed change-name
validation, and MUST NOT be written into, or read from, the repository. Setting or clearing it SHALL NOT trigger a scan,
start, end or restart any process, or send anything to a terminal.

Wherever the dashboard decides something for a change session by its agent, it SHALL use the change's agent: which
starters are available (each only when the change's agent has an opening prompt for it), the opening prompt and its
additional instructions, the launch arguments, the environment variables removed, the check that the executable is
found, and the agent started by Ship, Resolve conflicts or any other action that starts a new agent for the change. A
session SHALL record the profile it was started with; Resume, and Ship or Resolve conflicts handed to an ended
session, SHALL keep using that recorded profile, and a prompt sent into a running session SHALL come from that
session's own profile. A running session SHALL NOT be ended, restarted or sent anything because the change's override
was set, changed or cleared: the change's agent applies to the next session started for the change.

The override SHALL apply only to sessions of that change. The main console, a project console and Integrate are not
change sessions and SHALL keep their own agent choice. An override for a name that is not an active change of its
repository SHALL have no effect on anything; such overrides SHALL be removed when an override is next set in that
repository.

#### Scenario: One change on another agent
- **WHEN** `demo-ops` uses the default agent `claude`, the profile `codex` has an Implement prompt, and change
  `rotate-keys` has the override `codex`
- **THEN** Implement on `rotate-keys` starts `codex`, and Implement on any other `demo-ops` change starts `claude`

#### Scenario: Starters follow the change's agent
- **WHEN** change `rotate-keys` in `Done` has the override `my-agent`, whose profile has no Archive prompt, while the
  project's agent has one
- **THEN** Archive is not offered for `rotate-keys` and a request to start it is refused, and Archive stays available
  for the project's other changes in `Done`

#### Scenario: The override's agent is not installed
- **WHEN** change `rotate-keys` has the override `codex` and `codex` cannot be found on this machine
- **THEN** the change's starters are disabled saying that Codex was not found, and opening a session for it is
  refused with that reason, while the project's other changes are unaffected

#### Scenario: A running session keeps its agent
- **WHEN** a `claude` session of `rotate-keys` is running and the user sets the change's override to `codex`
- **THEN** the running session is not ended or sent anything, the next step sent into it uses the `claude` profile's
  prompt, and the next session started for `rotate-keys` after that session ended starts `codex`

#### Scenario: Resume uses the session's own agent
- **WHEN** an ended `claude` session of `rotate-keys` is resumed after the change's override was set to `codex`
- **THEN** the `claude` profile's resume command is started

#### Scenario: Consoles ignore change overrides
- **WHEN** change `rotate-keys` of `demo-ops` has the override `codex` and the user opens the `demo-ops` project console
- **THEN** the project console starts the project's agent

#### Scenario: Nothing in the repository
- **WHEN** the user sets and clears the override of `rotate-keys`
- **THEN** no file in the repository changes, no git command runs and no scan is triggered

## MODIFIED Requirements

### Requirement: An agent is a configurable profile, not a built-in integration
The dashboard SHALL start agents from user-configurable profiles. A profile consists of an id, a display name, a command given as an argument list, an opening prompt per session starter, optional additional instructions per prompt, an optional resume command and an optional list of environment variables to remove. The dashboard MUST NOT depend on any vendor-specific protocol or output format of an agent: any program that runs interactively in a terminal SHALL be usable. One profile is the default; a repository MAY select a different one with its agent picker on the projects overview, and a change MAY select a different one again ("A change may use an agent other than its project's"). Removing a profile in Settings SHALL return every repository that selected it, and the main console when it selected it, to the default agent, and SHALL remove every change override that named it, so those changes use their repository's agent. The dashboard SHALL ship **presets** — ready-made profiles — for Claude Code (`claude`), Codex (`codex`) and Antigravity (`agy`). A preset SHALL be an ordinary profile with nothing a user-written profile could not express, and once added it SHALL be edited, made the default or removed like any other profile. Only the Claude Code preset SHALL be configured by default; another preset SHALL become a profile only when the user adds it in Settings, never because its executable was found on this machine. No preset SHALL carry additional instructions for any of its prompts, and no preset's command, resume command or prompt SHALL contain a permission-bypass mode or flag. The dashboard MUST NOT read, store, log or transmit an agent's credentials and MUST NOT offer a login flow; an agent uses its own login and its own settings.

#### Scenario: A second agent
- **WHEN** the user adds a profile with command `my-agent-cli`, `{prompt}` and an Implement prompt, and selects it for repository `demo-ops` on the projects overview
- **THEN** Implement on a `demo-ops` card starts `my-agent-cli` and other repositories keep using the default agent

#### Scenario: Removing a selected profile
- **WHEN** `demo-ops` uses the profile `my-agent` and the user removes `my-agent` in Settings and saves
- **THEN** `demo-ops` uses the default agent and the configuration is saved without an "unknown agent" error

#### Scenario: Removing a change's profile
- **WHEN** change `rotate-keys` of `demo-ops` has the override `my-agent` and the user removes `my-agent` in Settings and saves
- **THEN** the configuration is saved without an "unknown agent" error, carries no override for `rotate-keys`, and the next session of `rotate-keys` starts the agent of `demo-ops`

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

