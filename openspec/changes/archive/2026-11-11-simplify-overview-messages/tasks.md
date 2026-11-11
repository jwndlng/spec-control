# Tasks

## 1. Scoped implementation and verification

- [x] 1.1 Remove the internal evidence sentence and raw timestamp from routine Finish checks card content; verify the action still starts the correct follow-up and its server prompt still requires current evidence. Evidence: finishChecksUi and shipPreflight tests passed.

- [x] 1.2 Expose relative freshness and the full timestamp on demand and retain an actionable failed-refresh state; verify accessibility and successful/failed refresh UI fixtures. Evidence: six Finish checks DOM tests passed; native details/summary disclosure, exact time element, successful retry and failed retry covered. Real-browser keyboard review is tracked in 1.6.

- [x] 1.3 Update affected Help/demo copy only as needed and verify it matches the revised overview. Help describes the disclosure/retry; fictional deprecate-v1-auth demo now has an unresolved check on a merged implementation. Demo session tests and demo build passed.

- [x] 1.4 Verify with focused tests and bun run check before pushing; build the demo and record results. Focused tests: 49 passed. `bun run check`: lint and typecheck passed; 2,323 tests passed, 0 failed (13,060 assertions). Demo and binary builds passed.

- [x] 1.5 Add an independent What's new JSON entry under src/ui/changelog/entries/ for this change only; verify its filename/id and summary with the repository changelog validator. Evidence: test/whatsNew.test.ts passed, including filename/id/date validation.

- [x] 1.6 Review affected narrow/wide layouts and keyboard accessibility. User confirmed this manual review is complete.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
