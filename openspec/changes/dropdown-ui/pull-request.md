This change replaces native selectors with a shared controlled dropdown across filters, settings, setup and creation forms. Short lists support keyboard navigation and type-ahead; lists with eight or more options support local search. The picker preserves caller-owned values, supports disabled options, positions within dialogs or the viewport, and dismisses without saving. Help and What's new describe the delivered behavior.

Checks passed:

- `bun run check` — lint, typecheck and 2,336 tests across 187 files.
- `bun run build`, `bun run build:demo`, and `dist/spec-control --version` (`dev`).
- `bunx openspec validate dropdown-ui --strict --json`.
