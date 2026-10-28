# environment-check Specification

## Purpose
Defines the environment report: the checks the dashboard makes of the machine it runs on — the tools, credentials and
directories that the dashboard and the agents it starts depend on — so that a missing or unconfigured prerequisite is
stated up front instead of failing silently later inside an agent's terminal.

## Requirements

### Requirement: The environment report is a list of named checks
The dashboard SHALL produce an **environment report**: a list of checks of the machine it runs on, each with a stable
identifier, a human label, a status, a one-line statement of what was found, and, when the status is not `ok`, one line
on how to fix it. The statuses SHALL be exactly `ok` (the check found what it needs), `warning` (the dashboard works,
but something the user relies on will fail or be unavailable), `problem` (something the dashboard itself needs is
missing) and `not-needed` (the feature that requires it is switched off). The report SHALL also carry the time it was
computed and an overall status, which is the worst status of any check in the order `problem`, `warning`, `ok`,
`not-needed`. The order of the checks in the report SHALL be stable, so that the report reads the same each time.

#### Scenario: Everything in place
- **WHEN** the report is computed on a machine that has every prerequisite
- **THEN** every check has the status `ok` or `not-needed`, the overall status is `ok`, and no check carries a remedy

#### Scenario: One missing tool
- **WHEN** the `openspec` CLI is not on the PATH
- **THEN** its check has a status other than `ok`, says that it was not found, carries a line on how to install it, and the overall status is not `ok`

#### Scenario: The worst status wins
- **WHEN** one check is `problem`, three are `warning` and the rest are `ok`
- **THEN** the overall status is `problem`

### Requirement: The report checks the tools, identity, credentials and home directory
The report SHALL contain these checks and no others:
- **git** (`git`): whether a `git` executable is found on the PATH, and where.
- **Git committer identity** (`git-identity`): whether `user.name` and `user.email` are configured for this user, read
  with `git config --get`; the check SHALL name whichever of the two is missing.
- **OpenSpec CLI** (`openspec-cli`): whether an `openspec` executable is found on the PATH, and where.
- **One check per configured agent** (`agent:<agent id>`): whether the first element of that agent's command is found on
  the PATH, and where. The check SHALL say which agent it is and whether that agent is the default one.
- **GitHub CLI** (`github-cli`): whether a `gh` executable is found on the PATH and whether credentials for it are
  configured on this machine — either `GH_TOKEN` or `GITHUB_TOKEN` is set in the environment, or `gh`'s own host
  configuration file exists and is not empty, which SHALL be established without reading its contents. The check SHALL
  distinguish "not installed" from "no credentials found", and SHALL say that it looked for credentials rather than
  claim there are none.
- **Dashboard home** (`dashboard-home`): whether the dashboard's home directory exists or can be created and whether a
  file can be written in it. While the home migration of the `dashboard-api` capability has steps left to retry, could
  not move the former home `~/.openspec-dashboard/`, or found it left as a directory next to `~/.spec-control/`, a
  writable home SHALL be reported as `warning`, naming what is left and why, with a remedy; otherwise it SHALL say
  nothing about the former home.

#### Scenario: git is found
- **WHEN** `git` is on the PATH
- **THEN** the `git` check is `ok` and states the path it was found at

#### Scenario: Only the email is configured
- **WHEN** `user.email` is configured for this user but `user.name` is not
- **THEN** the `git-identity` check is not `ok` and says that `user.name` is the one that is missing

#### Scenario: One check per agent
- **WHEN** the user has configured three agent profiles
- **THEN** the report has three checks with the identifiers `agent:<id>` of those three profiles, and the one for the default agent says so

#### Scenario: gh installed without credentials
- **WHEN** `gh` is on the PATH, neither `GH_TOKEN` nor `GITHUB_TOKEN` is set and `gh` has no host configuration file
- **THEN** the `github-cli` check is not `ok`, says that `gh` is installed but no credentials were found, and its remedy names `gh auth login`

#### Scenario: The host file is not read
- **WHEN** `gh`'s host configuration file exists and holds a token
- **THEN** the `github-cli` check reads as configured and the file's contents were never read

#### Scenario: gh not installed
- **WHEN** no `gh` executable is on the PATH
- **THEN** the `github-cli` check says that `gh` was not found, not that credentials are missing

#### Scenario: Home directory not writable
- **WHEN** the dashboard's home directory cannot be written to
- **THEN** the `dashboard-home` check is `problem` and names the directory

