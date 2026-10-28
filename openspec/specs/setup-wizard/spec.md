# setup-wizard Specification

## Purpose
Defines the setup wizard: a short, skippable dialog that walks a user through the first start of a fresh installation —
workspace roots, the agent to use and the tools the dashboard relies on — and says how to fix whatever is missing.

## Requirements

### Requirement: The wizard opens by itself once per installation
The dashboard SHALL open the setup wizard by itself when the loaded configuration has `setup: "pending"`, once the
configuration has loaded, on whatever route was opened. It SHALL NOT open by itself while the change detail view, the
main console, an integration terminal or the onboarding tour is open; it SHALL then open once none of them is. It
SHALL open by itself at most once per page load. Whether it opens SHALL depend only on the server's configuration, never
on browser storage, so that every browser and the desktop app see the same state. A configuration without `setup`
SHALL never open the wizard by itself.

#### Scenario: First start
- **WHEN** the dashboard is started for the first time, so a fresh configuration with `setup: "pending"` was created, and the user opens it
- **THEN** the setup wizard opens at its first step

#### Scenario: Upgrading from an earlier version
- **WHEN** the dashboard starts with a configuration written by an earlier version, without a `setup` key
- **THEN** the setup wizard does not open by itself

#### Scenario: A second browser after setup
- **WHEN** the user finished the wizard in one browser and then opens the dashboard in another browser
- **THEN** the setup wizard does not open

#### Scenario: A deep link to a change
- **WHEN** setup is pending and the user opens a link to a change's detail view
- **THEN** the wizard opens only once the detail view is closed

### Requirement: The wizard has seven steps in a fixed order
The wizard SHALL be a modal dialog with the steps **Welcome**, **System check**, **Workspace**, **Agents**, **Console**,
**Project settings** and **Done**, in this order, so that the tools the later steps rely on are checked before any of
them is used, showing the current step's position as "n of 7" and the
names of all steps. Every step before the current one SHALL be marked as done, in green with a check mark beside its
name, and SHALL be announced as done to assistive technology; the current step SHALL be marked as current, and the
steps after it SHALL show neither. The step list SHALL also be a way to move: every step up to the furthest one reached
SHALL be activatable from it, while a step not reached yet SHALL NOT be. Activating an earlier step SHALL act as
**Back**, keeping what was entered and saving nothing; activating a later step already reached SHALL first save the
current step exactly as its **Continue** would, and SHALL stay on the current step, showing the error, when that save
fails. While a step saves, the list SHALL NOT be activatable. Every step except Welcome SHALL offer **Back**; every step except Done SHALL offer **Continue** and
**Skip setup**. While the wizard is open the page behind it SHALL NOT receive clicks or keyboard focus, and it SHALL be
exposed to assistive technology as a dialog named as the setup. Pressing Escape SHALL act as **Skip setup**, after a
confirmation when the user has entered something the wizard has not saved yet. While a native folder picker opened by
the Workspace step is open, Escape in the page SHALL NOT end setup, and while a setting's help overlay is open, Escape
SHALL close that overlay and SHALL NOT end setup. The wizard SHALL work at a viewport width of 400px
without horizontal scrolling.

#### Scenario: Position shown
- **WHEN** the wizard shows the Console step
- **THEN** it reads "5 of 7" and lists Welcome, System check, Workspace, Agents, Console, Project settings and Done with Console marked current

#### Scenario: Steps passed are done
- **WHEN** the user continues from the Agents step to the Console step
- **THEN** Welcome, System check, Workspace and Agents are shown green with a check mark and announced as done, Console is marked current, and Project settings and Done are shown plain

#### Scenario: Jumping back from the step list
- **WHEN** the user is on the Project settings step and activates Workspace in the step list
- **THEN** the Workspace step is shown with what was entered, and nothing was saved by the jump

#### Scenario: Jumping forward again
- **WHEN** the user went back from Project settings to Agents, checks Codex and activates Project settings in the step list
- **THEN** the Agents step's save runs — Codex is added — and the Project settings step is shown

#### Scenario: A step not reached yet
- **WHEN** the user is on the Agents step for the first time
- **THEN** Console, Project settings and Done cannot be activated from the step list

#### Scenario: Back unmarks
- **WHEN** the user then activates **Back**
- **THEN** Agents is marked current again and only Welcome, System check and Workspace are shown as done

#### Scenario: Back keeps entries
- **WHEN** the user enters a workspace root, continues to Agents and activates **Back**
- **THEN** the Workspace step is shown with that root listed

#### Scenario: Narrow window
- **WHEN** the wizard is shown in a 400px wide viewport
- **THEN** every step's content and controls are reachable without scrolling sideways

### Requirement: The Welcome step says what setup covers
The Welcome step SHALL say in a few sentences what the dashboard is for, and that setup covers a check of the tools
the dashboard relies on, where the user's projects live, the agent CLIs the
user works with, the main console and the settings of the user's projects. It SHALL show these five topics as a diagram of the steps ahead: one node per step,
in the order the wizard takes them and connected in that order, each node with the step's number, its name and one line
on what it sets up, ending in a node for being ready to work. The diagram SHALL run across on a wide viewport and down
on a narrow one, SHALL fit a 400px viewport without horizontal scrolling, and SHALL be exposed to assistive technology
as an ordered list of the steps, with its connectors and icons hidden. It SHALL say that every step can be skipped and
changed later, in Settings or in a project's settings, and that setup can be run again from Help.

