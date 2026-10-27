# Design

## Context

`desktop/src/main.ts` is Electrobun wiring only; decisions belong in `desktop/src/logic/` and are tested by the root
`bun test` (`test/desktop/`). The window shows `http://127.0.0.1:<port>/`; `navigationRules(port)` blocks every other
origin, `follow()` hands blocked navigations and new-window requests to the browser when they are external and
`loadURL`s them when internal. The lock is `<home>/desktop/app.lock`, and with only the pre-rename home it is taken
after the server moved the home, because the app writes nothing into a home before that.

## Decisions

### D1. The losing instance stops its own server

After `waitForServer` says ready and `takeLock()` returns `held`, the app calls `stopServer(spawned)` (setting
`stopping` so the exit handler shows no "stopped unexpectedly" dialog) and then `finalQuit()`. The server has just
started, so no session can be running and there is nothing to ask about.

Rejected: leaving it running for the other instance. Nothing would own it: the other instance treats it as started
elsewhere and, by the attach rule, never stops it. Rejected: taking the lock before the home exists. The app writes
nothing into a home until the server has moved it (`desktop/src/logic/home.ts`), so the lock cannot live there yet;
a lock elsewhere would be a second mechanism for a narrow race.

Residual: if the other instance attached to this server in the second between its start and the lock check, its page
loses the server; the user's Reload then shows the failure, and Quit and relaunch recovers. Accepted for a race that
needs two first launches on an un-migrated home within seconds.

### D2. A pure decision for the window's origin

`windowForPort({ windowPort, port, lastUrl })` returns `{ reload: false }` when the ports match and
`{ reload: true, rules: navigationRules(port), url: appOrigin(port) + "/" }` otherwise. `showWindow` remembers the
window's port, applies the rules, loads the URL and clears `lastUrl` when told to. Rejected: translating `lastUrl` to the
new port. The page after a restart re-reads its state anyway, and `/` is the one URL certain to exist.

### D3. Same-origin new windows go to the browser

`newWindowTarget(url, port)` returns the same as `externalTarget` but maps `internal` to `external` for the
new-window event; `follow` loses its `inWindow` flag for this path. Rejected: ignoring the request — the link would
look dead. Rejected: `loadURL` into the window — what happens today and what loses the terminals. No UI control is meant to open
a same-origin URL in a new window; after D4 the Markdown renderer does not either, so this is the backstop.

### D4. Relative links resolve to the change's own files or are text

`renderMarkdown(text, { resolve?(href): string | undefined })`. Without a resolver (What's new), relative targets are
text. The detail view's resolver joins the target with the shown file's directory, normalises `.`/`..`, strips `#…` and
`?…`, refuses a result outside the change, and returns the detail URL with `file=<path>` only when the path is one of
the files the view lists for the change. Such links render without `target="_blank"` and are handled by the router in
place. `safeHref` keeps judging only absolute targets (`http:`, `https:`, `mailto:`).

Rejected: rendering all relative links as text. Links between a proposal, its design and its delta specs are common and
useful; resolving them to the file view costs one pure function.

## Risks

- A relative link that worked by accident — none can today: it resolved against the dashboard's route.
