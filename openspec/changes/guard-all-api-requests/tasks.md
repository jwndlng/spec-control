# Tasks

## 1. Host check

- [x] 1.1 Extract the loopback host-name check into `hostRefusal(req)` in `src/server/api.ts`, used by `crossSiteRefusal` and `webSocketRefusal`; verify with the existing `test/api.test.ts` and `test/terminalApi.test.ts` refusal tests
- [x] 1.2 Call it first in `createFetchHandler`, for every method and path, answering `403` (`{ error }` under `/api/`, plain text otherwise) before any routing; verify with `test/api.test.ts` cases for `Host: attacker.example:4711` on `GET /api/config`, `GET /api/state`, `GET /api/repos/<id>/changes/<name>/file`, `GET /api/environment?force=1` (no process started), `HEAD /api/state`, `GET /api/version` and `GET /`, and for `127.0.0.1`, `localhost` and `[::1]` being answered as before
- [x] 1.3 Call it in `startingFetchHandler`; verify with a `test/api.test.ts` case that a foreign host gets `403`, not the version

## 2. Malformed requests

- [x] 2.1 Wrap the routing of `createFetchHandler` in one `try`/`catch` mapping `SessionError`/`TrackingError` to their status, `URIError` to `400` and anything else to `500 { error: "internal error" }`; verify with `test/pullRequestsApi.test.ts` and `test/githubApi.test.ts` (a body that is not JSON is `400` and starts no `gh`) and a new `test/malformedRequests.test.ts` (`%E0` as `<id>` or `<name>` on every parameterised route is `400` and has no side effect)
- [~] 2.2 Add an `error` handler to `Bun.serve` in `src/server/index.ts` returning the same `500` body; verify by review and `bun run check`

## 3. Documentation and verification

- [~] 3.1 Update `CLAUDE.md` invariants 2 and 2a: every request, not only a mutating one, must be addressed to a loopback host name; verify by review
- [ ] 3.2 Run `bun run check` and `bun run build`, then check with `curl -H 'Host: attacker.example:4711' http://127.0.0.1:4711/api/config` against `dist/spec-control` that the answer is `403`