#### Scenario: Welcome
- **WHEN** the wizard opens
- **THEN** the Welcome step names the five topics, says that every step can be skipped and changed later, and says setup can be run again from Help

#### Scenario: The steps as a diagram
- **WHEN** the Welcome step is shown in a 1440px wide viewport
- **THEN** it shows System check, Workspace, Agents, Console and Project settings as numbered nodes from 1 to 5 in one row, connected in that order and followed by a node for being ready, each with one line on what it sets up

#### Scenario: The diagram on a narrow window
- **WHEN** the Welcome step is shown in a 400px wide viewport
- **THEN** the nodes run from top to bottom, connected in the same order, without scrolling sideways

#### Scenario: The diagram for a screen reader
- **WHEN** a screen reader user reaches the diagram
- **THEN** it is announced as a list of five steps in order, each read as its name and its line, without the connectors

### Requirement: The Workspace step adds roots and tracks projects
The Workspace step SHALL ask the user to choose at least one workspace folder for their projects, or to create a new
one. It SHALL list the configured workspace roots and let the user add roots in three ways: with
**Choose folder…**, which opens the operating system's own folder dialog and adds the folder the user chose; by typing
a path, with `~` accepted; and with one-click suggestions of the folders the server reports as existing in the user's
home directory that are not configured yet; when no root is configured and none of those folders exists, it SHALL
propose creating `~/Workspace`. It SHALL let the user remove roots added in this step. **Choose folder…**
SHALL be offered only while the server reports a folder picker as available, SHALL show that it is waiting while the
dialog is open and SHALL not be activatable again until it closes; cancelling the dialog SHALL add nothing and show no
error, and a failure SHALL be shown in the step with the typed path still available. A chosen folder that is already a
configured or entered root SHALL not be added twice, and the step SHALL say that it is already listed. Whenever the entered roots change, discovery SHALL run against
the configured and entered roots and the configured ignore paths without saving anything, and the step SHALL list the
OpenSpec projects found that are not tracked yet, each with a checkbox, all checked by default, and say how many git
repositories without OpenSpec were found, adding that they can be integrated from the projects overview. A root that
discovery reports as missing SHALL be marked as not found and offered **Create folder**; a root marked to be created
SHALL be created on **Continue** as specified in "A new workspace folder can be created" and then saved, and a missing
root not marked to be created SHALL NOT be saved. Only the latest discovery result
SHALL be shown. The step SHALL also offer **Add from GitHub**, opening the dialog of the `github-repositories`
capability with the configured and entered roots to choose from, in which confirming adds the chosen repositories to a
**GitHub repositories** list in the step instead of cloning them at once; each listed repository SHALL show the path it
will be cloned into and can be removed again before **Continue**. **Continue** SHALL be unavailable, saying why, while no
workspace root is configured, entered or marked to be created. **Continue** SHALL create each root marked to be created,
save the configuration with the entered roots added, track each checked project, and then start the clone of each
listed GitHub repository under the rules of that capability, and SHALL move to the next step as soon as every clone has
been accepted, without waiting for any of them to finish; the clones go on in the background while the user completes
setup, as the Done step shows. A clone the server refuses to start — its folder exists, say — SHALL keep the step open
with the reason on that repository and nothing started for it, the folder name editable and a retry offered; activating
**Continue** again SHALL move on without starting again what was already accepted. **Continue** SHALL NOT remove any root, ignore path or repository, and
SHALL NOT change any repository's name or enabled state other than tracking the checked projects and the cloned
repositories that use OpenSpec. If saving fails, the step SHALL stay open, show the error and keep the
entries. Continuing with a configured root and nothing entered, checked or listed SHALL save nothing, create nothing and clone
nothing.

#### Scenario: Choosing a folder in Finder
- **WHEN** the server runs on macOS and the user activates **Choose folder…** and picks `/w/acme` in the dialog
- **THEN** `/w/acme` is listed as an entered root, discovery runs, and the projects found under it are listed with checkboxes

#### Scenario: Cancelling the folder dialog
- **WHEN** the user activates **Choose folder…** and cancels the dialog
- **THEN** no root is added, no error is shown and **Choose folder…** can be activated again

#### Scenario: No folder picker on this machine
- **WHEN** the server reports that no folder picker is available
- **THEN** the step offers no **Choose folder…**, and roots can still be typed and picked from the suggestions

#### Scenario: A suggested folder
- **WHEN** `~/Workspace` exists, is not a configured root, and the user opens the Workspace step
- **THEN** `~/Workspace` is offered as a suggestion, and activating it adds it to the entered roots and runs discovery

#### Scenario: Projects found are tracked
- **WHEN** the user adds `/w/acme`, discovery finds `/w/acme/alpha-infra` and `/w/acme/demo-ops` with OpenSpec and `/w/acme/chat-groups` without, the user unchecks `demo-ops` and continues
- **THEN** the saved configuration has `/w/acme` as a root, `alpha-infra` is tracked and enabled, `demo-ops` is not in the configuration, and the step had said that one repository without OpenSpec can be integrated from the overview

#### Scenario: Nothing is saved before Continue
- **WHEN** the user marks `~/Workspace` to be created, adds a root, discovery lists projects, the user lists `acme/beta-soc` under GitHub repositories, and then activates **Skip setup**
- **THEN** the saved configuration's roots and repositories are unchanged, `~/Workspace` does not exist and nothing was cloned

