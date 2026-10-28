# editor-launch Specification

## Purpose
Lets the user open the folder an agent session works in — its worktree, or the tracked folder of an in-place session —
in the editor of their choice with one click, instead of copying a `cd` and opening the editor by hand.

## Requirements

### Requirement: The editor is one configurable command, VS Code by default
The dashboard SHALL keep one global **editor command**: an argument list, never a shell string, whose first argument is
the editor's executable. In it `{path}` SHALL be the only placeholder; it MAY appear in at most one argument, never in
the first, and is replaced there by the folder to open. Without `{path}` the folder SHALL be added as one whole last
argument. When no editor command is configured the dashboard SHALL use `code` — VS Code's command — so that opening an
editor works without any setting wherever that command is installed. A fresh or migrated configuration SHALL carry no
editor command.

The Agent sessions section of Settings SHALL show an **Editor command** field, one argument per line, saying that the
command is run with the folder to open and naming `code` as what applies when the field is empty. Each argument SHALL be
non-empty and SHALL contain no control character and no placeholder other than `{path}`. A command that breaks these
rules SHALL be refused when it is saved, with a message naming the editor command, leaving the stored configuration
unchanged. Clearing the field SHALL store no editor command, which means `code` again. A changed command SHALL apply to
the next time an editor is opened.

#### Scenario: Default editor
- **WHEN** no editor command is configured and the user opens the editor for the session worktree
  `/home/u/.spec-control/worktrees/demo-ops/audit-trail`
- **THEN** the dashboard starts `code` with the one further argument `/home/u/.spec-control/worktrees/demo-ops/audit-trail`

#### Scenario: Another editor
- **WHEN** the editor command is `zed` and the user opens the editor for a session worktree
- **THEN** `zed` is started with that worktree's path as its only argument

#### Scenario: A placeholder in the middle
- **WHEN** the editor command is `open`, `-a`, `Visual Studio Code`, `{path}` and the user opens the editor for a session worktree
- **THEN** the dashboard starts `open` with the arguments `-a`, `Visual Studio Code` and the worktree's path, each as one argument

#### Scenario: Another placeholder is refused
- **WHEN** the user saves the editor command `code`, `{change}`
- **THEN** saving is refused with a message naming the editor command, and the stored configuration is unchanged

#### Scenario: The placeholder as the executable is refused
- **WHEN** the user saves the editor command `{path}`
- **THEN** saving is refused with a message naming the editor command, and the stored configuration is unchanged

#### Scenario: Clearing the field
- **WHEN** the user clears the Editor command field and saves
- **THEN** the saved configuration carries no editor command, and the next editor opened is `code`

### Requirement: Open in editor is offered for a change's session folder
Wherever agent sessions apply to a repository — agent sessions on and the repository not excluded — the dashboard SHALL
offer **Open in editor** beside **Copy cd** for a change's session and for a change's session worktree: in the Console
tab's header for the selected session, in the Console tab's state for a session worktree without a session record, and
on each worktree entry of the Open work list. The folder it opens SHALL be the session's working directory — its
worktree, or, for an in-place session, the tracked folder the agent runs in — or, for a worktree without a session
record, that worktree. It SHALL be offered whether the session is running or has ended, as long as that folder exists.
The main console, a project console and an integration session belong to no change and SHALL NOT offer it. With agent
sessions off for the repository, or the repository excluded, it SHALL NOT be offered anywhere.

The control's tooltip SHALL name the command that will run. When the editor's executable is not found on this machine
the control SHALL be disabled and SHALL say which command was not found and that it can be changed in the Agent
sessions settings, linking there. Activating it SHALL NOT open the Console tab, start, end or resume a session, or send
anything to an agent.

#### Scenario: From the Console tab
- **WHEN** the Console tab shows the running Implement session of `audit-trail` and the user activates **Open in editor**
- **THEN** the editor is started on that session's worktree and the session keeps running untouched

#### Scenario: A worktree without a session record
- **WHEN** the Console tab of a change shows a session worktree whose session record is gone, and the user activates
  **Open in editor**
- **THEN** the editor is started on that worktree

#### Scenario: An in-place session
- **WHEN** a session of a tracked folder that is not a git repository has ended and the user activates **Open in editor**
  in its Console tab
- **THEN** the editor is started on that tracked folder

#### Scenario: Editor not installed
- **WHEN** the editor command is the default and `code` is not found on this machine
- **THEN** **Open in editor** is disabled, says that `code` was not found and links to the Agent sessions settings

#### Scenario: Consoles have no editor control
- **WHEN** the user opens the main console or a project console
- **THEN** no **Open in editor** control is shown

#### Scenario: Feature off
- **WHEN** agent sessions are disabled
- **THEN** no **Open in editor** control is shown anywhere

### Requirement: The editor is started as the user's own program and left alone
Opening the editor SHALL start the editor command once, without a shell, from the argument list described above, with
its working directory set to the folder it opens, with no terminal, no input, and its output discarded. The folder
SHALL be taken from the dashboard's own session records and session worktree list, never from text the browser sent:
the browser names a session or a session worktree, and no text from the browser becomes part of the command line. The
folder SHALL exist when the editor is started; a folder that is gone SHALL be refused with that reason and nothing
started. The editor SHALL NOT be ended when the dashboard stops.

The dashboard SHALL report that the editor was started, or why it could not be: the executable was not found, or the
start failed with the system's reason. It MUST NOT wait for the editor to exit, read its output, record it as a
session, keep it in the activity log or any other record, count it towards keep-awake, or show it in Open work. Like
the agent, the editor is a program the user started: what it changes in the folder is the user's doing, and starting
it writes nothing to any repository, runs no git command and contacts no other host. The demo SHALL offer the control
and, when it is activated, say that the demo opens no editor, starting nothing.

#### Scenario: Nothing is written by opening the editor
- **WHEN** the user opens the editor for a session worktree and the editor command is a stand-in that exits at once
- **THEN** the repository, its main checkout and the worktree are byte-for-byte unchanged, no git command was run for
  it, and no session record or activity entry was added

#### Scenario: The folder is gone
- **WHEN** the user activates **Open in editor** for a session whose worktree directory was deleted outside the dashboard
- **THEN** the user is told the folder no longer exists and no process is started

#### Scenario: The start fails
- **WHEN** the editor's executable exists but cannot be started
- **THEN** the control says the editor could not be started, with the system's reason, and nothing else changes

#### Scenario: The dashboard stops
- **WHEN** an editor was opened from the dashboard and the dashboard is then stopped
- **THEN** the editor keeps running

#### Scenario: The demo
- **WHEN** a visitor activates **Open in editor** in the demo
- **THEN** the demo says that it opens no editor, and no process is started
