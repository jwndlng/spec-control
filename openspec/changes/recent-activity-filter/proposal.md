# Proposal

## Why

The board's **Stale** filter works backwards. With `Idle 7+ days` selected it keeps only the changes that have had no
activity for a week and hides everything worked on recently, so the board loses exactly the cards the user is busy
with. Nobody narrows a board to look only at old work. What a long board needs is the opposite: hide what has gone
quiet and keep what is moving.

## What Changes

- **BREAKING** The filter is reversed: a threshold of N days now **hides changes whose last activity is more than N
  days old** and keeps those with activity within the last N days. It applies to every column, `Archived` included,
  the same way.
- A change with no known activity time is kept, never hidden by the threshold: the filter hides only what it knows
  to be old.
- A change with a running agent session is kept whatever its activity time, the same exception **Hide merged**
  already makes: an agent working on a change in its worktree is activity, even when the main checkout's copy is old.
- The selector is renamed from **Stale** to **Activity**, with the options `Any time`, `Last 7 days`, `Last 14 days`,
  `Last 30 days` and `Last 90 days`; its tag reads the same as the selected option (`Last 7 days`).
- The URL parameter becomes `active=<days>`. The old `stale=<days>` is ignored, so an old bookmark opens with the
  filter off rather than with the reversed meaning.
- The default stays off (`Any time`), so a board opened without a query string shows every change as today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: the **Board filters** requirement's stale threshold becomes a recent-activity threshold with the
  reversed meaning, the running-session exception and the unknown-time rule; **The board's filters form one filter
  bar** renames the **Stale** selector to **Activity** with its new option labels and the `active` URL parameter.

## Impact

- `src/ui/filters.ts` — the filter field, URL parsing and serialising, option labels and tag.
- `src/ui/kanban.tsx` — `visibleCards` and its caller, which passes the running sessions.
- `src/ui/boardFilters.tsx` — the selector's name and icon label.
- `test/boardFilters.test.ts`, `test/changeDetail.test.ts` (a `?stale=5` query carried through a link).
- `openspec/specs/kanban-board/spec.md` through the delta.
- No server, API, scanner or network change; invariants 1–7 are untouched.
