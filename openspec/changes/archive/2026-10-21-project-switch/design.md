# Design

## Context

`RepoHeader` in `src/ui/kanban.tsx` renders the breadcrumb `Projects / <name>`, the name a plain `<span>` with the path
as its tooltip. The board receives the whole snapshot, so every tracked project is at hand without a request. The board
is keyed by its path in `app.tsx`, so navigating to another `/repo/<id>` remounts it with that project's state. The
board filter bar's `RepoMenu` (`src/ui/boardFilters.tsx`) already has the open/close pattern — outside pointer, focus
leaving, Escape that stops propagation and returns focus — and the `.menu` / `.menu-list` / `.menu-item` styles.
`nameHints` (`src/shared/nameHints.ts`) gives the overview's path hints.

## Goals / Non-Goals

**Goals:** one click from a board to any other board; keyboard-complete; works for many projects (search).

**Non-Goals:** a global shortcut or command palette; a switcher in the change detail view or the hero; recent or pinned
projects; carrying the board's filters across.

## Decisions

- **The breadcrumb's name is the trigger.** It is where the user already looks for "which project am I in"; a separate
  control would repeat the name. Alternative — a select in the band's actions — competes with the actions area, which
  the kanban-board spec keeps for actions.
- **Entries are links, not a listbox.** An `<a href>` per project with `followInApp` keeps ⌘/middle click and "copy
  link" for free and matches the overview rows. A `role="listbox"` would need `aria-activedescendant` bookkeeping and
  lose native link behaviour. Arrow keys move real focus between the links; Enter on a link is native.
- **The new board opens without a query.** Like the overview's row links: a search typed on one board rarely means
  anything on another, and a carried filter that hides everything would read as an empty project.
- **Pure state in `projectSwitchState.ts`.** `switchEntries(repos, currentId)` (sorted, hints via `nameHints`, current
  and failed flags) and `filterEntries(entries, q)` are tested without a DOM; the component is thin.
- **Reuse the menu styles.** `.menu-list` gets a modifier for the search field and the empty note; no new tokens.

## Risks / Trade-offs

- [The name turns into a button, so it no longer reads as plain heading text] → it keeps the heading's weight and only
  adds a chevron and a hover background, so the breadcrumb looks the same at rest.
- [A very long list] → `.menu-list` already caps its height and scrolls; the search field narrows it.
