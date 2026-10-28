# project-creation Specification

## Purpose

Lets the user start a brand-new project from the dashboard: pick a workspace root, name a folder, and get an empty git
repository there that the user's agent sets up for OpenSpec and that the dashboard then tracks.

## Requirements

### Requirement: New project is offered from the projects overview

The projects overview SHALL offer a **New project** action in its header band and, while no repository is tracked, in
its "No repositories tracked yet" empty state next to the link to Settings. Activating it SHALL open a dialog in which the user picks
one of the configured workspace roots (scan roots) and types a folder name; the dialog SHALL show the full path that
will be created and SHALL preselect the root when exactly one is configured. Confirming the dialog SHALL create the
project as specified below. The action SHALL be unavailable, with the reason stated in its tooltip and accessible name,
when no workspace root is configured, when agent sessions are off, when no default agent is configured, or when the
default agent's executable was not found on this machine. A default agent without an `integrate` prompt of its own MUST
NOT make it unavailable: the integration session then uses the agent-neutral default Integrate prompt.

#### Scenario: One root configured
- **WHEN** the only workspace root is `/w/acme` and the user opens **New project** and types `gamma-tools`
- **THEN** the dialog has `/w/acme` selected and shows `/w/acme/gamma-tools` as the folder that will be created

#### Scenario: Several roots
- **WHEN** the workspace roots are `/w/acme` and `/w/alpha`
- **THEN** the dialog asks the user to pick one of the two and creates nothing until one is picked

#### Scenario: Nothing tracked yet
- **WHEN** no repository is tracked, a workspace root is configured and agent sessions are on
- **THEN** the empty state offers **New project**, active, next to its link to Settings

#### Scenario: No workspace root
- **WHEN** no workspace root is configured
- **THEN** **New project** is inactive and its reason says to add a workspace root in Settings

#### Scenario: Agent sessions are off
- **WHEN** agent sessions are disabled
- **THEN** **New project** is inactive and its reason says that agent sessions are off

#### Scenario: The agent has no Integrate prompt of its own
- **WHEN** a workspace root is configured, agent sessions are on, the default agent's executable is found and its profile carries no `integrate` prompt
- **THEN** **New project** is active

### Requirement: Only a new folder directly inside a workspace root is accepted

The folder SHALL be created directly inside the chosen root. The root MUST be one of the saved configuration's
workspace roots, MUST exist and MUST be a directory. The name MUST be a single path segment that starts with a letter or
digit and contains only letters, digits, `.`, `_` and `-`, at most 100 characters; `.`, `..`, names containing a path
separator and names ending in `.git` MUST be refused. The resulting path MUST NOT exist in any form — file, directory or
symbolic link — and MUST NOT lie in or below an ignore path, a tracked repository's folder or the dashboard's home
directory. Every refusal SHALL give its reason in the dialog and SHALL leave the file system unchanged.

#### Scenario: Name already taken
- **WHEN** `/w/acme/gamma-tools` already exists and the user confirms that name under `/w/acme`
- **THEN** the request is refused with a reason saying the folder exists, and nothing in it is changed

#### Scenario: A path instead of a name
- **WHEN** the user types `../gamma-tools` or `sub/gamma-tools`
- **THEN** the request is refused as an invalid folder name and nothing is created

#### Scenario: A root that is not configured
- **WHEN** a request names `/w/other` as the root while it is not a configured workspace root
- **THEN** the request is refused and nothing is created

#### Scenario: A root inside a tracked repository
- **WHEN** the workspace root `/w/acme/demo-ops/packages` lies inside the tracked repository `/w/acme/demo-ops`
- **THEN** creating a project under it is refused with a reason that names the repository, and nothing is created

#### Scenario: Ignored path
- **WHEN** `/w/acme/scratch` is an ignore path and the user asks for `scratch` under `/w/acme`
- **THEN** the request is refused and nothing is created

### Requirement: Every precondition is checked before anything is written

The dashboard SHALL check every condition that would stop the project from being set up — agent sessions on, a default
agent configured and its executable found, `git` found, the root and name accepted — before it creates the folder. A
refused request MUST create no folder, run no git command and start no process.

#### Scenario: Agent missing
- **WHEN** the default agent's executable is not found and the user confirms a valid name
- **THEN** the request is refused with that reason, no folder exists at the path and no process was started

#### Scenario: git missing
- **WHEN** `git` is not found on this machine
- **THEN** the request is refused with a reason saying git was not found and no folder is created

### Requirement: The dashboard creates one empty git repository and nothing else

On an accepted request the dashboard SHALL create exactly one directory — the new project folder — with an exclusive
create, so that a folder that appeared in the meantime is refused rather than reused, and SHALL then run `git init` in
it with git's own defaults (initial branch name included). The dashboard MUST NOT write any other file in the folder,
MUST NOT run `openspec init` or any other command in it, MUST NOT stage, commit, add a remote or contact a network, and
MUST NOT change the configuration at this point. When `git init` fails, the dashboard SHALL report its error and the
folder's path, SHALL leave the folder as it is — it deletes nothing — and SHALL start no agent.

#### Scenario: What is on disk after creation
- **WHEN** a project `gamma-tools` is created under `/w/acme` and before the agent has done anything
- **THEN** `/w/acme/gamma-tools` contains only `.git`, the repository has no commits and no remote, and the configuration is unchanged

#### Scenario: Concurrent requests
- **WHEN** two requests for `gamma-tools` under `/w/acme` arrive at the same time
- **THEN** exactly one succeeds, the other is refused because the folder exists, and only one agent is started

#### Scenario: git init fails
- **WHEN** `git init` exits with an error in the new folder
- **THEN** the error and the folder's path are shown, the folder is left in place, and no agent is started

### Requirement: The new repository is set up by an integration session

Once `git init` succeeded, the dashboard SHALL start an integration session in the new folder exactly as **Integrate**
does for an integratable repository (`repo-integration` capability): the default agent with its `integrate` prompt, in
place, with no worktree, no branch and no git command for the session, and the session's terminal shown to the user.
Whether the project is set up SHALL be decided by the marker alone, as for any integration: when `openspec/config.yaml`
is found, the project is added to the configuration with `enabled: true` and its default name and a scan starts. When
the session ends without the marker, the new folder stays on disk as a git repository that discovery reports as
integratable, so **Integrate** can be used on it later.

#### Scenario: Hand-off to the agent
- **WHEN** a project is created
- **THEN** an integration session for the new folder is running, its terminal is shown, and it does not appear in Open work or the activity log

#### Scenario: The agent sets it up
- **WHEN** the agent ran `openspec init` and `openspec/config.yaml` exists in the new folder when the session ends or the user runs discovery
- **THEN** the project is tracked with `enabled: true` and appears on the projects overview after the scan

#### Scenario: The agent stops early
- **WHEN** the integration session ends and the new folder holds no `openspec/config.yaml`
- **THEN** the configuration is unchanged and the folder is listed as integratable in Settings

### Requirement: git counts as found by the environment check's rule

The `git` precondition of **New project** SHALL use the rule of the `environment-check` capability's "On macOS the git
placeholder is not git": on a Mac without the command line developer tools the request SHALL be refused as with no
git, before any folder is created.

#### Scenario: A Mac without the developer tools
- **WHEN** the user confirms a valid name on a Mac whose only `git` is Apple's placeholder
- **THEN** the request is refused with a reason saying git was not found, no folder is created and no process was started
