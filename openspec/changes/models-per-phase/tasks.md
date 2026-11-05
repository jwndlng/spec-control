# Tasks

## 1. Schema and Configuration

- [x] 1.1 Add `defaultModel` to `agentSessionsSchema` and `model` and `phaseModels` to `agentProfileSchema` in `src/server/config.ts` and `src/shared/types.ts` with validation (single-line, non-empty, no control characters, no permission bypass flags); verify with unit tests in `test/config.test.ts`.
- [x] 1.2 Implement `resolveModel(config, agent, action)` helper in `src/server/sessions/agents.ts` prioritizing phase override, then profile model, then global default model, and returning undefined when none is set; verify with unit tests in `test/agentSessions.test.ts`.

## 2. Agent Launch and Argument Composition

- [x] 2.1 Update `launchCommand` and `withLaunchArgs` in `src/server/sessions/agents.ts` to substitute `{model}` when present in `command` or `launchArgs`, or inject `["--model", effectiveModel]` directly after the executable when an effective model is resolved; verify with unit tests in `test/agentSessions.test.ts`.
- [x] 2.2 Update session start in `SessionManager` (`src/server/sessions/manager.ts`) to resolve the action's effective model and pass it through to launch command generation; verify with session start tests in `test/agentSessions.test.ts`.

## 3. Settings UI

- [x] 3.1 Add the global Default model input field to the Agent sessions section in `src/ui/agentSettings.tsx` and verify with UI render tests in `test/agentSettingsUi.test.ts`.
- [x] 3.2 Add profile-level Model input and collapsible Phase models overrides (for Draft, Implement, Validate, and Archive) to agent profile cards in `src/ui/agentSettings.tsx`, displaying inheritance indicators when fields are empty; verify with UI tests in `test/agentSettingsUi.test.ts`.

## 4. Documentation and Verification

- [ ] 4.1 Run full suite verification (`bun run check` and `bun run build`) to ensure all tests, linting, type checks, and binary builds pass. `bun run build` passes; lint and typecheck pass; model-specific and UI tests pass. The full check ran 2,235 tests (2,232 passed, 3 failed): `test/terminalSessions.test.ts` > "an opening prompt typed after start-up is not sent into a dialog" (typed prompt was confirmed by Enter), `test/api.test.ts` > "mutating requests must come from the dashboard itself" (default 5-second timeout), and `test/scanner.test.ts` > "scanner isolates a failing repo and keeps its last good changes" (default 5-second timeout). Resolve the terminal assertion and rerun `bun run check`; raise the timeout for the two slow tests if appropriate.
- [x] 4.2 Add a What's new entry at the top of `src/ui/changelog.ts` describing default model configuration and per-phase model overrides.
