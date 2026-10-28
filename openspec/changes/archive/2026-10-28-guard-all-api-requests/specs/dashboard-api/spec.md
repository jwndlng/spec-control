## ADDED Requirements

### Requirement: Every request must be addressed to a loopback host name

The server SHALL refuse every request whose URL host name — the name in its `Host` header — is not `127.0.0.1`, `localhost` or `[::1]` (compared case-insensitively), whatever its method or path: API routes with `GET`, `HEAD` and every other method, `GET /api/version`, the embedded page and any other path the server answers, and requests answered while the server is still starting. The refusal SHALL be `403`, with a JSON `{ error }` body under `/api/`, and SHALL happen before anything else: no route runs, the body is not read, no process is started, no scan is triggered and nothing is read from or written to a repository or the dashboard's home. This protects the read endpoints against DNS rebinding, where a page on another name that resolves to `127.0.0.1` is same-origin with its own requests and could otherwise read their answers. The checks of "Mutating requests are protected against cross-site requests" and of the terminal WebSocket SHALL still apply in addition.

#### Scenario: Rebound page reads the configuration
- **WHEN** a request `GET /api/config` arrives with `Host: attacker.example:4711`
- **THEN** the response is `403` and contains no part of the configuration

#### Scenario: Rebound page reads a change's file
- **WHEN** a request `GET /api/repos/<id>/changes/rotate-keys/file?path=proposal.md` arrives with `Host: attacker.example:4711`
- **THEN** the response is `403` and the file is not read

#### Scenario: Rebound page forces environment checks
- **WHEN** a request `GET /api/environment?force=1` arrives with `Host: attacker.example:4711`
- **THEN** the response is `403` and no process is started

#### Scenario: The page under a foreign name
- **WHEN** a request `GET /` arrives with `Host: attacker.example:4711`
- **THEN** the response is `403` and the page is not served

#### Scenario: While starting
- **WHEN** a request `GET /api/version` arrives with `Host: attacker.example:4711` before the server is ready
- **THEN** the response is `403`, not the version

#### Scenario: Loopback names keep working
- **WHEN** the browser, the desktop app or `curl` requests `GET /api/state` at `http://127.0.0.1:4711`, `http://localhost:4711` or `http://[::1]:4711`
- **THEN** the request is answered as before

### Requirement: Malformed requests are answered with 400

A request the server cannot interpret SHALL be answered with `400` and a JSON `{ error }` message, never with an unhandled exception: a request body that is not JSON on any route that reads one, and a path segment that is not valid percent-encoding (for example `%E0`) in any route that takes a repository id or change name from its path. A refused malformed request SHALL have no side effect: no process is started, no scan is triggered and nothing is written. Any other error that escapes a route SHALL be answered with `500` and `{ "error": "internal error" }`, without a stack trace or other internal detail in the response.

#### Scenario: Body that is not JSON
- **WHEN** `POST /api/pull-requests/refresh` or `POST /api/github/repos` arrives from the dashboard's own origin with the body `{bad`
- **THEN** the response is `400` with an `error` message and no `gh` process is started

#### Scenario: Undecodable path segment
- **WHEN** `POST /api/repos/%E0/enabled` or `GET /api/repos/%E0/cleanup` arrives from the dashboard's own origin
- **THEN** the response is `400` with an `error` message and nothing is changed

#### Scenario: Unexpected failure
- **WHEN** a route throws an error it does not handle
- **THEN** the response is `500` with `{ "error": "internal error" }` and no stack trace
