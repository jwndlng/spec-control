# Proposal

## Why

Users checking several agents need to find the changes with a live session without searching through every card on the board. Recent activity and lifecycle columns do not identify which agents are still running, including those waiting for input.

## What Changes

- Add a **Show running** board filter, off by default, on the combined and project boards.
- Keep only changes with at least one running change session, including archive sessions and agents whose badge says they are waiting or quiet.
- Match by repository and change name, update from the existing session list, and compose with existing filters and archived-card rules.
- Persist the choice as `running=1` in the board URL and include it in **Clear filters**.
- Explain the filter in Help and add an independent What's new entry during implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: Add a session-based filter alongside the existing board filters, with URL persistence and live updates.

## Impact

- Implementation: `src/ui/filters.ts`, `src/ui/boardFilters.tsx`, and `src/ui/kanban.tsx`, reusing `hasRunningSession` from `src/ui/sessionState.ts`.
- Verification: `test/boardFilters.test.ts`, plus existing board/session and URL tests as appropriate.
- User guidance: `src/ui/helpContent.tsx`, related Help tests if needed, and a new file under `src/ui/changelog/entries/`.
- Planning artifacts stay under `openspec/changes/add-filter-show-running/`. No new API, dependency, session polling, or repository writes are needed.
