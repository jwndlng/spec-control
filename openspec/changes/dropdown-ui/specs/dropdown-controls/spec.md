# Spec Delta

## Purpose

Provide consistent, accessible single-value dropdowns that help users find and choose existing options across dashboard filters, settings and forms.

## ADDED Requirements

### Requirement: Dropdowns share a themed presentation
Single-value dropdowns throughout the dashboard SHALL use a consistent trigger and option panel. The trigger SHALL display the current value or placeholder and an expansion indicator. Options SHALL have distinct hover, keyboard-active, selected and disabled states, with a non-colour selected indicator. Both themes SHALL apply, text SHALL meet 4.5:1 contrast, and reduced-motion preferences SHALL suppress popup animation.

#### Scenario: Consistent controls across views
- **WHEN** the user opens dropdowns in filters, settings, setup or creation forms
- **THEN** each uses the shared visual treatment and clearly identifies its selected option

#### Scenario: Theme changes while open
- **WHEN** the user changes the active theme with a dropdown open
- **THEN** its trigger and panel use the active theme without losing the selection

#### Scenario: Reduced motion enabled
- **WHEN** the operating system requests reduced motion
- **THEN** opening and closing dropdowns uses no popup animation

### Requirement: Selection preserves caller behavior
Dropdowns SHALL retain the supplied option order, values, labels, placeholders, default and inheritance choices, disabled states and caller save timing. Only explicitly committing an enabled option SHALL emit a selection. Opening, navigating, filtering or dismissing SHALL NOT emit a selection or submit the surrounding form. Selecting the already selected value SHALL NOT emit a redundant change.

#### Scenario: Browsing permission choices
- **WHEN** the user opens a permission-profile dropdown, navigates options and presses Escape
- **THEN** no permission is saved and the previous selection remains displayed

#### Scenario: Committing an inherited value
- **WHEN** the user selects the enabled inheritance option with an empty-string value
- **THEN** the caller receives that exact value once and its existing save behavior applies

#### Scenario: Disabled choice
- **WHEN** an option or the whole dropdown is disabled
- **THEN** that disabled choice cannot be committed by pointer or keyboard

#### Scenario: Add another label
- **WHEN** the user commits a label in the new-change form and the caller resets the value to its placeholder
- **THEN** the label is added once, the placeholder is displayed again and the form remains unsubmitted

### Requirement: Dropdowns support accessible keyboard selection
Each dropdown SHALL have an accessible name, expanded state and associated listbox with selected and disabled option semantics. Enter, Space or an arrow key SHALL open a focused trigger. Arrow keys SHALL navigate enabled options; Home and End SHALL reach the first and last enabled matches; Enter SHALL commit. Focus and the active option SHALL remain identifiable to assistive technology.

#### Scenario: Keyboard-only selection
- **WHEN** the user tabs to a dropdown, opens it, moves to another enabled option and presses Enter
- **THEN** that option is committed once, the panel closes and focus returns to the trigger

#### Scenario: Existing field label
- **WHEN** a field has a visible label or an existing accessible name
- **THEN** the replacement dropdown retains that accessible name and activating its visible label focuses its trigger

#### Scenario: Opening at the selection
- **WHEN** the user opens a dropdown whose current option is enabled
- **THEN** that option is initially active and scrolled into view

### Requirement: Longer dropdowns offer local search
Dropdowns with at least eight options SHALL offer a labelled search field that filters by case-insensitive label substring without changing the committed value or making network requests. Shorter dropdowns SHALL support type-ahead navigation. Search SHALL reset on close, and no matches SHALL show an announced empty state with no selectable result.

#### Scenario: Find a project
- **WHEN** a project dropdown has at least eight options and the user types part of a project name into search
- **THEN** matching options remain in their original order and no project is selected until explicitly committed

#### Scenario: No matching option
- **WHEN** the query matches no option
- **THEN** the panel announces no results, Enter does nothing and clearing search restores the options

#### Scenario: Reopen after searching
- **WHEN** the user dismisses a filtered dropdown and reopens it
- **THEN** the full list is restored with the committed option active when available

#### Scenario: Type ahead in a short list
- **WHEN** the user types a label prefix in an open dropdown with fewer than eight options
- **THEN** the matching enabled option becomes active without committing it

### Requirement: Dropdown dismissal cooperates with surrounding UI
Escape, Tab, an outside pointer action or opening another dropdown SHALL dismiss the open panel without committing. Escape SHALL restore trigger focus; Tab and outside actions SHALL retain their normal focus destination. The first Escape inside an open dropdown SHALL leave its surrounding dialog open. Dropdown interaction SHALL NOT activate an enclosing card or row.

#### Scenario: Escape inside a dialog
- **WHEN** a dropdown is open in a modal and the user presses Escape
- **THEN** only the dropdown closes and its trigger receives focus

#### Scenario: Continue through the form
- **WHEN** the user presses Tab from an open dropdown
- **THEN** the panel closes without saving and focus advances to the next form control

#### Scenario: Pointer or touch selection
- **WHEN** the user clicks or taps an enabled option within a clickable project row
- **THEN** it is committed once, the panel closes and the row action does not run

### Requirement: Panels remain usable in constrained layouts
Dropdown panels SHALL stay within the viewport, choose available space above or below their trigger and scroll long lists internally. They SHALL remain usable inside dialogs and scrolling containers at narrow widths and enlarged text. When scrolling or resizing would detach the panel from its trigger, the panel SHALL reposition or dismiss without committing.

#### Scenario: Trigger near viewport edge
- **WHEN** a dropdown opens near the bottom or right edge of a narrow viewport
- **THEN** its panel fits within the viewport and all choices remain reachable through internal scrolling

#### Scenario: Scroll a long option list
- **WHEN** the user scrolls inside an open option list
- **THEN** options scroll while the panel stays open

#### Scenario: Options change while open
- **WHEN** refreshed caller data removes the active option or disables the control
- **THEN** the dropdown chooses a valid enabled active option or closes without emitting a selection, and never commits a removed option
