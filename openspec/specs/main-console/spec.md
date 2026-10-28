# main-console Specification

## Purpose
Defines the main console: one agent session that belongs to no repository and no change, opened from the top bar so
the user can talk to their agent for anything that is not a change's starter — when it is offered, what it runs and
where, how long it lives, and what it shares with and withholds from change sessions.

## Requirements

### Requirement: The main console is offered from the top bar while agent sessions are enabled
While the global agent sessions setting is enabled, the top bar SHALL show a main console control next to the theme
control on every route. The control SHALL be an icon button with a visible or accessible name that says it opens the
console; it MUST NOT rely on the icon alone for its name. Activating it SHALL open the console overlay. While agent
sessions are disabled, the control MUST NOT be shown and the console MUST NOT be startable by any means. The console
MUST NOT depend on any repository being tracked, enabled for agent sessions or successfully scanned.

#### Scenario: Sessions enabled
- **WHEN** agent sessions are enabled and the user is on the projects overview, a board or settings
- **THEN** the top bar shows the main console control next to the theme control

#### Scenario: Sessions disabled
- **WHEN** agent sessions are disabled
- **THEN** the top bar shows no main console control and no console process can be started

#### Scenario: No repository tracked
- **WHEN** agent sessions are enabled and no repository is tracked
- **THEN** the main console control is shown and the console can be started

#### Scenario: Accessible name
- **WHEN** assistive technology reads the top bar
- **THEN** the main console control is announced with a name that says it opens the console, and, while the console
  runs, which of the two running states it is in

### Requirement: The console runs the console agent without a prompt
The console SHALL run the **console agent**: the agent profile chosen for the console in the agent sessions settings,
or the default agent when none is chosen. It SHALL be started without a shell, from the profile's command argument
list with every argument that contains `{prompt}` left out. No text SHALL be typed into it on start-up; the user writes
the first instruction. The agent's environment SHALL be prepared exactly as for any session, including the profile's
removed environment variables. When the console agent's executable cannot be found, opening the console SHALL be
refused with that reason, which names that agent, and the overlay SHALL show it. A running console SHALL keep the agent
it was started with when the choice changes; the choice applies to the next console started. Resuming an ended console
SHALL use the agent that console was started with.

#### Scenario: Preconfigured agent
- **WHEN** no console agent is chosen, the default agent is the preconfigured profile with command `claude`, `{prompt}`
  and the user opens the console
- **THEN** the agent is started with the argument list `claude` alone, and nothing is typed into its terminal

#### Scenario: Prompt embedded in an argument
- **WHEN** the console agent's command is `my-agent-cli`, `--task={prompt}`, `--color`
- **THEN** the console starts `my-agent-cli`, `--color`

#### Scenario: A console agent other than the default
- **WHEN** the default agent is the Claude Code profile, the Antigravity preset has been added, the user chose it as the
  console agent and opens the console
- **THEN** `agy` is started alone in the console folder, and change sessions of projects without an agent of their own
  still start `claude`

#### Scenario: Agent not installed
- **WHEN** the console agent's executable cannot be found and the user opens the console
- **THEN** no process is started and the overlay says that this agent was not found

#### Scenario: Choice changed while the console runs
- **WHEN** the console runs the default agent and the user chooses another profile as the console agent and saves
- **THEN** the running console is unaffected and keeps its agent, and the next console started after it ends runs the
  chosen profile

### Requirement: The console agent is chosen in the agent sessions settings
The agent sessions settings SHALL offer, in their Console group next to the console folder, a choice of the console
agent: "default agent" or any configured profile. The choice SHALL be shown only while at least two profiles are
configured, and SHALL be saved with the rest of the settings. "Default agent" SHALL be stored as no choice, so the
console follows the default agent when the default changes. A choice that names no configured profile SHALL be
refused when saving, with a reason, and SHALL leave the saved configuration unchanged. Removing the chosen profile in
the settings SHALL reset the choice to the default agent before saving.

