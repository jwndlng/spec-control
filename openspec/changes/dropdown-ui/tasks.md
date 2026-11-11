# Tasks

## 1. Shared dropdown interaction

- [x] 1.1 Add the controlled shared select and typed option contract from design.md, preserving exact string values, labels, disabled states and trigger refs; verify with component DOM tests for accessible names, empty-string choices, controlled updates, same-value selection and no form submission.
- [x] 1.2 Implement keyboard opening, active-option navigation, disabled-option skipping, selected-option scrolling, explicit commit and focus restoration; verify DOM tests for arrows, Home/End, Enter, short-list Space, Escape and Tab/Shift+Tab, including a list with no enabled options.
- [x] 1.3 Add local search at eight options and type-ahead below eight, including announced no-results state, reset on close and active-option reconciliation; verify filtering order, case insensitivity, no-results Enter, option removal and no callback while searching or navigating.

## 2. Popup presentation and surrounding surfaces

- [~] 2.1 Add portalled positioning within the closest dialog or document body, viewport bounds, above/below placement and internal scrolling; DOM geometry cases pass. User: inspect narrow-width and 200% zoom behavior in the demo.
- [~] 2.2 Implement pointer/touch commit, outside dismissal, one open dropdown at a time and listener cleanup; DOM tests pass for row activation, internal scrolling, outside focus, one-open ownership and cleanup. User: verify option selection by touch on a real touch device.
- [x] 2.3 Integrate dropdown Escape handling with `modal.tsx`, setup and detail handlers as needed; wrapper DOM tests verify the first Escape closes only the dropdown, the next follows dialog behavior, and unmount releases coordinator ownership.
- [~] 2.4 Style compact and form variants using existing theme tokens, selected checkmarks, active outlines, disabled states, chevron and reduced-motion-aware entrance; automated theme contrast and reduced-motion checks pass. User: inspect long labels, both themes, and reduced-motion appearance in the demo.

## 3. Filters and settings migration

- [x] 3.1 Migrate auto-refresh, board age, overview sort and pull-request project/state selects in `app.tsx`, `boardFilters.tsx`, `overview.tsx` and `pullRequests.tsx`; affected tests pass for values, conversions, URL/filter behavior and callbacks.
- [x] 3.2 Migrate `projectSettings.tsx` and `agentSettings.tsx` through existing setting wrappers; affected tests pass for option order, inheritance choices, busy disables, errors and save callbacks.
- [x] 3.3 Migrate permission controls in `changeDetail.tsx` and the consolidated `changePermissionPicker.tsx`, plus the console Agent picker in `sessionPanel.tsx`; preserve scope/inheritance wording and verify placement, behavior and no save while browsing.
- [x] 3.4 Update `src/ui/helpContent.tsx` to explain opening, searching, keyboard selection and dismissing dropdowns; Help tests pass.

## 4. Setup and creation forms migration

- [x] 4.1 Migrate selects in `setupWizard.tsx`, `newProject.tsx` and `addGithub.tsx`, retaining first-field focus and busy states; affected setup, project and GitHub UI tests pass for defaults, root selection, validation and submit timing.
- [x] 4.2 Migrate project selection and label addition in `newChangeForm.tsx`; affected creation and label tests pass for selection, reset, exhaustion and validation.

## 5. Integration and release note

- [ ] 5.1 `src/ui/` has no remaining native `<select>` elements; both builds, binary version, strict OpenSpec validation, and 275 focused migration tests pass. Local `bun run check` and PR #495's `check (ubuntu-latest)` stop at typecheck on mainline `tick-off-tasks-ui` errors: `SessionManager.shipPreviews`, `artifactsReady`, `ShipChoice`/`setShipAsk`, and `ShipPreflight`/`preview`/`click` are undefined in server/session/test files. CI did not reach tests or builds. PR #491 reported the same errors plus a missing `ChangePermissionPicker` import, which this branch fixes. Re-run `bun run check` after mainline fixes the listed symbols.
- [~] 5.2 Automated DOM/style checks cover keyboard, Escape, scrolling, themes, contrast, reduced motion, and no save while browsing. User confirmed the console Agent dropdown looks good. Still required: in the demo and macOS wrapper, check filters/settings/setup/creation in both themes, narrow viewport, 200% zoom, pointer and touch, keyboard-only use, screen-reader names/selection, modal Escape, scrolling, reduced motion, and confirm no new network requests.
- [x] 5.3 Added an independent What's new entry describing shared searchable dropdowns; wording matches the UI and `bun test test/whatsNew.test.ts` passes.
