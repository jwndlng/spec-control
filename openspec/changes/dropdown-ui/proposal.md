# Proposal

## Why

Dropdowns currently use browser-native selects with inconsistent sizing and little help finding choices in longer lists. A shared picker can make everyday filtering and configuration feel current while keeping selection accessible and predictable.

## What Changes

- Replace existing single-value select dropdowns with one shared Preact control across the dashboard, settings, setup and creation forms.
- Use a compact themed trigger and elevated option panel with clear hover, keyboard-focus, selected and disabled states, a selected checkmark and subtle motion that respects reduced-motion preferences.
- Add local search for longer lists, keyboard navigation, selected-option scrolling, outside dismissal and viewport-aware positioning.
- Preserve option values, ordering, inherited/default choices, labels, save timing, error feedback and existing actions. Browsing or searching choices never saves a value.
- Document the interactions in Help and add an independent What's new entry.

## Capabilities

### New Capabilities

- `dropdown-controls`: Shared single-value dropdown presentation, local search, accessible interaction and selection behavior throughout the UI.

### Modified Capabilities

None. Existing domain settings, filters, theme selection and persistence contracts continue to apply.

## Impact

- New shared component and interaction helpers under `src/ui/`, plus `src/ui/styles.css` using existing theme tokens; no new runtime dependency or network access.
- `src/ui/modal.tsx` and affected dialog Escape handlers: allow an open dropdown to consume Escape before the surrounding dialog closes.
- Select call sites: `src/ui/app.tsx`, `boardFilters.tsx`, `overview.tsx`, `pullRequests.tsx`, `projectSettings.tsx`, `agentSettings.tsx`, `sessionPanel.tsx`, `changeDetail.tsx`, `setupWizard.tsx`, `newProject.tsx`, `addGithub.tsx` and `newChangeForm.tsx` (all under `src/ui/`).
- Focused component DOM tests and existing affected UI tests under `test/`; `src/ui/helpContent.tsx` and a new file under `src/ui/changelog/entries/`.
- Verify the existing demo with both themes and the bundled UI build. No API, server, configuration schema or repository-write changes.
- Coordinate shared call sites with the in-flight `unify-change-permission-picker` change: this change owns dropdown presentation and interaction; that change owns permission-control placement and inheritance wording. Preserve its consolidated control if it lands first.
