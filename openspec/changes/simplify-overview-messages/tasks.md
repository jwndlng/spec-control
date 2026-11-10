# Tasks

## 1. Scoped implementation and verification

- [ ] 1.1 Remove the internal evidence sentence and raw timestamp from routine Finish checks card content; verify the action still starts the correct follow-up and its server prompt still requires current evidence.

- [ ] 1.2 Expose relative freshness and the full timestamp on demand and retain an actionable failed-refresh state; verify accessibility and successful/failed refresh UI fixtures.

- [ ] 1.3 Update affected Help/demo copy only as needed and verify it matches the revised overview.

- [ ] 1.4 Verify the change with focused tests appropriate to its touched behavior, then run bun run check before pushing; record results. Build the demo and review affected narrow/wide layouts and keyboard accessibility.

- [ ] 1.5 Add an independent What's new JSON entry under src/ui/changelog/entries/ for this change only; verify its filename/id and summary with the repository changelog validator.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
