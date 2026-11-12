# Tasks

## 1. Consolidate the change permission control

- [x] 1.1 Keep one permission control in `src/ui/changeDetail.tsx` above the tabs, optionally extracting a shared UI component; remove the duplicate selector and permission-save state from `src/ui/sessionPanel.tsx`. Replace duplicate-selector assertions in `test/sessionPanelUi.test.ts` and add rendered change-detail coverage proving exactly one accessible control across artifact and Console tabs, including a change with no session, and none for archived/missing changes or disabled sessions.
- [x] 1.2 Add readable profile labels, "Inherit from project" with repository → global → Minimum fallback, and change-scope/next-start explanatory text. Verify setting and clearing overrides through the existing scoped API, preserving other override fields and project/global settings, with tests including an explicit choice equal to the inherited profile.
- [x] 1.3 Add change-scoped pending, success and error feedback, prevent duplicate submissions, and retain the acknowledged selection on failure. Verify deferred success, refusal/retry, tab switching during a save and navigation to a different change before completion using UI tests and mocked API responses.
- [x] 1.4 Update `src/ui/helpContent.tsx` to describe the single change control, inheritance, save feedback and next-start timing; verify the Help wording matches the rendered behavior and existing Help checks pass.

## 2. Explain the running session and exercise the demo

- [x] 2.1 Derive the running-session notice from existing session records and the effective saved profile, using `src/ui/sessionState.ts` helpers if needed. Add tests for mismatched/matching profiles, inherited setting updates, no running session, a legacy session with no recorded profile, and selection of ended Console history while another session runs; verify no save starts/restarts a session or sends terminal input.
- [x] 2.2 Exercise the existing demo permission API and add synthetic sample states or focused demo tests under `src/ui/demo/` as needed. Verify changing and clearing a profile affects only that change, and the running-session notice and saved selection agree across tabs in the demo.

## 3. Integration and release communication

- [x] 3.1 Run the affected UI, permission API/resolver and demo tests, then `bun run check` and `bun run build:demo`; verify they pass without real agents or network access in tests. Inspect the demo at narrow and wide widths with keyboard navigation, checking selector count, readable labels, status/error announcements and running-session wording. Verified with `bun run check --timeout 15000` (2,330 passed); default-timeout failures are recorded in `pull-request.md`.
- [x] 3.2 Add an independent What's new JSON entry under `src/ui/changelog/entries/` describing the single change permission picker and inheritance; verify the entry follows `CONTRIBUTING.md` and passes `bun test test/whatsNew.test.ts`.