#### Scenario: A missing folder
- **WHEN** the user enters `~/does-not-exist` and does not activate **Create folder**
- **THEN** the root is marked as not found, **Create folder** is offered, and the root is not saved on **Continue**

#### Scenario: Existing roots are kept
- **WHEN** setup is run again with two configured roots and the user adds a third and continues
- **THEN** the saved configuration has all three roots

#### Scenario: Creating a workspace folder
- **WHEN** no root is configured, `~/Workspace` does not exist, and the user accepts the proposal to create it and continues
- **THEN** `~/Workspace` exists as an empty folder and is saved as a workspace root

#### Scenario: A root is required
- **WHEN** no root is configured and the user has entered none
- **THEN** **Continue** is inactive and says that a workspace folder is needed, and **Skip setup** is still available

#### Scenario: GitHub repositories into a new workspace
- **WHEN** no root is configured, the user marks `~/Workspace` to be created, lists `acme/beta-soc`, which uses OpenSpec, and `acme/chat-groups`, which does not, and continues
- **THEN** `~/Workspace` is created and saved as a root, both clones are started into it and the wizard moves to the Agents step at once; once they have finished, `beta-soc` is tracked and enabled and `chat-groups` is reported as cloned without OpenSpec

#### Scenario: Continue does not wait
- **WHEN** the user lists a repository whose clone takes five minutes and continues
- **THEN** the wizard shows the Agents step as soon as the clone has been accepted, and the clone goes on

#### Scenario: A clone fails
- **WHEN** the user lists `acme/beta-soc` and `acme/missing-repo`, continues, and the clone of `acme/missing-repo` later fails
- **THEN** the wizard had already moved to the Agents step, and the Done step lists `acme/missing-repo` with its reason and a retry, while `acme/beta-soc` was cloned once

#### Scenario: A clone is refused
- **WHEN** the user lists `acme/beta-soc` and `acme/chat-groups`, continues, and `/w/acme/chat-groups` already exists
- **THEN** the step stays open, `acme/beta-soc` is being cloned, and `acme/chat-groups` shows the reason with its folder name editable; after renaming it to `chat-groups-gh` and continuing, its clone starts, `acme/beta-soc` is not started a second time, and the wizard moves on

### Requirement: The Agents step can switch agent sessions on with a chosen default agent
The Agents step SHALL state, as the Agent sessions section of Settings does, that enabling agent sessions lets the
dashboard start the chosen programs on this machine, that an agent can change files and run commands as the user allows
it to, that each session works in its own worktree under the dashboard home, and that it applies to every tracked
repository unless switched off for a project. It SHALL offer a switch for agent sessions, switched on by default:
while agent sessions are off in the saved configuration it SHALL start checked, so that **Continue** switches them on
unless the user unchecks it; while they are on it SHALL show them on and SHALL NOT switch them off.

It SHALL list the configured profiles and every preset not configured yet, each with a checkbox and marked found or not
found on this machine, found ones first, side by side in one row of tiles of the same height on a wide viewport — each
with its name and whether it was found on one line and its status below — and one below the other on a narrow one.
Configured profiles SHALL be shown checked and SHALL NOT be uncheckable, since
the wizard never removes a profile the user configured. Agents SHALL NOT come pre-configured in the wizard: while the
configuration's agents are exactly what a fresh installation ships — the Claude Code profile, unchanged, as the only
profile and the default, with no console agent — that profile SHALL NOT count as configured, and Claude Code SHALL be
offered like any other preset. A preset SHALL be checked by default when its executable is found, and unchecked
otherwise. The Agents step is where agents are checked: whether each listed agent's executable is found SHALL be looked up when the
step is shown and again when the user activates **Check again**, which marks itself as working while it does and then
updates every mark. For every checked agent whose executable is not found, the step SHALL show how to install it, as the
`environment-check` capability's instructions specify, with each command copyable with one action, and SHALL still allow
continuing. It SHALL NOT refer the user to the System check step for agents.

The step SHALL offer **Add another agent**, which asks for a name and a command line, given as one argument per line,
in which `{prompt}` stands for the opening prompt. A custom agent SHALL need a non-empty name and a non-empty first
argument; until it has both it SHALL say what is missing and SHALL NOT be saved. It SHALL be listed and checked like a
preset, and SHALL be removable in this step until saved. Its prompts SHALL be those Settings gives a newly added agent,
and the step SHALL say that its prompts can be edited in Settings.

The step SHALL offer a choice of the **default agent** among the checked agents. The configured default SHALL be
preselected when it is checked and its executable is found, otherwise the first checked agent that is found, otherwise
the configured default.

At least one agent is required to proceed: while no agent is configured, checked or described completely as a custom
agent, **Continue** SHALL be disabled and SHALL say that an agent has to be chosen, and no later step SHALL open from the
step list; **Back** and **Skip setup** stay available, and skipping keeps the configuration's agents as they are.

**Continue** SHALL save: agent sessions switched on unless the user unchecked the switch; every checked preset and every custom
agent that is not configured yet added as a profile, in the order listed — in place of the shipped profile while the
agents are the untouched default, so that exactly the checked agents are configured; and the chosen agent as the
default. It SHALL NOT switch agent sessions off, remove or edit a profile the user configured, or change any
repository's agent settings.
If the user unchecked the switch, checked nothing new and chose the current default, **Continue** SHALL save nothing.

