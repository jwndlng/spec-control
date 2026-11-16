# Design

## Context

See `proposal.md` for motivation and `specs/dropdown-controls/spec.md` for the behavior contract. Current dropdowns are native selects distributed across twelve UI modules. Shared project-setting wrappers already centralize several option lists; other forms use empty-string placeholders and focus refs. Tests often inspect select VNodes directly, so migration includes updating meaningful assertions about labels, values and callbacks.

The UI is Preact, built into one offline HTML file and used by the browser, macOS wrapper and demo. Existing theme tokens supply both appearances. `ActionMenu` provides useful positioning and dismissal precedent, but represents commands and uses menu semantics. `Modal` listens for Escape on document capture, before a dropdown's own handler could consume it. Scrollable dialogs and transformed project tiles also make a simple absolutely positioned list unreliable.

## Goals / Non-Goals

**Goals:** Keep transient dropdown state separate from caller-owned values; deliver the same interactions in compact toolbars and larger form fields; preserve accessible labels, first-field focus and form navigation; keep the implementation small enough to audit and bundle locally.

**Non-Goals:** Redesign action menus, split buttons, folder browsers, checkbox lists or chips; introduce editable arbitrary values or a general multi-select; change permission policy, setting inheritance, filtering rules, routes or save APIs. The label-adder remains a single selection that appends a chip through its existing caller.

## Decisions

### 1. One controlled select component with explicit options

Add `src/ui/select.tsx` with typed options `{ value, label, disabled? }`, a controlled string value and `onChange(value)`. Accept accessible-name/description attributes, an id, title, disabled state, compact sizing and a trigger focus ref. The caller owns conversions to numbers, optional values and enums, and continues to own saving and error feedback. A placeholder can be a selectable empty-string option where existing semantics require it. No hidden native select is needed for existing forms, which already keep values in Preact state.

Opening copies no value into persistent state. Keep only open state, query, active option id and placement locally. Committing calls back once only when the enabled value differs from the current controlled value; dismissing calls nothing. Reconcile active ids when options change and close when disabled or unmounted. Reset search on every close. Preserve the selected value supplied by the caller even when temporarily absent from options; display the supplied placeholder when no matching label exists, without auto-selecting or saving a replacement.

Alternatives: CSS-only native selects cannot provide a consistent searchable panel. A large select library adds dependency and styling surface for a narrow offline control. Parsing arbitrary option children would hide the component's data contract.

### 2. Separate short-list selection from searchable selection

For fewer than eight total options, the trigger is a button with `aria-haspopup="listbox"`, `aria-expanded` and `aria-controls`; opening focuses a labelled listbox that uses `aria-activedescendant`. Arrow keys navigate enabled options, Home/End reach the ends, and Enter or Space commits. A short-lived typed prefix moves the active option without saving.

At eight or more options, opening focuses a labelled search input with combobox semantics, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`. The input and listbox share the same filtered option state. Space types into search; Enter commits. Home/End navigate matches while open as specified. Filter using a case-insensitive label substring while preserving caller order. Keep disabled matches visible but skip them when navigating; a status region announces the result count or no results. Initially activate and scroll to the selected enabled option, otherwise the first enabled option. No enabled matches means no active descendant or commit target.

Use stable option ids and `aria-selected`/`aria-disabled`, an actual checkmark for the committed option and a separate active background/focus outline. Visible field labels target the trigger id. Existing first-field refs focus the trigger. On Tab, dismiss and move relative to the trigger's place in the form, including Shift+Tab; popup DOM order must not trap or restart traversal.

Alternative: always showing a search box adds an unnecessary step for two- or three-option settings. Using action-menu roles would describe the wrong interaction to assistive technology.

### 3. Render an anchored panel outside clipping containers

Use a Preact portal into the closest containing dialog element, or document body for page controls. Mount it directly under that host outside scrolling bodies and transformed cards; keep dialog popups within their modal accessibility boundary. Apply fixed positioning, clamped viewport margins, trigger-width minimum where space permits and a bounded internally scrolling option list. Measure available space above/below the trigger and choose the larger usable side when below cannot fit. Wrap long labels and cap width at the viewport. Recompute on resize and ancestor scrolling, or dismiss if the anchor leaves view. Internal list scrolling leaves it open.

Pointer handling recognizes both trigger and portalled panel as inside, supports touch, and stops interaction from invoking enclosing row/card actions. A small shared open-control coordinator closes a previous dropdown before opening another; unregister listeners and ownership on close/unmount. Outside dismissal leaves focus at the outside target. Selection and Escape restore focus to the connected trigger.

Alternative: an inline popup is simpler but can be clipped or anchored to a transformed ancestor; an unconditional body portal can place a popup outside its modal's accessible subtree.

### 4. Give open dropdowns first refusal on Escape

Provide a small shared helper for dialog-level capture handlers to dismiss the active dropdown and consume that Escape before closing the dialog. Update `Modal` and other affected dialog capture handlers, including setup and detail where applicable. Do not rely on bubbling `stopPropagation` to beat a document capture listener. The next Escape follows the surrounding dialog's existing close behavior. Test this with the real modal wrapper.

### 5. Style with existing tokens and migrate all current select call sites

Use a quiet bordered trigger, rounded elevated panel, a small gap from the trigger, restrained shadow, rotating chevron and short opacity/translation entrance only when reduced motion is not requested. Use existing foreground, background, border and accent tokens; verify text contrast in both themes. Preserve compact toolbar dimensions and use comfortable option spacing for touch. Keep animation off the positioning wrapper so it cannot change anchor calculations.

Replace the call sites listed in the proposal, keeping project-setting wrapper exports and their domain option generation. Preserve default/inherit/keep-each choices, saving disables, error rendering, label-add reset, and typed conversions. Update tests to assert shared-control props or rendered user behavior instead of depending on native select event objects. Coordinate overlapping permission-picker edits as described in the proposal; no implementation dependency is required.

Alternative: migrating only high-visibility selectors leaves two interaction systems for the same field type and misses dialog and setup issues.

## Risks / Trade-offs

- Custom controls take on browser accessibility behavior → test real DOM focus and keyboard interactions, then manually verify screen-reader announcements and touch in the demo and macOS wrapper.
- Portal focus and capture handlers can close the wrong surface → test first Escape, outside clicks, Tab/Shift+Tab and multiple open attempts inside a real modal.
- Caller refreshes can invalidate active options → reconcile by value, validate again at commit, and never emit changes during reconciliation.
- Dense layouts and long names can overflow → verify narrow widths, 200% zoom, viewport edges and internal scrolling in both themes.
- Permission-picker work may land during migration → preserve its final placement and wording and adapt only the shared-control binding.

## Migration Plan

Ship the shared component, all current call-site migrations, Help and What's new in one implementation change. No data migration or configuration flag is needed. Run focused DOM and affected UI tests, `bun run check`, the binary build and demo build; manually check the scenario matrix above. Reverting the implementation restores native selects without changing stored values.