#### Scenario: A migration step is still pending
- **WHEN** the home was moved but one session worktree could not be re-registered because its repository was missing
- **THEN** the `dashboard-home` check is `warning`, names that worktree and the reason, and says the dashboard retries on the next start

#### Scenario: Former home left next to the new one
- **WHEN** `~/.openspec-dashboard/` and `~/.spec-control/` both exist as directories
- **THEN** the `dashboard-home` check is `warning`, names `~/.openspec-dashboard/` as no longer used, and the dashboard uses `~/.spec-control/`

### Requirement: The report is computed locally, reads nothing from a tracked repository and contacts no network
Computing the report MUST NOT contact a network, MUST NOT read or write anything inside a tracked repository, and MUST
NOT write anywhere but the dashboard's own home directory, where its only write is the probe of the `dashboard-home`
check, which SHALL remove what it wrote. The only process it may start is `git config --get`, which MUST run with a
working directory outside every tracked repository; no other external command SHALL be run, and in particular no
command that validates a credential. Executable lookups SHALL search the PATH without executing what they find.

#### Scenario: No network
- **WHEN** the report is computed
- **THEN** no network connection is opened

#### Scenario: Tracked repositories are untouched
- **WHEN** the report is computed while repositories are tracked
- **THEN** no file under any of them, including their git config and index, is read for the report, created, modified or deleted

#### Scenario: Nothing is executed to check it exists
- **WHEN** the configured agent's command names an executable that is found on the PATH
- **THEN** the report says it was found without having run it

#### Scenario: The write probe leaves nothing behind
- **WHEN** the `dashboard-home` check succeeds
- **THEN** the dashboard's home directory holds no file that the probe created

### Requirement: Credentials are never read, stored or returned
The report MUST NOT read, store, log or return the value of any credential. It MAY report that `GH_TOKEN` or
`GITHUB_TOKEN` is set, by name only, and that `gh`'s host configuration file exists, without reading a token out of it.
No text in the report may contain a token, a password or a URL with credentials embedded in it.

#### Scenario: A token is named, never shown
- **WHEN** `GH_TOKEN` is set and the report is returned
- **THEN** the report says that `GH_TOKEN` is set and its value appears nowhere in the response

### Requirement: Which checks are needed follows the configuration
Whether a check matters SHALL be derived from the current configuration and the last scan, never hardcoded:
- While agent sessions are disabled, the per-agent checks, the `git-identity` check and the `github-cli` check SHALL be
  `not-needed`, and SHALL say which setting makes them so.
- While agent sessions are enabled, a missing executable SHALL be `problem` for the default agent, for the agent the main
  console runs and for any agent selected by an enabled repository, and `warning` for a configured agent that none of
  them uses. A missing
  committer identity or missing GitHub credentials SHALL be `warning`, because only an agent's own commit or pull
  request needs them.
- A missing `git` SHALL be `problem` when at least one enabled repository was scanned as a git repository, and
  `warning` otherwise, because a tracked folder without git is supported.
- A missing `openspec` CLI SHALL be `warning`.
- A `dashboard-home` failure SHALL be `problem`.

#### Scenario: Agent sessions off
- **WHEN** agent sessions are disabled and neither an agent executable nor `gh` is installed
- **THEN** the per-agent checks, `git-identity` and `github-cli` are `not-needed` and say that agent sessions are off, and the overall status is not `problem` because of them

#### Scenario: The default agent is missing
- **WHEN** agent sessions are enabled and the default agent's executable is not found
- **THEN** its check is `problem`

#### Scenario: An unused agent is missing
- **WHEN** agent sessions are enabled, a second agent profile is configured that neither the main console nor any enabled repository selects, and its executable is not found
- **THEN** its check is `warning`, not `problem`

#### Scenario: The console agent is missing
- **WHEN** agent sessions are enabled, the main console uses a second agent profile that no enabled repository selects, and its executable is not found
- **THEN** its check is `problem`

#### Scenario: Only folders without git are tracked
- **WHEN** `git` is not installed and every enabled repository was scanned as a folder without git
- **THEN** the `git` check is `warning`

#### Scenario: A git repository is tracked
- **WHEN** `git` is not installed and an enabled repository was scanned as a git repository
- **THEN** the `git` check is `problem`

