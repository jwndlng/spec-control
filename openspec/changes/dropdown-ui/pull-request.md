Dropdowns currently use browser-native selects with inconsistent sizing and limited support for finding choices in longer lists. This proposal defines a shared themed picker across filters, settings, setup and creation forms, with local search for lists of eight or more options, keyboard navigation, clear selection states and viewport-aware panels.

Existing values, defaults, inheritance, save timing and error feedback remain intact. Browsing or dismissing a dropdown never saves a choice. The design covers dialog Escape handling, focus, touch and reduced motion, and coordinates overlapping permission controls with `unify-change-permission-picker`.

Planned verification: focused DOM tests for search, keyboard/focus, disabled options, dismissal and exactly-once selection; affected UI regression tests; `bun run check`, binary and demo builds; and manual demo/macOS checks in both themes at narrow widths and 200% zoom, including screen-reader and touch interaction.

This PR contains planning artifacts only; implementation and its verification remain pending in `tasks.md`.
