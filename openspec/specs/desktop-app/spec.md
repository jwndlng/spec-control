# desktop-app Specification

## Purpose

Defines the macOS desktop app: a thin application shell that runs the same `spec-control` binary as the command line,
shows it in its own window — without changing what the server does or adding network access.

## Requirements

### Requirement: The app is for Apple silicon Macs
The app SHALL be built for macOS on Apple silicon (`darwin-arm64`) and SHALL require the oldest macOS version its framework supports, stated in the README. Intel Macs SHALL keep being served by the `darwin-x64` command-line binary, which the README SHALL name as their way to run Spec Control.

#### Scenario: Intel Mac user
- **WHEN** a user on an Intel Mac reads the README's Run section
- **THEN** it tells them to use the `darwin-x64` binary instead of the app

### Requirement: The app runs the bundled binary and adds no server of its own
The app SHALL bundle the `spec-control` binary built from the same release and SHALL serve the dashboard only by running that binary as a child process with `--no-open`, on the port the binary would use when started from the command line (its configured port, default 4711). The app MUST NOT serve the UI or the API itself, MUST NOT pass the binary any option that changes what the server reads, writes or contacts, and MUST NOT bind any port of its own. Everything the dashboard-api capability guarantees about the server SHALL hold unchanged inside the app.

#### Scenario: First launch
- **WHEN** the user opens the app and nothing listens on port 4711
- **THEN** the bundled binary is started with `--no-open`, and the app window shows the dashboard once `GET /api/version` answers

#### Scenario: Same home as the command line
- **WHEN** the user has tracked repositories with the command-line binary and then opens the app
- **THEN** the app shows the same projects, settings and session history, read from the same `~/.spec-control/`

#### Scenario: The server fails to start
- **WHEN** the bundled binary exits before `GET /api/version` answers
- **THEN** the app shows a window stating that the server could not start, with the binary's last output and a Retry action, and starts nothing else

### Requirement: The app reuses a running Spec Control and never takes over another program's port
Before starting the binary the app SHALL request `GET /api/version` on the configured loopback port. When a Spec Control answers, the app SHALL show that server instead of starting its own, SHALL say in its window that it is attached to a server started elsewhere and which version it runs, and MUST NOT stop that server when it quits. When the port is held by anything else, the app MUST NOT start the binary on another port and MUST NOT stop the other program; it SHALL show which port is taken and how to choose another one. Only one instance of the app SHALL run at a time; opening it again SHALL bring the existing window forward.

#### Scenario: A command-line instance is already running
- **WHEN** `spec-control` was started in a terminal and the user opens the app
- **THEN** the app shows that server, names it as started elsewhere, and quitting the app leaves it running

#### Scenario: Port taken by another program
- **WHEN** another program listens on port 4711 and answers `GET /api/version` with anything but a Spec Control body
- **THEN** the app starts no server and explains that port 4711 is in use and how to set a different port

#### Scenario: Opened twice
- **WHEN** the app is already running and the user opens it again from the Dock or Finder
- **THEN** no second instance or server starts and the existing window comes to the front

### Requirement: The window loads the loopback origin directly
The app window SHALL load `http://127.0.0.1:<port>/` and nothing else as its page, so that every request the page makes carries the server's own origin and passes the server's cross-site and WebSocket guards unchanged. The app MUST NOT serve the page from a custom scheme, a file or a proxy, MUST NOT inject scripts into the page, and MUST NOT expose any bridge from the page to the app's own process. Navigation within the window SHALL be limited to that origin: a link to any other origin, whether it opens a new window or not, SHALL open in the user's default browser and the app window SHALL stay where it is.

#### Scenario: Terminal works inside the app
- **WHEN** the user opens an agent session's terminal in the app window
- **THEN** the terminal WebSocket is accepted, because its `Origin` is `http://127.0.0.1:<port>`

#### Scenario: Pull request link
- **WHEN** the user clicks a pull request link to github.com in the app window
- **THEN** it opens in the default browser and the app window keeps showing the dashboard

#### Scenario: No bridge into the app
- **WHEN** the page's scripts look for any app-provided global or message channel
- **THEN** none exists

