# Tasks

## 1. Session termination and proposal auto-ship

- [ ] 1.1 Distinguish explicit user termination from process exit and application shutdown in the session end path; verify only the explicit end reason reaches proposal auto-ship eligibility.
- [ ] 1.2 Reuse proposal eligibility and deterministic Ship after explicit end of an eligible Draft session, with per-session serialization and failure preservation; verify unit tests cover successful ship, disabled opt-in, incomplete artifacts, non-OpenSpec changes, and ship failure.
- [ ] 1.3 Update end-session API/UI result handling to report whether proposal auto-ship succeeded or why it was skipped; verify API and UI tests cover the result.

## 2. User guidance

- [ ] 2.1 Add a What's new JSON entry explaining that ending a completed Draft session can ship its proposal in docs auto-merge projects; verify `bun test test/whatsNew.test.ts` passes.
