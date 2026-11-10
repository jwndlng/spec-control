# Tasks

## 1. Shared dropdown interaction

- [ ] 1.1 Add the controlled shared select and typed option contract from design.md, preserving exact string values, labels, disabled states and trigger refs; verify with component DOM tests for accessible names, empty-string choices, controlled updates, same-value selection and no form submission.
- [ ] 1.2 Implement keyboard opening, active-option navigation, disabled-option skipping, selected-option scrolling, explicit commit and focus restoration; verify DOM tests for arrows, Home/End, Enter, short-list Space, Escape and Tab/Shift+Tab, including a list with no enabled options.
- [ ] 1.3 Add local search at eight options and type-ahead below eight, including announced no-results state, reset on close and active-option reconciliation; verify filtering order, case insensitivity, no-results Enter, option removal and no callback while searching or navigating.

## 2. Popup presentation and surrounding surfaces

- [ ] 2.1 Add portalled positioning within the closest dialog or document body, viewport bounds, above/below placement and internal scrolling; verify geometry cases with controlled element bounds in DOM tests and inspect narrow-width and 200% zoom behavior in the demo.
- [ ] 2.2 Implement pointer/touch commit, outside dismissal, one open dropdown at a time and listener cleanup; verify DOM tests that enclosing rows/cards never activate, internal scrolling keeps the panel open, and outside dismissal preserves the outside focus target.
- [ ] 2.3 Integrate dropdown Escape handling with `modal.tsx`, setup and detail handlers as needed; verify in wrapper-level DOM tests that the first Escape closes only the dropdown, the next follows the dialog's existing behavior, and dropdown unmount leaves no active coordinator entry.
- [ ] 2.4 Style compact and form variants using existing theme tokens, selected checkmarks, active outlines, disabled states, chevron and reduced-motion-aware entrance; verify both themes, readable long labels, 4.5:1 text contrast and animation suppression under reduced motion in the demo.

## 3. Filters and settings migration

- [ ] 3.1 Migrate auto-refresh, board age, overview sort and pull-request project/state selects in `app.tsx`, `boardFilters.tsx`, `overview.tsx` and `pullRequests.tsx`; update affected UI tests to verify unchanged values, numeric conversions, URL/filter behavior and refresh callbacks, including no changes from dismissal.
- [ ] 3.2 Migrate `projectSettings.tsx` and `agentSettings.tsx` through existing setting wrappers; verify affected tests preserve option order, keep-each/default/inheritance choices, busy disables, error feedback and exactly-once save callbacks.
- [ ] 3.3 Migrate permission and agent controls in `changeDetail.tsx` and `sessionPanel.tsx`, preserving any consolidation from `unify-change-permission-picker`; verify affected tests retain placement, scope, inheritance wording and permission-save behavior with no save on browsing.
- [ ] 3.4 Update `src/ui/helpContent.tsx` to explain opening, searching, keyboard selection and dismissing dropdowns; verify the rendered Help matches the implemented interactions and existing Help tests pass.

## 4. Setup and creation forms migration

- [ ] 4.1 Migrate selects in `setupWizard.tsx`, `newProject.tsx` and `addGithub.tsx`, retaining first-field focus and busy states; verify affected setup, project and GitHub UI tests preserve defaults, root selection, validation and submit timing.
- [ ] 4.2 Migrate project selection and label addition in `newChangeForm.tsx`; verify affected creation/label tests cover search, initial focus, append-once label selection, placeholder reset, disabled exhaustion and unchanged validation without accidental submission.

## 5. Integration and release note

- [ ] 5.1 Audit `src/ui/` for remaining native single-value selects, verify all intended call sites use the shared control, then run `bun run check`, `bun run build` and `bun run build:demo`; verify all pass and `dist/spec-control --version` runs successfully.
- [ ] 5.2 Manually exercise filters, project settings, permission settings, setup and creation forms in the demo and macOS wrapper; record results for both themes, narrow viewport, 200% zoom, pointer/touch, keyboard-only use, screen-reader names/selection, modal Escape, scrolling and reduced motion. Confirm selection/search introduces no new network requests.
- [ ] 5.3 Add an independent What's new JSON entry under `src/ui/changelog/entries/` describing refreshed dropdowns and how to search longer lists; verify its wording matches the shipped behavior and `bun test test/whatsNew.test.ts` passes, then rerun `bun run check` before push.