### Requirement: Tools are found as in the user's shell
Before starting the binary the app SHALL determine the `PATH` the user's login shell sets, by running the user's shell (`$SHELL`, else `/bin/zsh`) as a non-interactive login shell that prints only its environment's `PATH`, with a time limit of five seconds, and SHALL start the binary with that `PATH`. When the shell fails, times out or prints no `PATH`, the app SHALL start the binary with the standard macOS `PATH` extended by `/opt/homebrew/bin` and `/usr/local/bin`, and the environment report SHALL show which tools are then missing as it does today. The app MUST NOT read, store or pass on any other variable from that shell, and MUST NOT run the shell for anything else.

#### Scenario: Opened from Finder with Homebrew tools
- **WHEN** `gh` and the agent CLI are installed under `/opt/homebrew/bin` and the user opens the app from Finder
- **THEN** the environment report finds both and agent sessions start

#### Scenario: Shell does not answer
- **WHEN** the user's login shell does not finish within five seconds
- **THEN** the binary is started with the fallback `PATH` and the app shows no error beyond what the environment report states

### Requirement: Closing the window keeps the work running; quitting asks while sessions run
Closing the app window SHALL hide it and keep the server and every agent session running; the app SHALL stay reachable from a menu bar item offering **Open Spec Control**, **Releases Page** and **Quit Spec Control**. **Quit** SHALL stop a server the app started the same way `Ctrl+C` stops the command-line binary, so running sessions end as resumable. When the app started the server and at least one agent session is running, Quit SHALL first ask for confirmation, naming how many sessions will stop; cancelling SHALL leave everything running. Quitting MUST NOT kill the server without first giving it the chance to end its sessions.

#### Scenario: Close the window during a session
- **WHEN** an agent session runs and the user closes the app window
- **THEN** the session keeps running, the menu bar item remains, and **Open Spec Control** shows the same session

#### Scenario: Quit with running sessions
- **WHEN** two agent sessions run in a server the app started and the user chooses Quit
- **THEN** the app asks whether to stop 2 running sessions, and only on confirmation stops the server, which ends them as resumable

#### Scenario: Quit with no sessions
- **WHEN** no agent session runs and the user chooses Quit
- **THEN** the app stops the server and exits without asking

### Requirement: Standard editing and view commands work in the window
The app SHALL provide the standard macOS application menu with Undo, Redo, Cut, Copy, Paste, Select All, Reload, the zoom commands, Releases Page and Quit, so that keyboard shortcuts such as ⌘C and ⌘V work in the dashboard's fields and its terminals.

#### Scenario: Paste into a terminal
- **WHEN** the user copies text in another application and presses ⌘V in an agent terminal in the app
- **THEN** the text is pasted into the terminal

### Requirement: The app makes no network request of its own
The app's own process MUST NOT contact any network: it requests only the loopback server it started or attached to. The server's network access stays exactly as the dashboard-api capability defines it, which includes the server's update check of the `update-notice` capability; the app MUST NOT pass the server any option that changes whether it checks. A newer version SHALL be noticed through that check's banner, which the app's window shows because it shows the server's page. The app SHALL offer a **Releases Page** item in its application menu and its menu bar item that opens this project's GitHub releases page in the default browser, which is how the user finds and installs a newer version.

#### Scenario: Idle app
- **WHEN** the app runs for a day with the update check turned off and nobody using the pull action or a pull-request or issue query
- **THEN** no process of the app or its server has made a request to any host other than `127.0.0.1`

#### Scenario: Idle app with the update check on
- **WHEN** the app runs for a day with the update check on and nobody using the pull action or a pull-request or issue query
- **THEN** the only request to a host other than `127.0.0.1` is the server's update check, and the app's own process has made none

#### Scenario: Looking for a new version
- **WHEN** the user chooses Releases Page
- **THEN** the releases page opens in the default browser and the app makes no request itself

#### Scenario: New version in the app window
- **WHEN** the server the app shows has learned of a newer release
- **THEN** the app window shows the update banner, and its links open in the default browser

### Requirement: The disk image shows how to install the app
The app SHALL be distributed as a disk image whose volume is named **Spec Control**, carries the app's icon and holds the app, a link to `/Applications` and the window layout, and nothing else visible. Opened in Finder, the volume's window SHALL show an icon view at a fixed size with no toolbar, status bar or sidebar, the app on the left and the `Applications` link on the right, over a background with an arrow from the app to `Applications` and the line "Drag Spec Control to Applications to install it." The background SHALL be generated when the app is built, at the window's size and at twice that size for Retina displays; no image file SHALL be checked in for it. Laying out the disk image MUST NOT change the app it holds: its files, its code signature and how it is unpacked on first launch SHALL be exactly what the app build produced. A build signed with a Developer ID SHALL keep the disk image the app build produced, unstyled, rather than lose its signature or notarisation. When the layout cannot be produced, the build SHALL fail and say why, instead of leaving an unstyled image in its place.