#### Scenario: Several agents installed
- **WHEN** a fresh installation finds `claude` and `codex` but not `agy`
- **THEN** Claude Code and Codex are listed checked and can be unchecked, Antigravity is unchecked, and Claude Code is preselected as the default agent

#### Scenario: Claude Code is not pre-configured
- **WHEN** a fresh installation finds none of the presets' executables
- **THEN** no agent is checked, Claude Code can be checked like Codex and Antigravity, and **Continue** is disabled with the reason that an agent has to be chosen

#### Scenario: One agent is enough
- **WHEN** in that state the user checks Codex
- **THEN** **Continue** is available, and continuing saves Codex as the only profile and the default agent, without the shipped Claude Code profile

#### Scenario: A profile the user edited stays
- **WHEN** the user changed the Claude Code profile's command in Settings and runs setup again
- **THEN** Claude Code is listed as configured, checked and cannot be unchecked

#### Scenario: Switching on with an installed preset
- **WHEN** on a fresh installation `codex` is found, `claude` is not, and agent sessions are off
- **THEN** Codex is checked and preselected as the default agent and Claude Code is unchecked; continuing with agent sessions switched on saves agent sessions enabled and Codex as the only profile and the default

#### Scenario: Adding two agents
- **WHEN** the user keeps Codex checked, also checks Antigravity, keeps agent sessions switched on, chooses Codex as the default and continues
- **THEN** the saved configuration has agent sessions enabled, the profiles Codex and Antigravity, Codex as the default agent, and every repository's agent settings unchanged

#### Scenario: A custom agent
- **WHEN** the user activates **Add another agent**, enters the name `My agent` and the command `my-agent` and `{prompt}` on two lines, and continues
- **THEN** the saved configuration has a profile named `My agent` with the command `["my-agent", "{prompt}"]` and the prompts Settings gives a new agent

#### Scenario: An incomplete custom agent
- **WHEN** the user adds a custom agent with a name but no command
- **THEN** the step says that a command is required and **Continue** does not save that agent

#### Scenario: The chosen agent is not installed
- **WHEN** the user checks the Antigravity preset and `agy` is not found
- **THEN** the step shows how to install Antigravity with a command to copy, and **Continue** is still available

#### Scenario: Risks are stated
- **WHEN** the Agents step is shown
- **THEN** it says that an agent can change files and run commands as the user allows it to, and that sessions work in their own worktree

#### Scenario: On by default
- **WHEN** agent sessions are off in the saved configuration and the Agents step is shown
- **THEN** **Turn agent sessions on** is checked, and continuing without touching it saves agent sessions enabled

#### Scenario: Leaving it off
- **WHEN** the user unchecks **Turn agent sessions on** and continues without checking a new agent and without changing the default agent
- **THEN** no configuration is saved by the step

#### Scenario: Checking again after installing
- **WHEN** `agy` was not found, the user checked Antigravity, installs it and activates **Check again**
- **THEN** Antigravity is marked found, its install instructions are gone, and no process other than the executable lookup was started

