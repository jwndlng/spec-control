# Tasks

## 1. Configuration

- [x] 1.1 Add optional `changeAgents` (change name → profile id) to `repos[].agent` in `src/server/config.ts` and `src/shared/types.ts`, validating keys with `CHANGE_NAME` and values against configured profiles; verify with `test/config.test.ts` cases for a valid map, an unknown profile and an invalid name
- [x] 1.2 Drop overrides naming a removed profile (and an emptied map) where removing a profile already resets `agentId` and `consoleAgent`; verify with a config test that removing `my-agent` saves without an "unknown agent" error and without the override

## 2. Server

- [x] 2.1 Add a shared `changeAgentId(config, repo, change)` and make `agentFor` take an optional change; verify with unit tests covering override, project choice and default
- [x] 2.2 Pass the change to `agentFor` at every new change-session start in `src/server/sessions/manager.ts` (starters, Ship/Resolve conflicts starting a fresh agent, archive follow-ups) and not for the project console or Integrate; verify with session-manager tests using `test/fixtures/fake-agent.ts` that an overridden change starts the other profile, a console does not, and resume keeps `session.agentId`
- [x] 2.3 Make starter availability and the executable-not-found refusal use the change's agent; verify with a test where the override lacks an Archive prompt and Archive is refused for that change only
- [x] 2.4 Add `POST /api/repos/<id>/changes/<name>/agent` in `src/server/api.ts` behind `crossSiteRefusal`, serialised with other config writes, pruning overrides of inactive changes; verify with API tests for set, clear (no empty map), unknown profile `400`, invalid name `400`, archived change `404`, excluded repository `403`, cross-site `403`, and no scan triggered

## 3. UI

- [x] 3.1 Compute a card's and the Console tab's starters from the change's agent; verify with UI logic tests that an override without a Draft prompt hides Draft artifacts on that card only
- [~] 3.2 Add the Agent picker to the Console tab (hidden with one profile and for archived changes), restoring the previous choice on refusal and naming the running session's agent when it differs; verify with UI tests and by hand in `bun run dev` (CHECK: verify by hand in `bun run dev` with multiple profiles configured)
- [x] 3.3 Show the overriding profile's name with its tooltip in the card footer; verify with a UI test that cards without an override show no agent name

## 4. Wrap-up

- [x] 4.1 Add a What's new entry at the top of `src/ui/changelog.ts` describing the per-change agent choice
- [~] 4.2 Run `bun run check` and verify it passes; build `bun run build` and confirm an overridden change starts its profile from `dist/spec-control` (CHECK: confirm an overridden change starts its profile from `dist/spec-control`)
