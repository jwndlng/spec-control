# Proposal

## Why

Three defects in the macOS app's window handling, one of them caused by the Markdown renderer:

- **A started server can be orphaned.** `startServer` in `desktop/src/main.ts` ends with
  `if ((await takeLock()) === "held") return finalQuit();`. When only the pre-rename home exists at launch, the
  single-instance lock is taken only after the server has moved the home — so another launch can take it first. The app
  then quits without `stopServer(spawned)`, and the `spec-control` it started keeps listening on the port with no
  owner: nothing will ever stop it, and the next app launch attaches to it as "started elsewhere".
- **Retry does not follow a changed port.** After the server stopped and the user chose **Retry**, `start()` re-reads
  the configured port, but an existing window only gets a new title (`showWindow`). Its page, its
  `navigationRules(oldPort)` and `lastUrl` keep the old port, while `follow()` judges links against the new one: the
  dashboard's own links are handed to the browser, and **Reload** loads the old, dead port.
- **A relative link in a repository's Markdown replaces the window's page.** `safeHref` in `src/ui/markdown.tsx` keeps
  relative targets and renders every link `target="_blank"`. `[design](./design.md)` in a proposal resolves against the
  dashboard's URL — a meaningless route — and in the app the same-origin new-window request is treated as internal and
  `loadURL`ed into the main window (`follow(url, false)`), losing open terminals and page state. In a browser it opens
  a useless tab.

## What Changes

- **Exiting stops what the app started.** The lock-held branch after start stops the spawned server (like Quit, with
  the grace period) before quitting. The rule is stated for every exit path.
- **Retry moves the window to the new origin** when the port changed: new navigation rules, a load of the new `/`,
  `lastUrl` cleared. Unchanged port: title only, as today. The decision is a pure function in
  `desktop/src/logic/links.ts`.
- **A same-origin new-window request goes to the default browser** instead of replacing the window's page; in-window
  navigation is unchanged.
- **Relative links in artifacts link to the change's own files, in place, or are text.** A relative target that names
  a file the detail view lists for the change becomes an in-view link selecting that file; anything else relative
  (leaving the change, unknown file, bare fragment) is plain text, and What's new never renders a relative link.

## Non-goals

- Reacting when a server the app only attached to stops (no watcher is added).
- Following links to files outside the change, such as the main specs.
- Any new network access: the app still requests only `127.0.0.1`, and handing a URL to the browser is the user's
  link, as for other origins.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `desktop-app`: the app never leaves a server it started behind; after Retry the window follows the server's port; a
  request for a new window never replaces the window's page.
- `change-detail`: "Repository content is treated as untrusted" — relative link targets.

## Order and overlaps

- `manual-tasks-need-you` (in flight) touches `src/ui/changeDetail.tsx` for the tasks view; this change touches its
  Markdown rendering call only (passing the file list and the current file). Small, separate hunks.
- No in-flight change touches `desktop/` or `src/ui/markdown.tsx`.

## Impact

- `desktop/src/main.ts` — `startServer`'s lock-held branch stops `spawned`; `showWindow` applies the port decision;
  `new-window-open` hands same-origin URLs to the browser.
- `desktop/src/logic/links.ts` — `windowForPort(current, next, lastUrl)` (rules, URL to load, whether to reload) and
  `newWindowTarget(url, port)`; `desktop/src/logic/quit.ts` if the exit-path rule needs a helper (`exitPlan`).
- `src/ui/markdown.tsx` — `renderMarkdown(text, links?)` with a resolver for relative targets; `safeHref` no longer
  returns relative targets; `src/ui/changeDetail.tsx` — passes the resolver (current file, listed files, detail URL);
  `src/ui/routes.ts` — the detail URL with `file=` if a helper is missing.
- Tests: `test/desktop/links.test.ts` (port switch, same port, new-window target), `test/desktop/quit.test.ts` (exit
  path stops an owned server, never an attached one), `test/markdown.test.ts` (the three change-detail link scenarios,
  What's new without relative links, the existing dangerous-target cases), `test/changeDetail.test.ts` if the resolver
  is exercised through the view.
- `src/ui/changelog.ts` — What's new entry.
- `CLAUDE.md` — the `desktop/` paragraph says "links to other hosts open in the default browser"; add that a
  same-origin new-window request does too.
- No new git command, write to a repository, or network access; invariants 1–7 hold.