#### Scenario: Only one profile
- **WHEN** only the Claude Code profile is configured
- **THEN** the Console group shows no agent choice, and the console runs that profile

#### Scenario: Following the default
- **WHEN** no console agent is chosen and the user makes the Codex preset the default agent and saves
- **THEN** the next console started runs `codex`

#### Scenario: Removing the chosen profile
- **WHEN** the console agent is `my-agent` and the user removes `my-agent` in the settings and saves
- **THEN** the saved configuration has no console agent and the next console runs the default agent

### Requirement: The console runs in the console folder, never in a repository
The console's working directory SHALL be the console folder. By default this SHALL be the folder `console` under the
dashboard's home directory (`~/.spec-control/console/`), which the dashboard SHALL create when it does not exist.
The user MAY set another console folder in the agent sessions settings. A configured console folder SHALL be an
absolute path to an existing directory, and MUST NOT be a tracked repository's folder or lie inside one; a folder that
contains tracked repositories is allowed. Saving an invalid console folder SHALL be refused with a reason and leave the
saved configuration unchanged; clearing the setting SHALL return to the default. When a saved console folder has since
become invalid, opening the console SHALL be refused with the reason, and no fallback folder SHALL be used. For the
console, no worktree SHALL be created, no branch made and no git command run.

#### Scenario: Default folder
- **WHEN** no console folder is configured and the user opens the console for the first time
- **THEN** `~/.spec-control/console/` is created and the agent's working directory is that folder

#### Scenario: Workspace root
- **WHEN** the user sets the console folder to `/w/acme`, which contains the tracked repositories `/w/acme/demo-ops`
  and `/w/acme/alpha-infra`, and saves
- **THEN** the setting is saved and the next console starts in `/w/acme`

#### Scenario: Folder inside a tracked repository
- **WHEN** the user sets the console folder to `/w/acme/demo-ops/tools` while `/w/acme/demo-ops` is tracked
- **THEN** saving is refused with a reason that names the repository, and the configuration is unchanged

#### Scenario: Relative or missing folder
- **WHEN** the user sets the console folder to `acme` or to an absolute path that does not exist
- **THEN** saving is refused with a reason and the configuration is unchanged

#### Scenario: Folder removed after saving
- **WHEN** the configured console folder has been deleted and the user opens the console
- **THEN** opening is refused with a reason saying the folder does not exist, and no agent is started

#### Scenario: No git
- **WHEN** the console is opened, resumed and ended
- **THEN** no git command is run and no worktree or branch is created or removed

### Requirement: One console at a time
At most one console session SHALL be running. Opening the console while one runs SHALL attach to it and MUST NOT start a
second process. Closing the overlay MUST NOT end the console. **End session** SHALL end the console's agent as ending
any session does, and ending it SHALL do nothing else. When the console's most recent session has ended, the overlay
SHALL show its stored terminal output with **Resume** — when the default agent has a resume command, which is then
started in that session's folder within the same session — and a control that starts a new console. A console session
running at the same time as any number of change sessions is allowed.

#### Scenario: Reopening a running console
- **WHEN** the console is running, the user closes the overlay and activates the top-bar control again
- **THEN** the overlay shows the same terminal with its earlier output and no second process is started

#### Scenario: Two tabs
- **WHEN** the console is opened in two browser tabs
- **THEN** both show the same running console and one agent process exists

#### Scenario: Ending the console
- **WHEN** the user ends the console
- **THEN** its agent is ended, and no worktree removal, pull offer or other follow-up is offered

#### Scenario: Resume
- **WHEN** the console has ended and the default agent has the resume command `claude`, `--continue`, and the user
  presses Resume
- **THEN** that command is started in the ended session's folder and the console is running again

#### Scenario: A new console after the previous one ended
- **WHEN** the console has ended and the user starts a new console
- **THEN** a new session starts in the current console folder and the ended one stays in the session records

#### Scenario: Next to change sessions
- **WHEN** three change sessions are running and the user opens the console
- **THEN** the console starts and the change sessions are unaffected

