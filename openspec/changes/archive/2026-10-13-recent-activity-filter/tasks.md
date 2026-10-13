# Tasks

## 1. Filter state and labels

- [x] 1.1 In `src/ui/filters.ts` rename `staleDays` to `activeDays`, read and write it as `active=<days>` and stop reading `stale`; rename `STALE_PRESETS`, `staleLabel` and `staleOptions` to `ACTIVITY_PRESETS`, `activityLabel` (`Any time` / `Last N days`) and `activityOptions`, and use the new label for the tag in `activeTags`; `test/boardFilters.test.ts` covers the option labels, a custom `active=10` value, the round trip, the tag and its removal, `hasActiveFilters`, and that `?stale=10` parses to `activeDays: 0` with no tag
- [x] 1.2 Update the `?stale=5` link in `test/changeDetail.test.ts` to `?active=5`; `bun test test/changeDetail.test.ts` passes

## 2. Reversed filtering

- [x] 2.1 Change `visibleCards` in `src/ui/kanban.tsx` to take the session list and keep a card when `activeDays` is 0, its `lastActivityAt` is missing or unreadable, it has a running session (`hasRunningSession`), or `now - lastActivityAt < activeDays × 24 h`; pass `sessions` from the board; tests in `test/boardFilters.test.ts` cover a recent and an old active change, a recently and a long-ago archived change, a card with no activity time, an old change with a running session, the same change with an ended session, and a change-less session keeping nothing, and the existing pull-request test uses `?active=3`
- [x] 2.2 Rename the selector in `src/ui/boardFilters.tsx` to **Activity**, driven by `activityOptions`; a component or snapshot test (or the existing filter bar test) shows the caption `Activity` and `Last 7 days` selected for `?active=7`

## 3. Check

- [x] 3.1 `grep -rn "staleDays\|staleLabel\|staleOptions\|STALE_PRESETS\|stale=" src test` returns nothing, `bun run check` passes, and `bun run dev` shows a board where `Last 7 days` hides changes idle for more than a week and keeps the recent ones
