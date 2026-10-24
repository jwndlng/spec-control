## ADDED Requirements

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