### Requirement: The report states what it cannot know
Because the report contacts no network, it SHALL state plainly that it can only see that GitHub credentials are
configured, not that they are still valid, and that an expired or revoked credential therefore reads as configured. It
MUST NOT claim that an agent will succeed, that a pull request can be opened, or that a credential works.

#### Scenario: A configured credential is not a valid one
- **WHEN** `gh`'s host configuration exists and the stored credential has expired
- **THEN** the `github-cli` check reads as configured and the report says that validity is only known when the agent uses it

### Requirement: The report is computed on request, never on a timer
The report SHALL be computed when it is requested and MAY be reused for at most 10 seconds. It MUST NOT be computed on
the scan poll interval, on the auto-refresh interval, during a scan or during discovery. The dashboard SHALL request it
when the UI loads, after the configuration was saved, and when the user asks for it again; a saved configuration SHALL
therefore always be reflected by the next report.

#### Scenario: Scans do not compute it
- **WHEN** the dashboard runs scans on its poll interval for an hour and nobody opens Settings
- **THEN** the report was not computed and no `git config` process was started for it

#### Scenario: Saving settings updates it
- **WHEN** the user adds an agent profile in Settings and saves
- **THEN** the next report has a check for that agent

#### Scenario: Re-check recomputes
- **WHEN** the user installs the missing tool and asks for the report again
- **THEN** the report is recomputed and that check is `ok`

### Requirement: Settings shows the report in its own section
The Settings page SHALL show the report in a section listing every check in the report's order with its label, its
status, what was found and, when there is one, its remedy. Status MUST be conveyed by text as well as colour. A
`not-needed` check SHALL be visually de-emphasised and still readable, so the user can see what would be checked if the
feature were on. The section SHALL offer **Re-check**, which requests a fresh report and marks itself as working while
it does; it MUST NOT be part of the page's unsaved-changes draft and MUST NOT save anything. While the report has not
loaded, the section SHALL say so; when it could not be loaded, it SHALL say that and keep **Re-check** available.

#### Scenario: A problem is explained
- **WHEN** the `openspec` CLI is missing and the user opens the Environment section
- **THEN** the section lists the OpenSpec CLI check with a non-`ok` status in text, says it was not found, and shows the line on how to install it

#### Scenario: Re-check
- **WHEN** the user presses **Re-check**
- **THEN** the control shows that it is working, the list is replaced by the fresh report, and the save bar still shows no unsaved changes

#### Scenario: Checks that are not needed
- **WHEN** agent sessions are disabled
- **THEN** the GitHub CLI check is listed, de-emphasised, saying that it is not needed while agent sessions are off

#### Scenario: The report could not be loaded
- **WHEN** the request for the report fails
- **THEN** the section says that the environment could not be checked and **Re-check** is still offered

### Requirement: Checks that are not ok carry instructions for this platform
A check whose status is `warning` or `problem` SHALL carry, besides its one-line remedy, **instructions**: an ordered
list of steps, each a short text and optionally one command to run in a terminal. The instructions SHALL be chosen for
the operating system the server runs on — macOS, Linux and Windows at least — and SHALL name only commands the user runs
themselves; the dashboard MUST NOT run them. For `git`, `openspec-cli` and `github-cli` the instructions SHALL name an
install command for the platform (for `github-cli` with no credentials found, `gh auth login` instead); for
`git-identity`, the `git config --global` commands for whichever of `user.name` and `user.email` is missing. For an agent
check, the instructions SHALL come from the agent's preset when its id is a preset's, and otherwise SHALL say to install
the program named by the profile's command or to change that command in Settings. A check that is `ok` or `not-needed`
SHALL carry no instructions. Wherever the report is shown — Settings' Environment section and the setup wizard — the
instructions SHALL be shown with the check, each command in a form that can be copied with one action. Instructions
MUST NOT contain a credential.

#### Scenario: openspec missing on macOS
- **WHEN** the server runs on macOS and `openspec` is not on the PATH
- **THEN** the `openspec-cli` check carries a step with an install command for the OpenSpec CLI

#### Scenario: gh installed without credentials
- **WHEN** `gh` is on the PATH and no credentials were found
- **THEN** the `github-cli` check's instructions name `gh auth login` and do not name an install command

#### Scenario: Only the name is missing
- **WHEN** `user.email` is configured but `user.name` is not
- **THEN** the `git-identity` instructions name `git config --global user.name` and not `user.email`

