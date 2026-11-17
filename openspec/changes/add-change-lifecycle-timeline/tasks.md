# Tasks

## 1. Scoped implementation and verification

- [x] 1.1 Review the layout sketch in design.md and produce a concrete responsive timeline mockup before wiring controls; verify phase hierarchy, artifact milestones, pending delivery, small-screen summary, and action/menu placement against the agreed model. Evidence: added wide and narrow wireframes with the required ordered phases, schema-derived artifact examples, pending delivery text, compact current/next summary, primary phase action, and selected-session menu; reviewed against the spec scenarios.

- [x] 1.2 Add the shared lifecycle view model and timeline above file tabs with major phases, schema-derived artifact nodes, validation state, local progress, and persistence status; verify standard and alternate schema, missing evidence, pending PR, and archived cases. Evidence: `src/ui/lifecycleTimeline.tsx` derives phases, schema artifact labels, validation, task progress, and persisted deliveries; `test/lifecycleTimeline.test.ts` covers standard/alternate artifact names, absent evidence, validation, pending PR, archived state, and demo delivery states (4 passed).

- [x] 1.3 Place Draft artifacts, Implement, and Archive in the timeline with one primary action and server-derived blockers; verify dependency gates, agent selection, disabled sessions, explicit handoffs, and absence of duplicate console lifecycle buttons. Evidence: detail uses shared `SessionControls` in the timeline, preserving snapshot/server eligibility and agent selection; lifecycle starters are suppressed in the Console tab. `bun test test/sessionState.test.ts test/sessionControls.test.tsx test/sessionPanelUi.test.ts test/proposalSessions.test.ts test/changeDetail.test.ts` passed, covering blocked dependencies, disabled sessions, session selection, and explicit proposal handoff.

- [x] 1.4 Move Resume, Clean up, Delete record, and Open in editor into a labeled selected-session menu and put a copy-path icon beside the path; verify eligibility, confirmations, session selection, keyboard focus, clipboard failures, and exact copied text. Evidence: native `details`/`summary` disclosure is tied to the selected session; existing action handlers and confirmations remain in its menu. `bun test test/sessionPanelUi.test.ts test/editorUi.test.ts test/worktreePath.test.ts test/worktreePathUi.test.tsx` passed, including exact path copy and clipboard refusal without success feedback.

- [x] 1.5 Add fictional demo states and Help illustrations/descriptions for drafting persistence, blocked delivery, and the timeline; verify narrow desktop/mobile layout, text labels, keyboard navigation, and screen-reader names through UI tests and demo visual review. Evidence: Help/demo UI tests passed; built demo reviewed at wide and narrow widths, including accessible tree labels for timeline, copy-path control, and selected-session actions, plus keyboard focus on the timeline disclosure and PR link.

- [x] 1.6 Verify the change with focused tests appropriate to its touched behavior, then run bun run check before pushing; record results. Build the demo and review affected narrow/wide layouts and keyboard accessibility. Evidence: focused lifecycle/session/change-detail/demo/Help/changelog tests passed; `bun run check` passed (lint, typecheck, 2,467 tests across 201 files); `bun run build:demo` passed and the built demo was reviewed at wide and narrow widths with keyboard/accessibility-tree checks.

- [x] 1.7 Add an independent What's new JSON entry under src/ui/changelog/entries/ for this change only; verify its filename/id and summary with the repository changelog validator. Evidence: `src/ui/changelog/entries/2026-11-16-change-lifecycle-timeline.json`; changelog validator passed in `bun run check` (`test/whatsNew.test.ts`).

## Workflow follow-up

- Open the implementation PR for this change only; required predecessor `automate-lifecycle-delivery` is archived on refreshed `origin/main` (merge `7c901574`).
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
