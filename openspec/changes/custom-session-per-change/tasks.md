# Tasks

## 1. Core Types and Action Helpers

- [ ] 1.1 Add `"custom"` to `SessionAction` and `SESSION_ACTIONS` in `src/shared/types.ts`, and update `availableActions` to include `"custom"` for every active (non-archived) change regardless of stage or dependency blocks; verify with unit tests in `test/columns.test.ts` and `test/types.test.ts`.
- [ ] 1.2 Add `"custom"` to `MENU_ORDER` in `src/shared/nextStep.ts`, ensure `startersForAgent` allows `"custom"` without requiring an opening prompt in the profile, and configure starter hints and labels for Custom session in `src/ui/sessionState.ts`; verify with unit tests in `test/nextStep.test.ts` and `test/sessionState.test.ts`.

## 2. Server Session Manager and API Endpoints

- [ ] 2.1 Update `SessionManager.openNow` in `src/server/sessions/manager.ts` to support `action === "custom"`, bypassing prompt requirements and stage/dependency blocking checks, launching the agent via `launchWithoutPrompt(agent)` with no initial text typed, and recording the session; verify with unit tests in `test/agentSessions.test.ts`.
- [ ] 2.2 Verify `POST /api/sessions` accepts `{ repoId, change, action: "custom" }`, returns any already running session for that change without typing into it, and returns 503 if the agent executable is missing; verify with API tests in `test/sessionsApi.test.ts`.

## 3. UI Controls and Changelog

- [ ] 3.1 Update `src/ui/sessions.tsx` and `src/ui/sessionPanel.tsx` to render the Custom session starter with its label ("Custom session"), icon, and tooltip in card footers and in the change detail Console tab; verify with component tests in `test/sessionControls.test.ts`.
- [ ] 3.2 Update `src/ui/demo/demoSessions.ts` to support the `"custom"` starter in the interactive demo; verify with `bun test test/demoSessions.test.ts`.
- [ ] 3.3 Add a What's new entry at the top of `src/ui/changelog.ts` introducing custom sessions per change as specified in CONTRIBUTING.md, and verify with `bun test test/whatsNew.test.ts`.

## 4. Verification

- [ ] 4.1 Run `bun run check` across the codebase to ensure type checking, formatting, and the complete test suite pass cleanly without regressions.