#### Scenario: A preset agent is missing
- **WHEN** the Codex profile is configured and `codex` is not found
- **THEN** its check carries the Codex preset's install command

#### Scenario: A custom agent is missing
- **WHEN** a profile with command `my-agent-cli` is configured and not found
- **THEN** its check says to install `my-agent-cli` or change the command in Settings, with no command to copy

#### Scenario: Shown in Settings
- **WHEN** the `git` check is `problem` and the user opens Settings' Environment section
- **THEN** the check shows its instructions with a copy control for the install command

#### Scenario: Nothing for a healthy check
- **WHEN** the `git` check is `ok`
- **THEN** it carries no instructions

### Requirement: The setup view leaves agents out
The environment report SHALL also be available in a **setup view**, used by the setup wizard's System check step before
the user has chosen agents or a workspace. It SHALL contain the same checks as the report, computed
under the same rules, except the per-agent checks, which it SHALL leave out because the wizard's Agents step checks each
agent itself. Because setup is about to use them, it SHALL NOT derive whether a check matters from the current
configuration: a missing `git` SHALL be `problem`, because every agent session's worktree needs it; a missing
committer identity, a missing GitHub CLI or GitHub credentials not found, and a missing `openspec` CLI SHALL be
`warning`; a `dashboard-home` failure SHALL be `problem`. No check in the setup view SHALL be `not-needed`. Its overall
status SHALL be derived from those checks alone. The Settings view of the report is unchanged.

#### Scenario: Fresh installation without gh
- **WHEN** agent sessions are off, no repository is tracked, `git` is found and `gh` is not
- **THEN** the setup view lists `git` as `ok` and `github-cli` as `warning` with its install instructions, while the Settings view lists `github-cli` as `not-needed`

#### Scenario: git missing before anything is tracked
- **WHEN** no repository is tracked and `git` is not found
- **THEN** the setup view lists `git` as `problem`, while the Settings view lists it as `warning`

#### Scenario: No agent checks
- **WHEN** the Claude Code and Codex profiles are configured
- **THEN** the setup view contains no `agent:` check, and the Settings view still contains both

### Requirement: On macOS the git placeholder is not git

Wherever the dashboard decides whether `git` is found on this machine, it SHALL take the first `git` executable on the
PATH. On macOS, when that executable is `/usr/bin/git`, git SHALL count as found only when the active developer
directory holds `usr/bin/git`, the active developer directory being, in this order, the directory `DEVELOPER_DIR`
names, the target of `/var/db/xcode_select_link`, `/Applications/Xcode.app/Contents/Developer`, or
`/Library/Developer/CommandLineTools`, whichever exists first. This SHALL be established with file-system lookups only:
no process SHALL be started for it, and `/usr/bin/git` MUST NOT be run to find out. When git does not count as found,
the `git` check SHALL NOT be `ok`, SHALL say that `/usr/bin/git` is Apple's placeholder and the command line developer
tools are not installed, and SHALL carry the macOS install instruction `xcode-select --install`; the `git-identity`
check SHALL start no process and SHALL say that the identity could not be read because git was not found, with that
install instruction before the `git config --global` steps. On other platforms git counts as found whenever a `git`
executable is on the PATH.

#### Scenario: A Mac without the developer tools
- **WHEN** the server runs on macOS, the first `git` on the PATH is `/usr/bin/git`, and no active developer directory holds `usr/bin/git`
- **THEN** the `git` check is not `ok`, names the placeholder, and its instructions name `xcode-select --install`, and no `git` process was started for the report

#### Scenario: A Mac with the developer tools
- **WHEN** the first `git` on the PATH is `/usr/bin/git` and `/var/db/xcode_select_link` points to a directory holding `usr/bin/git`
- **THEN** the `git` check is `ok` and states `/usr/bin/git`, and `git-identity` is read with `git config --get`

#### Scenario: A git before the placeholder
- **WHEN** the server runs on macOS without the developer tools and `/opt/homebrew/bin/git` comes before `/usr/bin` on the PATH
- **THEN** the `git` check is `ok` and states `/opt/homebrew/bin/git`

#### Scenario: A git only after the placeholder
- **WHEN** the server runs on macOS without the developer tools, `/usr/bin` comes first on the PATH and another `git` comes later
- **THEN** the `git` check is not `ok`, because the placeholder is the one every git command would run
