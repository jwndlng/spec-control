# Tasks

## 1. Core Types and Action Helpers

- [x] 1.1 Add `"custom"` to `SessionAction` and `SESSION_ACTIONS` in `src/shared/types.ts`, and update `availableActions` to include `"custom"` for every active (non-archived) change regardless of stage or dependency blocks; verify with unit tests in `test/agents.test.ts`.
- [x] 1.2 Add `"custom"` to `MENU_ORDER` in `src/shared/nextStep.ts`, ensure `startersForAgent` allows `"custom"` without requiring an opening prompt in the profile, and configure availability in `src/ui/sessionState.ts` and starter hints and labels in `src/ui/sessions.tsx`; verify with unit tests in `test/nextStep.test.ts` and `test/sessionState.test.ts`.

## 2. Server Session Manager and API Endpoints

- [x] 2.1 Update `SessionManager.openNow` in `src/server/sessions/manager.ts` to support `action === "custom"`, bypassing prompt requirements and stage/dependency blocking checks, launching the agent via `launchWithoutPrompt(agent)` with no initial text typed, and recording the session; verify with unit tests in `test/agentSessions.test.ts`.
- [x] 2.2 Verify `POST /api/sessions` accepts `{ repoId, change, action: "custom" }`, returns any already running session for that change without typing into it, and returns 503 if the agent executable is missing; verify with API tests in `test/terminalApi.test.ts`.

## 3. UI Controls and Changelog

- [x] 3.1 Update `src/ui/sessions.tsx` and `src/ui/sessionPanel.tsx` to render the Custom session starter with its label ("Custom session"), icon, and tooltip in card footers and in the change detail Console tab; verify with component tests in `test/sessionState.test.ts` and `test/sessionPanelUi.test.ts`.
- [x] 3.2 Update `src/ui/demo/demoSessions.ts` to support the `"custom"` starter in the interactive demo; verify with `bun test test/demoSessions.test.ts`.
- [x] 3.3 Add a What's new entry at the top of `src/ui/changelog.ts` introducing custom sessions per change as specified in CONTRIBUTING.md, and verify with `bun test test/whatsNew.test.ts`.

## 4. Verification

- [x] 4.1 Run `bun run check --timeout 30000 --retry 2` across the codebase; lint, typecheck, and all 2,235 tests pass.
