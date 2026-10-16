# Proposal

## Why

In the macOS app, clicking a link to another host — a pull request, an issue, the release notes in the header or the
update banner, a link in a rendered artifact — does nothing: the window stays put and no browser opens. The
`desktop-app` spec already requires that "a link to any other origin, whether it opens a new window or not, SHALL open
in the user's default browser"; the app does not do it.

The window's navigation rules block every origin but the server's, as intended, and Electrobun then reports the blocked
navigation as a `will-navigate` event. `desktop/src/main.ts` reads that event as `event.data.allowed`, but Electrobun
2.0.2 delivers it as `{ detail: "<JSON string>" }` — the native layer sends `{"url":"…","allowed":false}` as text, and
only `new-window-open` is parsed into an object before it reaches the main process. So `allowed` is always `undefined`,
the check `allowed === false` never holds, and the blocked link is dropped silently. `target="_blank"` links, which
every external link in the UI uses, go through the same navigation policy and are blocked before any
`new-window-open` is sent, so they end up on the same broken path. The unit tests passed because they asserted the
shape the code assumed (`{ url, allowed: false }`), not the one Electrobun sends.

## What Changes

- The decision "this event is a blocked navigation, and to this URL" moves into `desktop/src/logic/links.ts` as one
  function that reads `allowed` and `url` from every shape Electrobun 2.0.2 sends — `detail` as a JSON string, `detail`
  as an object, or the fields directly — and `main.ts` calls it instead of reading `data.allowed`.
- A link that produces both a blocked `will-navigate` and a `new-window-open` opens in the browser once, not twice.
- The tests in `test/desktop/links.test.ts` use the payloads Electrobun actually sends, so a regression in the shape is
  caught by `bun test`.
- Nothing else about which links stay in the window changes: the server's own origin stays in the window; `http`,
  `https` and `mailto` links to anything else go to the default browser; every other scheme is dropped.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. `desktop-app` already requires, in "The window loads the loopback origin directly" and its **Pull request link**
scenario, that links to other origins open in the default browser; the app did not implement that correctly, and this
change makes it do so. The change sets `skip_specs: true`.

## Impact

- `desktop/src/logic/links.ts` — reading a navigation event's `allowed` flag and URL; not opening a link twice.
- `desktop/src/main.ts` — the `will-navigate` and `new-window-open` handlers call the logic above.
- `test/desktop/links.test.ts` — tests on Electrobun's real payloads.
- `src/ui/changelog.ts` — a What's new entry for the fix.
- No server, API or UI behaviour changes; no new dependency, network access, bridge or injected script. The app still
  hands links to the system with `Utils.openExternal` and makes no request itself (invariant 4 unchanged).
