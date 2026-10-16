# Design

## Context

See proposal.md — Why. What Electrobun 2.0.2 sends, read from its main-process SDK (`proc/native.ts`,
`events/webviewEvents.ts`) and the format strings in `libNativeWrapper.dylib`:

| Event | `event.data` as the app's handler receives it |
| --- | --- |
| `will-navigate` | `{ detail: '{"url":"https://…","allowed":false}' }` — `detail` stays a string; `allowed` is `true` or `false` |
| `new-window-open` | `{ detail: { url, isCmdClick, modifierFlags, … } }` — `detail` parsed into an object (or left a string if parsing failed) |
| `did-navigate`, `did-navigate-in-page` | `{ detail: "<url>" }` |

Navigation rules are evaluated natively; a blocked navigation is cancelled there and only reported to Bun. On WebKit a
`target="_blank"` click is offered to the navigation policy first, so a link to another origin is cancelled before a
new window is ever requested, and `will-navigate` with `allowed:false` is the event the app sees. Whether WebKit then
also asks for a new window is not something the app should depend on.

`eventUrl` in `desktop/src/logic/links.ts` already unwraps all of these shapes for the URL. The bug is only in the
`allowed` check in `main.ts`, which reads it from the outer object.

## Goals / Non-Goals

**Goals:**
- A link to another origin opens in the default browser exactly once, whatever event or events report it.
- The decision is in `desktop/src/logic/` and tested against Electrobun's real payloads.

**Non-Goals:**
- Changing which URLs are internal, external or dropped (`externalTarget` is unchanged).
- Upgrading Electrobun, adding a preload script, a bridge, or any click handling in the page — the page stays the
  server's own page (desktop-app spec, "No bridge into the app").

## Decisions

**D1. One function reads a navigation event: `navigationEvent(data) → { url, allowed } | undefined`.** It unwraps
`detail` the way `eventUrl` does (JSON string, object, or nested `detail`) and returns the URL together with `allowed`
when that is a boolean. `main.ts`'s `will-navigate` handler becomes "if `allowed === false`, follow the URL". Keeping
it beside `eventUrl` (which can be built on it) means the shape knowledge lives in one tested place. Alternative —
`JSON.parse` inline in `main.ts` — rejected: `main.ts` is outside the root typecheck and tests, which is how this bug
got in.

**D2. A blocked navigation and a new-window request for the same URL open the browser once.** A small pure helper,
`recentlyOpened`-style: the app remembers the last URL it handed to the browser and when, and skips the same URL
within one second. Pure (takes the clock as an argument) so it is tested in `test/desktop/`. Alternative — handle only
`will-navigate` and ignore external URLs in `new-window-open` — rejected: if a WebKit version requests the window
without a policy check first, links would break again in the other direction. One second is far below a deliberate
second click on the same link and far above the gap between the two events of one click.

**D3. Tests use the literal payloads from the table above** — including `allowed:true` (not followed), a non-JSON
string `detail` (no `allowed`, so not followed), and the parsed `new-window-open` object — replacing the test case
that asserted the assumed `{ url, allowed: false }` shape as the only form.

## Risks / Trade-offs

- [A future Electrobun changes the payload again] → the dependency is pinned (`2.0.2`), the function accepts both the
  string and the object forms, and the tests name the shapes it relies on, so an upgrade that changes them shows up
  when someone re-checks them.
- [The fix cannot be proven by `bun test` alone: no test runs the native window] → a manual check in a built app
  (`bun run build:desktop`) of a pull request link, an issue link, the header's release link and a Markdown link is
  part of the tasks.
- [Deduplication hides a real second click within one second] → the browser already has the page open from the first
  click; nothing is lost.
