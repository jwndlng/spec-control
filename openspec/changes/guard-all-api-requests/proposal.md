# Proposal

## Why

Invariant 2 says there is no authentication because nothing but this machine can reach the server. That holds for the
socket, not for the browser. The loopback host-name check that defeats DNS rebinding lives in `crossSiteRefusal`
(`src/server/api.ts`), and `createFetchHandler` calls it only for requests whose method is not `GET` or `HEAD`. A page
served from `http://attacker.example:4711` whose name the attacker then rebinds to `127.0.0.1` is same-origin with its
own requests, so the browser lets it read every answer:

- `GET /api/config` — every scan root, ignore path and tracked repository path;
- `GET /api/state`, `GET /api/activity`, `GET /api/pull-requests`, `GET /api/sessions` — every change, branch, pull
  request and session;
- `GET /api/repos/<id>/changes/<name>/file?path=…` — the content of any change's files;
- `GET /api/environment?force=1`, as often as it likes — each call starts local processes for the environment check.

A request with `Host: attacker.example:4711` to `GET /api/config` is answered `200` with the whole configuration today.
The comment on `crossSiteRefusal` names DNS rebinding as the reason the check exists; the `dashboard-api` spec asks for
it only for mutating requests and for the terminal WebSocket, which is the gap.

Separately, malformed input that the server should refuse with `400` ends as an unhandled exception (`500` or Bun's
error page): `readJson` throws a `SessionError` that `postPullRequestsRefresh` and `postGithubRepos` do not catch, a
path segment such as `%E0` makes the routes' `decodeURIComponent` throw a `URIError` outside any `try`, and
`Bun.serve` in `src/server/index.ts` has no `error` handler.

## What Changes

- **Every request is checked for a loopback host name, first.** Before any routing — API routes of every method,
  `/api/version`, the embedded page and whatever else the fallback serves, and the "starting" handler that answers
  before the scanner is ready — a request whose URL host name is not `127.0.0.1`, `localhost` or `[::1]` is refused
  with `403` and nothing else happens: no route runs, no process starts, nothing is read or written. The existing
  mutating-request guard and the WebSocket guard stay as they are; they keep their own host check, now redundant but
  harmless.
- **Malformed requests are answered `400`, once, at the top.** The fetch handler maps a `SessionError` that escapes a
  route to its status, a path segment that does not percent-decode to `400 { error }`, and any other escaped exception
  to `500 { error: "internal error" }` without a stack trace; `Bun.serve` gets an `error` handler that does the same as
  a last resort. No route changes its own validation.
- `CLAUDE.md` invariants 2 and 2a say that every request, not only mutating ones, must be addressed to a loopback host
  name.

No new route, no new write, no network access, no process.

## Non-goals

- Authentication or a token: a loopback name check is enough against rebinding, because a rebound page cannot make
  the browser send a `Host` other than its own name.
- An `Origin` check on `GET`: top-level navigations and the page's own `GET`s carry none, and a cross-site page cannot
  read a `GET` response without CORS, which the server never grants.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `dashboard-api`: every request is refused unless it is addressed to a loopback host name; malformed requests are
  answered `400` rather than ending in an unhandled exception.

## Impact

- `src/server/api.ts`: a `hostRefusal` check (the loopback part of `crossSiteRefusal`, shared with `webSocketRefusal`)
  at the top of `createFetchHandler` and in `startingFetchHandler`; one top-level `try`/`catch` in the fetch handler
  mapping `SessionError`, `TrackingError` and `URIError`.
- `src/server/index.ts`: an `error` handler on `Bun.serve`.
- `CLAUDE.md`: wording of invariants 2 and 2a.
- Tests: `test/api.test.ts` (rebinding refused for `GET` and `HEAD` of API routes, the page and `/api/version`; the
  starting handler), `test/pullRequestsApi.test.ts` and `test/githubApi.test.ts` (a body that is not JSON is `400`),
  a new `test/malformedRequests.test.ts` (undecodable path segments on every parameterised route).
- Spec: `openspec/specs/dashboard-api/spec.md`.

## Overlaps

- `one-console-per-change` and `start-editor-in-worktree` (in flight) both change `src/server/api.ts`, and
  `start-editor-in-worktree` also changes `CLAUDE.md`. This change touches only the top of `createFetchHandler`,
  `startingFetchHandler` and invariants 2/2a, so the overlaps are textual; whichever lands second rebases.
- `serialise-home-writes` (proposed alongside) changes other parts of `src/server/api.ts` (`putConfig`) and the
  `dashboard-api` spec's "Tracking endpoints"; no requirement is shared.
