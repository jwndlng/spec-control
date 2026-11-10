# Tasks

## 1. URL-backed filter state

- [ ] 1.1 Add default-off `runningOnly` state, exact `running=1` parsing and serialization, and active-filter detection in `src/ui/filters.ts`; verify default/invalid values, round trips with existing filters, omission when off and layout-preserving clearing in `test/boardFilters.test.ts`.

## 2. Board filtering and controls

- [ ] 2.1 Apply the running predicate in `visibleCards` using the existing `hasRunningSession` helper and session list; verify working/waiting/quiet running sessions, archive and in-place sessions, exited/failed sessions, same-name changes in different repositories, multiple sessions and changeless-session exclusion in `test/boardFilters.test.ts`.
- [ ] 2.2 Add the Show running switch beside existing filter controls with checked state, keyboard support and an explanatory tooltip; verify its rendered semantics, toggle callback and Clear filters behavior in `test/boardFilters.test.ts`, including an empty session list.
- [ ] 2.3 Cover composition with search, repository selection, recent activity, Hide archived, Hide merged, archive bounds and board figures; verify matching-card counts and the unchanged To archive total with the existing board/session test helpers.
- [ ] 2.4 Update `src/ui/helpContent.tsx` to explain where Show running is, that waiting and quiet agents count, and how it combines with other filters; verify the Help text matches the spec and run `bun test test/helpContent.test.ts`.

## 3. Integration verification and release note

- [ ] 3.1 Verify the combined and project boards in normal and demo routing: toggling, reload, returning from a change, starting/ending/resuming sessions, no matches and clearing with sessions disabled; use synthetic data or the fake agent only, and confirm no extra API calls are introduced.
- [ ] 3.2 Run `openspec validate add-filter-show-running --strict` and `bun run check`; resolve failures and verify the change remains scoped to the proposal's Impact.
- [ ] 3.3 Add an independent What's new JSON entry under `src/ui/changelog/entries/` describing Show running on the board and inclusion of agents waiting for input; verify it with `bun test test/whatsNew.test.ts` and rerun `bun run check` before pushing.