### Requirement: The System check step shows the environment report with instructions
The System check step SHALL follow Welcome and SHALL request a fresh environment report in its setup view (the
`environment-check` capability's "The setup view leaves agents out") when it is shown, and show every check of that view
in the report's order with its label, its status in text, what was found and, for a check that is not `ok`, its remedy
and its instructions, each command shown so that it can be copied with one action. It SHALL NOT list a check per agent:
whether each agent's executable is found is shown in the Agents step. It SHALL say that the GitHub CLI is used for pull requests
and issues, and that git is needed to give each agent session its own worktree. It SHALL offer **Re-check**, which requests a fresh report and marks itself as working while
it does. It SHALL say plainly when everything needed is in place, and SHALL allow continuing whatever the report says.
It SHALL present the report in the same visual language as the Done step: a headline with a large badge — a check mark
when everything needed is in place, a mark that something needs attention otherwise — saying how many checks are in
place, with **Re-check** beside it; then one card per check, in the report's order, each with an icon for its tool, its
label, what was found and its status as a pill in text and colour, the card's edge in the status's colour, and for a
check that is not `ok` its remedy and instructions inside the card. The cards SHALL be exposed to assistive technology
as a list, each read as its label, status and what was found, with the icons hidden; any animation SHALL not play when
the user prefers reduced motion, and the step SHALL fit a 400px viewport without horizontal scrolling.
The dashboard SHALL NOT run any command shown in the instructions.

#### Scenario: gh is missing
- **WHEN** a fresh installation has agent sessions off and `gh` is not on the PATH
- **THEN** the System check step, shown second, lists the GitHub CLI check as `warning` with instructions to install the GitHub CLI and to run `gh auth login`, each with a copy control

#### Scenario: No agent checks
- **WHEN** three agent profiles are configured and the System check step is shown
- **THEN** it lists no check for any agent

#### Scenario: Re-check after installing
- **WHEN** the user installs the missing tool and activates **Re-check**
- **THEN** the control shows that it is working and the list is replaced by the fresh report

#### Scenario: Copying a command
- **WHEN** the user activates the copy control next to a command
- **THEN** the command is on the clipboard, the control confirms it, and no process was started

#### Scenario: All in place
- **WHEN** every check of the setup view is `ok`
- **THEN** the step says that everything needed is in place

#### Scenario: A visual report
- **WHEN** the System check step shows a setup view in which the GitHub CLI check is `warning` and the other four are `ok`
- **THEN** the headline says four of five checks are in place beside a mark that something needs attention, with **Re-check** beside it, and five cards follow in the report's order, each with its tool's icon and a status pill, the GitHub CLI card in the warning colour holding its install and login commands

### Requirement: The Done step summarises and ends setup
The Done step SHALL summarise what setup saved: the roots added and which of them it created, the number of projects
tracked, the GitHub repositories whose clones setup started, whether agent
sessions are on, the agents added, the default agent, the console agent and the number of projects whose settings were
changed. It SHALL also say what is left, naming the checks of a setup-view report requested when the Done step is shown that are
still `problem` or `warning`, and each checked agent whose executable the Agents step last found missing. It SHALL present this
visually: a headline that setup is complete, with a large check mark — or, when checks still need attention, that setup
is complete with something left to fix — followed by one card per step from System check to Project settings, in the wizard's
order, each with that step's icon from the Welcome diagram, its name, its outcome in a word or a number and a line of
detail, and a mark in text and colour of whether it is **done**, **needs attention** or had **nothing changed**. A card
SHALL need attention only for the System check, when a check is `problem` or `warning`, and for Agents, when a checked
agent is not found. Below the cards it SHALL say
what comes next: the projects overview, and the tour on a first start. The cards SHALL be exposed to assistive
technology as a list, each read as its name, mark and outcome, and the headline's animation, if any, SHALL not play when
the user prefers reduced motion. Below the cards it SHALL list every clone setup started, each as the `github-repositories` capability shows a
clone — queued, cloning with its progress, tracked, cloned without OpenSpec, failed with its reason or cancelled — with
Cancel for a queued or running one and Retry for a failed or cancelled one, updating while the step is open; the
Workspace card SHALL count the clones started and say how many are still running. Clones still running SHALL NOT keep
the user from finishing: **Finish** SHALL say that they go on and can be followed under Unmanaged projects. It SHALL offer **Finish**. Finishing, and **Skip setup** at any step, SHALL mark setup as done on the server and close the wizard,
keeping everything earlier steps saved. If marking setup as done fails, the wizard SHALL close anyway and open by itself
again on the next page load. After the wizard closed on a first start, the onboarding tour SHALL start under its own
rules.

#### Scenario: Finish
- **WHEN** the user activates **Finish**
- **THEN** the wizard closes, the configuration no longer has `setup: "pending"`, and on reload the wizard does not open

#### Scenario: A visual ending
- **WHEN** the user added `/w/acme`, tracked two projects, added Codex, kept the console on the default agent, changed no project setting, and every check is `ok`
- **THEN** the Done step's headline says setup is complete beside a large check mark, and it shows five cards — System check "All in place" done, Workspace "2 projects" done, Agents "2 agents" done, Console "Claude Code" done, Project settings nothing changed — each with its step's icon

#### Scenario: Something left to fix
- **WHEN** the GitHub CLI check is `warning` on the Done step
- **THEN** the headline says something is left to fix, and the System check card is marked as needing attention and names the GitHub CLI

#### Scenario: Summary of agents and projects
- **WHEN** the user added Codex and Antigravity, kept the console on the default agent and changed the auto fetch of three projects
- **THEN** the Done step lists Codex and Antigravity as added, names the default agent as the console agent, and says that the settings of three projects were saved

#### Scenario: Skip keeps what was saved
- **WHEN** the user continues from the Workspace step, which tracked two projects, and activates **Skip setup** on the Agents step
- **THEN** the wizard closes, setup is marked done, and the two projects are still tracked

#### Scenario: The tour follows
- **WHEN** a first-time user finishes the wizard in a browser that has not seen the tour
- **THEN** the onboarding tour starts at its first step

#### Scenario: An agent still missing
- **WHEN** the user checked Antigravity, `agy` is still not found, and every check of the setup view is `ok`
- **THEN** the Agents card is marked as needing attention and names Antigravity, and the System check card is done

#### Scenario: Clones on the Done step
- **WHEN** setup started the clones of `acme/beta-soc`, which is at 40%, and `acme/chat-groups`, which failed
- **THEN** the Done step lists `acme/beta-soc` with its progress bar and Cancel, and `acme/chat-groups` with its reason and Retry, and the Workspace card says one clone is still running

#### Scenario: Finishing while cloning
- **WHEN** a clone is still running and the user activates **Finish**
- **THEN** the wizard closes, the clone goes on, and the projects overview lists it under Unmanaged projects with its progress

### Requirement: Setup can be run again
Running setup again from Help SHALL open the wizard at its first step whether or not setup is pending, with the current
configuration prefilled, under the same rules for steps, saving and finishing. It SHALL NOT start the onboarding tour
when it closes.

#### Scenario: Run again
- **WHEN** a user who finished setup activates **Run setup again** on the Help page
- **THEN** the wizard opens at Welcome and the Workspace step lists the configured roots

### Requirement: The wizard reads and writes only through existing rules
The wizard SHALL save only through the configuration, tracking, setup, workspace-folder and GitHub clone endpoints, and
MUST NOT write to a tracked repository or start an agent. Beyond the configuration, the only things it writes are a new
workspace folder the user marked to be created and the GitHub clones the user listed. The processes it may cause to be
started are the operating system's folder dialog, through the setup folder endpoint, only when the user activates
**Choose folder…**; the environment report's `git config --get`; and, under the `github-repositories` capability, the
read-only `gh repo list` and `gh api user` when the user opens the Add from GitHub dialog, changes its owner or refreshes
it, and the `git clone` of each GitHub repository the user listed, when the user activates **Continue** or a retry. Only
those last two contact a network. Its
workspace suggestions SHALL come from a fixed list of folder names checked directly in the user's home directory,
without listing the home directory or descending into any folder.

#### Scenario: No process started
- **WHEN** the user steps through the whole wizard with an existing root and without opening Add from GitHub, switches agent sessions on, adds two agents and changes the settings of every project
- **THEN** no agent was started, no repository file was created, modified or deleted, no network was contacted, and no process was started other than any folder dialog the user opened and the environment report's `git config --get`

#### Scenario: Only what the user asked for
- **WHEN** the user opens Add from GitHub in the Workspace step, lists one repository and continues
- **THEN** the only processes started besides the environment report's were the `gh` listing and one `git clone` of that repository, and no agent was started

### Requirement: The demo does not open the wizard by itself
In the demo build the wizard SHALL NOT open by itself. **Run setup again** on the demo's Help page SHALL open it against
the demo's own data, where its saves change only the demo's in-page state, and where **Choose folder…** opens no
dialog and adds the demo's own workspace folder.

#### Scenario: Demo first load
- **WHEN** a visitor opens the demo for the first time
- **THEN** no wizard is shown

#### Scenario: Demo run again
- **WHEN** a demo visitor activates **Run setup again**
- **THEN** the wizard opens at its first step

#### Scenario: Demo folder choice
- **WHEN** a demo visitor who removed the demo's workspace folder as a root activates **Choose folder…** on the Workspace step
- **THEN** no dialog opens and the demo's workspace folder is added as an entered root; while it is still a root, the step says that it is already listed

### Requirement: The Console step explains the main console and chooses its agent
The Console step SHALL explain the main console: that it is an agent session that belongs to no project and no change,
that it is opened from the top bar, that it runs in the console folder, by default under the dashboard home and never
inside a tracked repository, and that it is meant for questions and work across projects, such as creating a project
or asking about several of them. It SHALL say that the console is offered only while agent sessions are on, and, when
they are off in the saved configuration, that it becomes available once they are switched on.

When at least two profiles are configured, the step SHALL offer a choice of the **console agent**: **Default agent**,
which names the current default agent and SHALL be stored as no choice so the console follows the default, or any
configured profile, each marked found or not found. The saved choice SHALL be preselected. With one profile configured,
the step SHALL name that profile as the agent the console runs and offer no choice. **Continue** SHALL save the
console agent when it differs from the saved one, and SHALL change nothing else; otherwise it SHALL save nothing.

#### Scenario: Explaining the console
- **WHEN** the Console step is shown
- **THEN** it says that the console is an agent without a project or change, opened from the top bar, running in the console folder outside every repository, for work across projects

#### Scenario: Choosing a console agent
- **WHEN** Claude Code is the default agent, Codex is configured, and the user chooses Codex and continues
- **THEN** the saved configuration has Codex as the console agent and Claude Code still as the default agent

#### Scenario: Following the default
- **WHEN** the console agent is Codex and the user chooses **Default agent** and continues
- **THEN** the saved configuration has no console agent

#### Scenario: One profile
- **WHEN** only the Claude Code profile is configured
- **THEN** the step names Claude Code as the console's agent, offers no choice, and **Continue** saves nothing

#### Scenario: Agent sessions off
- **WHEN** agent sessions are off in the saved configuration
- **THEN** the step says that the console becomes available once agent sessions are switched on

### Requirement: The Project settings step configures every enabled project
The Project settings step SHALL cover every enabled tracked project in the saved configuration, the projects tracked
in the Workspace step included. With none, it SHALL say that no project is tracked yet and that projects can be set up
later from the projects overview, and **Continue** SHALL save nothing.

It SHALL offer two modes, **Same settings for all projects**, selected by default, and **Individual settings**. Both
SHALL offer the settings of the project settings dialog with the same names, values and explanations: **Agent
sessions**, **Agent**, **PR titles**, **Docs auto-merge** and **Auto fetch**, in that order. A setting SHALL be shown
only under the rules of the project settings dialog, judged against the configuration as the earlier steps saved it:
**Agent** only when more than one profile is configured, **Docs auto-merge** only while agent sessions are on and the
project's agent sessions are enabled, and **PR titles**, **Docs auto-merge** and **Auto fetch** only for a git
repository. Whether a project is a git repository SHALL be taken from its latest scan; while a covered project has not
been scanned yet, as one tracked a moment ago, the step SHALL say that it is reading the projects and offer its
settings once every covered project has a scan result, with **Continue** and **Skip setup** still available. The step
SHALL say for each setting what its default is. A setting's explanation SHALL NOT be shown inline: beside the
setting's name the step SHALL offer a help control, an icon whose accessible name names the setting, which shows the
explanation in an overlay next to it and reports itself to assistive technology as expanded while it does. At most one
overlay SHALL be open; it SHALL close when its help control is activated again, when another one is opened, on a click
outside it, on Escape, and when the step or the project shown changes. The default, and which projects a setting is
not set for, SHALL stay visible without opening it. **PR titles**, **Docs auto-merge** and **Auto fetch**, the settings
that apply only to a git repository, SHALL each read "Requires a git repository" in small text below their name, in
both modes.

In **Same settings for all projects** the step SHALL show one form. Each setting SHALL show the value all the projects
it applies to share, which for a fresh project is the default, and, when they differ, SHALL read **Keep each project's
setting**. A setting applies to the projects that would show it in their settings dialog. When a setting does not apply to every
project, the form SHALL name the projects it is not set for and say why — that they are not git repositories, or that
their agent sessions are disabled — naming at most three and counting the rest ("Not set for beta-notes, which is not
a git repository."); it SHALL NOT state a bare count.

In **Individual settings** the step SHALL show one project at a time with its name and its position as "Project n of
N", prefilled with that project's own values, with **Previous project** and **Next project**. Values entered for a
project SHALL be kept while the user moves between projects and steps.

**Continue** SHALL save, in one configuration write built from the configuration as it is at that moment, only the
settings the user changed in this step: in **Same settings for all projects** a changed setting is written to every
project it applies to; in **Individual settings** each project's changed settings are written to that project. A
setting the user did not change SHALL keep each project's own value. Values SHALL be stored as the project settings
dialog stores them, so that choosing a default clears the project's own value. The step SHALL NOT change any project's
name, labels or enabled state, and SHALL NOT change any setting outside these five. If nothing was changed,
**Continue** SHALL save nothing. If saving fails, the step SHALL stay open, show the error and keep the entries.

#### Scenario: Defaults shown for fresh projects
- **WHEN** the user tracked `alpha-infra` and `demo-ops`, both git repositories, in the Workspace step and switched agent sessions on
- **THEN** the Project settings step shows **Same settings for all projects** with Agent sessions Enabled, PR titles No convention, Docs auto-merge Off and Auto fetch Every minute, each saying it is the default

#### Scenario: A setting's explanation in an overlay
- **WHEN** the Project settings step shows Auto fetch
- **THEN** its explanation is not shown inline, its default "Every minute" is, and activating the help icon beside "Auto fetch" shows the explanation — that the dashboard only fetches and never updates the checkout — in an overlay, with the icon reported as expanded

#### Scenario: Settings that need git are marked
- **WHEN** the Project settings step shows its settings
- **THEN** PR titles, Docs auto-merge and Auto fetch each read "Requires a git repository" below their name, and Agent sessions and Agent do not

#### Scenario: Closing the overlay
- **WHEN** the Auto fetch overlay is open and the user presses Escape
- **THEN** the overlay closes, focus is on its help icon, and the wizard stays open on the Project settings step

#### Scenario: One change for all projects
- **WHEN** in **Same settings for all projects** the user picks **Conventional Commits** under PR titles and continues
- **THEN** every enabled git project has `prTitleConvention: conventional-commits`, and each project's other settings are unchanged

#### Scenario: Which projects a setting skips
- **WHEN** 13 projects are enabled, `beta-notes` is a folder without git, and the shared form shows Auto fetch
- **THEN** it reads "Not set for beta-notes, which is not a git repository." and not a count such as "Applies to 12 of 13 projects"

#### Scenario: Mixed values are kept
- **WHEN** `alpha-infra` fetches every 5 minutes and `demo-ops` every minute, and the user continues without touching Auto fetch
- **THEN** Auto fetch reads **Keep each project's setting** and both projects keep their own intervals

#### Scenario: Walking through projects
- **WHEN** the user chooses **Individual settings** with three enabled projects, switches Docs auto-merge On for the first, moves to the second with **Next project**, sets its Auto fetch to Off and continues
- **THEN** the step had shown "Project 1 of 3" and "Project 2 of 3", the first project has `autoMergeDocs: true`, the second has `autoFetchSeconds: 0`, and the third is unchanged

#### Scenario: A folder without git
- **WHEN** `beta-notes` is a tracked folder without git
- **THEN** in **Individual settings** its page shows no PR titles, Docs auto-merge or Auto fetch, and in **Same settings for all projects** a changed Auto fetch is not written to it

#### Scenario: Choosing the default clears the setting
- **WHEN** `demo-ops` has Auto fetch Off, and in its individual page the user picks **Every minute** and continues
- **THEN** the project's entry no longer carries `autoFetchSeconds`

#### Scenario: Projects still being scanned
- **WHEN** the user tracked `alpha-infra` in the Workspace step and opens the Project settings step before its first scan finished
- **THEN** the step says that it is reading the projects, and shows the settings once `alpha-infra` has been scanned

#### Scenario: Nothing changed
- **WHEN** the user continues from the Project settings step without changing any setting
- **THEN** no configuration is saved by the step

#### Scenario: No projects
- **WHEN** no project is tracked and enabled
- **THEN** the step says that no project is tracked yet and that projects can be set up later from the projects overview

### Requirement: The wizard is a large, roomy dialog
On a viewport wide enough for it, the wizard SHALL be wider and taller than the other dialogs of the dashboard, and it
SHALL keep the same size from step to step, scrolling a step's content inside the dialog when it does not fit, with the
step list and the controls always in view. Its text SHALL have one size for body text and one for secondary text, the
same on every step and at every viewport width; only headings differ. Its form controls SHALL be at least 40px high,
and its groups of controls SHALL be visibly set apart from one another. On a 1280 by 800 viewport, every step SHALL fit
without scrolling with up to five projects found or configured, three agents and the System check's usual checks —
only content the user adds, such as a custom agent's form, or longer lists MAY make a step scroll. On a narrow viewport
it SHALL fill the width available within the page margin, under the 400px rule above.

#### Scenario: Steady size
- **WHEN** on a 1440 by 900 viewport the user moves from the Welcome step to the Project settings step
- **THEN** the dialog's width and height are the same on both steps and wider than the project settings dialog

#### Scenario: Steps fit without scrolling
- **WHEN** on a 1280 by 800 viewport a user with three projects and three agents goes through every step without adding a custom agent
- **THEN** no step's content needs scrolling

#### Scenario: One text size
- **WHEN** the user moves from the Welcome step through every step to Done, on a wide and on a narrow viewport
- **THEN** body text has the same size on every step, and secondary text has the same size on every step

#### Scenario: Long content scrolls inside
- **WHEN** the Workspace step lists more projects than fit in the dialog
- **THEN** the list scrolls inside the dialog, and the step list, **Back**, **Continue** and **Skip setup** stay in view

### Requirement: A new workspace folder can be created
A folder the Workspace step marks to be created SHALL be created on **Continue** by the server, before the configuration
is saved, as exactly one new, empty directory made with a non-recursive, exclusive create, and nothing else: no file in
it, no git command, no other folder. The path MUST be absolute after `~` expansion, its parent MUST exist and be a
directory, and the path MUST NOT exist in any form — file, directory or symbolic link — and MUST NOT lie in or below a
tracked repository's folder, an ignore path or the dashboard's home directory. A refusal SHALL be shown on that root
with its reason, SHALL leave the file system unchanged, and SHALL keep the step open with the entries kept; nothing is
saved when any creation was refused. The folder SHALL NOT be deleted afterwards, whatever later steps do.

#### Scenario: Parent missing
- **WHEN** the user marks `~/missing-parent/Workspace` to be created and `~/missing-parent` does not exist
- **THEN** **Continue** shows on that root that its parent folder does not exist, nothing is created and nothing is saved

#### Scenario: Inside a tracked repository
- **WHEN** the user marks `/w/acme/demo-ops/projects` to be created and `/w/acme/demo-ops` is tracked
- **THEN** it is refused with a reason that names the repository and nothing is created

#### Scenario: Appeared in the meantime
- **WHEN** the folder marked to be created exists by the time the user continues
- **THEN** it is not created again; the step marks it as found and it is saved as a root on the next **Continue**

### Requirement: The System check step names the developer tools on a Mac without them

On a Mac where `git` does not count as found because only Apple's placeholder is on the PATH (`environment-check`
capability, "On macOS the git placeholder is not git"), the System check step SHALL show the `git` check as `problem`
with the `xcode-select --install` instruction, and showing the step or activating **Re-check** SHALL NOT run the
placeholder.

#### Scenario: First setup on a fresh Mac
- **WHEN** the wizard's System check step is shown on a Mac without the command line developer tools
- **THEN** the `git` card is `problem` and shows `xcode-select --install` to copy, the `git-identity` card says git was not found, and no dialog offering to install the developer tools was opened by the dashboard

### Requirement: The Workspace step keeps the projects the user left out

A project the user unchecked on the Workspace step SHALL stay unchecked for as long as the wizard is open — after
**Continue** saved the step, after a refused clone kept the step open, and after **Back** or the step list returned to
the step — and SHALL NOT be tracked by any later **Continue** unless the user checks it again.

#### Scenario: A refused clone keeps the step open
- **WHEN** discovery lists `/w/acme/alpha-infra` and `/w/acme/demo-ops`, the user unchecks `demo-ops`, lists `acme/chat-groups` whose folder already exists, and continues, then renames the folder and continues again
- **THEN** `alpha-infra` is tracked, `demo-ops` was shown unchecked throughout and is not in the configuration

#### Scenario: Back to the Workspace step
- **WHEN** the user unchecked `demo-ops`, continued to Agents, activated **Back** and continued again
- **THEN** `demo-ops` is shown unchecked and is not in the configuration

### Requirement: The wizard identifies a clone by the server's path

The wizard SHALL remember each clone it started by the path the server reported for that clone when it accepted it,
and the Done step SHALL show every such clone — its progress, failure and **Retry** — whatever spelling the user typed
the workspace root in.

#### Scenario: A root typed in another case
- **WHEN** the folder `~/Workspace` exists on a case-insensitive disk, the user types `~/workspace` as a root, lists `acme/missing-repo` and continues, and the clone later fails
- **THEN** the Done step lists `acme/missing-repo` with its reason and **Retry**

#### Scenario: A root through a symbolic link
- **WHEN** the user types a root whose path runs through a symbolic link and lists `acme/beta-soc`
- **THEN** the Done step lists `acme/beta-soc` with its progress while it clones

### Requirement: The Workspace step continues only on the latest discovery

While discovery runs on the Workspace step, **Continue** SHALL be unavailable, saying that projects are still being
looked for, and the step list SHALL NOT move forward; **Continue** SHALL track only projects from the latest discovery
result.

#### Scenario: Removing a root and continuing at once
- **WHEN** the user removes the entered root `/w/acme`, whose projects were listed, and activates **Continue** before discovery has finished
- **THEN** nothing is saved; once discovery has finished, **Continue** saves the remaining roots and tracks no project under `/w/acme`, and no error is shown
