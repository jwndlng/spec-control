# Tasks

## 1. Scoped implementation and verification

- [ ] 1.1 Review the layout sketch in design.md and produce a concrete responsive timeline mockup before wiring controls; verify phase hierarchy, artifact milestones, pending delivery, small-screen summary, and action/menu placement against the agreed model.

- [ ] 1.2 Add the shared lifecycle view model and timeline above file tabs with major phases, schema-derived artifact nodes, validation state, local progress, and persistence status; verify standard and alternate schema, missing evidence, pending PR, and archived cases.

- [ ] 1.3 Place Draft artifacts, Implement, and Archive in the timeline with one primary action and server-derived blockers; verify dependency gates, agent selection, disabled sessions, explicit handoffs, and absence of duplicate console lifecycle buttons.

- [ ] 1.4 Move Resume, Clean up, Delete record, and Open in editor into a labeled selected-session menu and put a copy-path icon beside the path; verify eligibility, confirmations, session selection, keyboard focus, clipboard failures, and exact copied text.

- [ ] 1.5 Add fictional demo states and Help illustrations/descriptions for drafting persistence, blocked delivery, and the timeline; verify narrow desktop/mobile layout, text labels, keyboard navigation, and screen-reader names through UI tests and demo visual review.

- [ ] 1.6 Verify the change with focused tests appropriate to its touched behavior, then run bun run check before pushing; record results. Build the demo and review affected narrow/wide layouts and keyboard accessibility.

- [ ] 1.7 Add an independent What's new JSON entry under src/ui/changelog/entries/ for this change only; verify its filename/id and summary with the repository changelog validator.

## Workflow follow-up

- Open the implementation PR for this change only; merge required predecessors first.
- Archive after implementation merges, preserving main-spec structure and unrelated requirements.
