# Design

## Context

`createFetchHandler` routes `/api/…` and falls back to the embedded `index.html` for every other `GET`/`HEAD`.
`crossSiteRefusal` checks host name, content type, `Sec-Fetch-Site` and `Origin` and runs only for non-`GET`/`HEAD`
API requests; `webSocketRefusal` does the same for the terminal handshake. Bun builds `req.url` from the request's
`Host` header, so `new URL(req.url).hostname` is the name the browser addressed.

## Decisions

### D1. One host check before any routing, for every path and method

The loopback host-name check moves to the first line of the fetch handler and applies to everything it serves:
API routes of every method, `/api/version`, the page and any static path, and `startingFetchHandler`. Rejected:
guarding only `GET /api/…`. The page itself holds nothing secret, but serving it under a foreign name gives a rebound
origin a working copy of the UI, and a single check at the top is simpler to keep correct than a list of routes that
need it — a future `GET` route is covered without anyone remembering to add it.

The refusal is `403` with `{ error }` for `/api/…` and plain text otherwise, and it happens before the body is read
or any route, scan, process or file access runs.

### D2. The same names as today, compared on the parsed URL

Allowed host names stay `127.0.0.1`, `localhost` and `[::1]` (`LOOPBACK_HOSTS`), compared on the parsed, lower-cased
`URL.hostname`, so `LOCALHOST` passes and `localhost.` or `127.0.0.1.attacker.example` do not. The port is not
compared: the server only receives requests on its own port, and a rebinding page necessarily uses that port too, so
the name is what tells the two apart. The desktop app requests `http://127.0.0.1:<port>/` and the browser opens the
printed `127.0.0.1` URL, so neither is affected.

### D3. No `Origin` requirement for `GET`

A `GET` whose host is loopback is answered whatever its `Origin`: navigations and the page's own reads send none, and a
cross-site page cannot read the answer without CORS approval, which the server never sends. The WebSocket keeps its
mandatory `Origin` because a handshake is readable cross-origin.

### D4. Malformed input mapped once, at the top

One `try`/`catch` around the routing in `createFetchHandler` maps what escapes a route:

- `SessionError` and `TrackingError` → their status and `{ error }` (covers `readJson` in `postPullRequestsRefresh`,
  `postGithubRepos` and any future route that forgets to catch it);
- `URIError` (a path segment `decodeURIComponent` cannot decode) → `400 { error: "malformed path" }`;
- anything else → `500 { error: "internal error" }`, logged to the console, no stack in the response.

`Bun.serve` in `src/server/index.ts` gets an `error` handler returning the same `500` body, for anything thrown outside
the handler's `try` (for example in the WebSocket upgrade path). Rejected: wrapping every `decodeURIComponent` and
`readJson` call site — that fixes today's routes and not tomorrow's. Routes keep their own, more specific handling;
the top-level mapping only catches what they let through.
