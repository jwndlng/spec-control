# Design

## Context

`whichOnPath("git")` is `Bun.which` over `PATH`. On macOS `/usr/bin/git` is one of the `xcrun` placeholders: it runs
the tool from the active developer directory, or, when there is none, triggers the system's offer to install the
command line developer tools and fails. The environment report may start only `git config --get`
(environment-check: "The only process it may start is `git config --get`").

## Decisions

### D1. Find the developer directory on disk, not with `xcode-select -p`

`xcode-select -p` would answer directly and does not open the dialog, but it is a second process in a report that
promises to start only `git config --get`, and it would be a new external command for New project and Add from GitHub
too. Its answer is the active developer directory, which can be found with the same lookups it makes: `DEVELOPER_DIR`,
then the link `/var/db/xcode_select_link`, then the default Xcode location, then
`/Library/Developer/CommandLineTools`. Git is there when `<dir>/usr/bin/git` is a file. These are `stat` and `realpath`
calls on system paths, outside every tracked repository.

Rejected: changing the spec to allow `xcode-select -p`. The file-system answer is enough and keeps the rule simple.
If Apple changes the resolution order, the worst case is the behaviour of today, not a dialog the user did not ask for.

### D2. The first `git` on the PATH decides

Every git command the dashboard runs resolves `git` through the PATH, so a real git later on the PATH does not help
while `/usr/bin/git` comes first: the placeholder is what would run. The check therefore looks at the first match only;
when that is `/usr/bin/git` without developer tools, git is not found, and the `found` text says that a git placed
before `/usr/bin` on the PATH would also do. A Homebrew git first on the PATH is found as today.

### D3. One helper for every "is git there" question

`gitExecutable()` in `src/server/paths.ts` replaces `whichOnPath("git")` in the environment report, New project,
Add from GitHub and the clone list's `gitAvailable`, so the four places cannot disagree. On Linux and Windows it is
exactly `whichOnPath("git")`.
