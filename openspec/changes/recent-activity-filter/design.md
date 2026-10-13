# Design

## Context

The filter is client-only: `parseFilters`/`serializeFilters` in `src/ui/filters.ts` keep `staleDays` in the URL as
`stale=<days>`, `visibleCards` in `src/ui/kanban.tsx` drops a card when `daysSince(lastActivityAt) < staleDays` or
when its activity time is unknown, and `src/ui/boardFilters.tsx` draws the **Stale** selector from `staleOptions`.
A card's `lastActivityAt` comes from the scanner (last commit touching the change's folder, or a newer uncommitted
edit), so for an archived change it is usually the archive commit. The board already has the session list, and
`hasRunningSession` in `src/ui/sessionState.ts` is what **Hide merged** uses to keep a change with a running session.

## Goals / Non-Goals

**Goals:**
- Reverse the comparison and rename everything that carries the old meaning, so no name says "stale" while the code
  keeps recent cards.
- Make an old `stale=` link harmless.

**Non-Goals:**
- Changing how `lastActivityAt` is derived, or looking at worktree copies' activity for a card.
- Turning the filter on by default, or remembering it outside the URL.
- Touching the projects overview, Open work or the activity view.

## Decisions

- **Rename the field and the parameter: `staleDays` → `activeDays`, `stale=` → `active=`.** Keeping `stale=` with
  the reversed meaning would make every existing bookmark silently show the opposite set of cards. A new name lets
  `parseFilters` simply not read `stale`, so the old link opens unfiltered. Alternative considered: translate
  `stale=N` into something — rejected, there is no equivalent of "only old ones" any more.
- **Comparison on milliseconds, not floored days.** A card is kept when `now - lastActivityAt < N × 24 h`. The old
  code floored to whole days; with the reversed meaning flooring would keep a card that is 7 days and 20 hours old
  under `Last 7 days`. `daysSince` stays as it is for its other callers.
- **Unknown time is kept.** The filter's job is hiding what is known to be old; hiding a card because its time could
  not be read would make it vanish for a reason the user cannot see.
- **Running session keeps a card, via `hasRunningSession`.** `visibleCards` gains the session list as a parameter
  (the board already passes it to `archivedShown`). Reusing the same helper keeps the two exceptions identical: own
  or archive session, running only, change-less sessions keep nothing.
- **Labels from one function.** `activityLabel(days)` gives `Any time` for 0 and `Last N days` otherwise, used for
  both the option and the tag, as `staleLabel` is today. Presets stay 7, 14, 30, 90. The selector keeps the clock
  icon; its caption becomes `Activity`.

## Risks / Trade-offs

- [An old bookmark with `stale=` loses its filter] → Intended: the alternative is showing the wrong cards. The
  parameter stays in the address bar until the user changes a filter; it is harmless.
- [The `To archive` count and the overview still count hidden cards] → Unchanged behaviour: `boardStats` already
  counts `toArchive` over all cards and `open` over the visible ones; the filter only changes which cards are visible.

## Migration Plan

None beyond the parameter rename above. Nothing is stored outside the URL, and no server or snapshot changes.