#### Scenario: Opening the downloaded disk image
- **WHEN** a user opens `Spec-Control-v0.4.0-darwin-arm64.dmg` in Finder
- **THEN** a window titled Spec Control shows the app icon, an arrow and the Applications folder, with the line telling them to drag the app to Applications

#### Scenario: Installing by dragging
- **WHEN** the user drags Spec Control onto the Applications folder in that window
- **THEN** the app is copied to `/Applications/Spec Control.app` and opens from there like any other copy of it

#### Scenario: The app inside is unchanged
- **WHEN** the app is taken out of the styled disk image
- **THEN** it has the same files as the app the build packaged and passes `codesign --verify --deep --strict`

#### Scenario: Finder cannot lay out the volume
- **WHEN** a local build runs in a terminal that is not allowed to control Finder
- **THEN** the build fails with a message saying to allow the terminal to control Finder, and no unstyled image replaces the styled one silently

### Requirement: The app never leaves a server it started behind
Whenever the app exits while a server it started is still running, it SHALL first stop that server the same way Quit
does — like `Ctrl+C`, with the same grace period before it is killed — so that no `spec-control` process the app
started outlives it. This SHALL hold for every way the app exits, including when it finds, after starting its server,
that another instance of the app holds the single-instance lock (which can happen when only the pre-rename home existed
at launch, because the lock is taken once the server has moved it). A server the app attached to and did not start
SHALL still never be stopped.

#### Scenario: Another instance took the lock while the server started
- **WHEN** only the pre-rename home exists, the app starts its server, the server moves the home, and the app then finds the lock held by another instance
- **THEN** the app stops the server it started, waits for it to exit (or kills it after the grace period), and only then quits; nothing it started listens on the port afterwards

#### Scenario: Attached server is left alone
- **WHEN** the app attached to a Spec Control started elsewhere and then exits for any reason
- **THEN** that server keeps running

### Requirement: After Retry the window follows the server's port
When **Retry** starts or attaches to a server on a port other than the one the open window was set up for — because the
configured port changed — the app SHALL switch the window to the new origin before showing it: the navigation rules
SHALL allow only `http://127.0.0.1:<new port>/`, the window SHALL load that origin's `/`, the last page remembered for
**Reload** SHALL be cleared, and links SHALL be judged against the new origin. The old origin SHALL then count as another
origin like any other. When the port did not change, Retry SHALL keep the window's page and only update its title, as
today. Which origin a window must show and whether its page must be reloaded SHALL be decided by a function in
`desktop/src/logic/` that the root tests cover.

#### Scenario: Port changed before Retry
- **WHEN** the server the app started on port 4711 stopped unexpectedly, the configured port is now 4712, and the user chooses Retry
- **THEN** the server is started on 4712, the window loads `http://127.0.0.1:4712/`, its own links stay in the window, and **Reload** loads `http://127.0.0.1:4712/`, never port 4711

#### Scenario: Same port
- **WHEN** the server stopped unexpectedly, the configured port is unchanged, and the user chooses Retry
- **THEN** the window keeps its page and gets the new title

### Requirement: A request for a new window never replaces the window's page
A link or script that asks for a new window (`target="_blank"`, `window.open`) on the server's own origin SHALL NOT
change what the app window shows: the app SHALL hand that URL to the default browser, as it does for other origins, and
the window SHALL keep its page, its open terminals and its state. Links to other origins SHALL keep opening in the
default browser, and a same-origin navigation within the window, without a new window, SHALL stay in the window as
today. This decision SHALL be made by `desktop/src/logic/links.ts` and covered by the root tests.

#### Scenario: Same-origin link that asks for a new tab
- **WHEN** an agent terminal is open in the app window and the page opens `http://127.0.0.1:4711/repo/demo-ops` in a new window
- **THEN** that URL opens in the default browser, and the app window still shows the terminal with its session

#### Scenario: In-window navigation is unchanged
- **WHEN** the user follows a link from the board to a change's detail view in the app window
- **THEN** it opens in the window, as before