### Requirement: The console overlay holds the console and nothing change-related
The console SHALL be shown in an overlay in the same frame as a change's detail view: a header that names the agent, the
console folder and the session's status badge; the terminal; the default responses while the session runs and its
terminal is connected; and End session, Resume and deleting the record of an ended session. It MUST NOT offer Ship,
work status, next-step prompts, session starters, worktree removal or a pull. The overlay SHALL close on its close
control, on the backdrop and on `Escape` — except that `Escape` pressed while keyboard focus is in the terminal SHALL go
to the agent. While the overlay is open, the page behind it SHALL take no focus and no clicks. Opening and closing the
overlay SHALL not change the current route.

#### Scenario: Escape in the terminal
- **WHEN** the console overlay is open, keyboard focus is in its terminal and the user presses `Escape`
- **THEN** the agent receives the key and the overlay stays open

#### Scenario: Escape elsewhere
- **WHEN** focus is on the overlay's header and the user presses `Escape`
- **THEN** the overlay closes and the console keeps running

#### Scenario: Nothing change-related
- **WHEN** the console overlay of a running console is open
- **THEN** it shows the default responses and End session, and no Ship, work status, next-step or pull control

#### Scenario: Route is kept
- **WHEN** the user opens and closes the console overlay on a repository's board
- **THEN** the same board is shown with its filters as before

### Requirement: The top-bar control shows the console's state
While the console runs, the top-bar control SHALL show which of the two running states the console session is in —
producing output, or possibly needing the user with the length of the silence — decided exactly as for every other
session badge, in words available as its tooltip and accessible name, and not by colour or motion alone. While no
console runs, the control SHALL show no state.

#### Scenario: Console waiting
- **WHEN** the console's terminal has printed nothing for longer than the silence threshold
- **THEN** the control's tooltip and accessible name say the console may need the user and for how long it has been
  silent

#### Scenario: No console
- **WHEN** no console session is running
- **THEN** the control shows no running indicator

### Requirement: Console sessions are session records without a repository
A console session SHALL be stored, retained, listed and attached like every other session: its record lives under
`~/.spec-control/sessions/`, it counts towards the newest 50 ended sessions kept, its terminal is served over the
same WebSocket under the same guard, text sent on the user's behalf follows the same echo rule, and stopping the
dashboard ends it. It SHALL be marked as a console session and SHALL carry no repository, change, action or branch. It
MUST NOT be listed or counted in the Open work list, MUST NOT appear on any card or in any change's detail view, and
MUST NOT be written to the activity log. Every request that only applies to a change session — Ship, a next-step prompt,
worktree status and worktree removal — SHALL be refused for a console session.

#### Scenario: Open work
- **WHEN** the console and two change sessions are running
- **THEN** the Open work control counts and lists the two change sessions only

#### Scenario: Activity
- **WHEN** a console is started and ended
- **THEN** no entry about it appears in the activity feed

#### Scenario: Ship refused
- **WHEN** Ship is requested for a console session
- **THEN** the request is refused and nothing is typed into its terminal

#### Scenario: Dashboard stopped
- **WHEN** the dashboard receives a termination signal while the console runs
- **THEN** the console's agent is ended and the session is recorded as ended because the dashboard was stopped

### Requirement: The console never shares its folder with another agent
Opening the console, and resuming an ended console, SHALL be refused with a reason naming the other session while any session that is not the console runs with the console folder as its working directory, or while an integration session runs in a folder that is the console folder or contains it — once that integration succeeds, the console folder would lie inside a tracked repository. Paths SHALL be compared as canonical paths. No agent SHALL be started for a refused request.

#### Scenario: Integration in the console folder
- **WHEN** the console folder is `/w/acme/gamma-tools`, an untracked git repository, and an integration session runs there
- **THEN** opening the console is refused with a reason naming the integration, and no console agent is started

#### Scenario: Integration of a folder holding the console folder
- **WHEN** the console folder is `/w/acme/gamma-tools/notes` and an integration session runs in `/w/acme/gamma-tools`
- **THEN** opening the console is refused, and no console agent is started
