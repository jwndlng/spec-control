## ADDED Requirements

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
