## ADDED Requirements

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
