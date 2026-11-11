# Design

## Context

See `proposal.md` for motivation and `specs/kanban-board/spec.md` for the behavior contract. Board filters are URL-backed in `src/ui/filters.ts`; `FilterBar` renders controls and `visibleCards` applies repository, search and activity restrictions. `Kanban` already receives change sessions and applies archive visibility and bounds after filtering. `hasRunningSession` matches `repoId`, change name and `state === "running"`, including archive sessions. Badge activity is separate from process state.

## Goals / Non-Goals

**Goals:** Keep a single definition of running across the new filter and existing archive/activity exceptions, and preserve the existing filtering and navigation pipeline.

**Non-Goals:** Add session states, infer activity from terminal text, include pull-request readiness or leftover worktrees in the running predicate, create a separate sessions view, or change polling and server behavior.

## Decisions

### Reuse the existing running-session predicate

Add a `runningOnly` boolean to `Filters` and test it through `hasRunningSession` in `visibleCards`, using the same change-session list already supplied for recent-activity exceptions. A waiting or quiet running process remains eligible. Matching any running session handles multiple records and archive actions; no branch-name inference is needed. Filtering by the card's animated working state was considered but would include pull requests without live agents and omit agents waiting for input.

### Extend the URL filter contract

Default `runningOnly` to false; parse only `running=1` as true and serialize it only when enabled. Include it in active-filter detection so Clear filters appears when it is the sole restriction. Clear through `EMPTY_FILTERS`, preserving layout as today. Existing URL helpers and board return links carry the choice through normal and demo routing. Local storage was considered but would make links and reload behavior inconsistent with other board filters.

### Add a switch beside the existing visibility controls

Use the filter bar's existing switch pattern with visible text **Show running**, an exposed checked state and explanatory tooltip that includes agents waiting for input. Keep it available when the session list is empty so a saved running-filter URL can always be cleared. A badge-state selector would introduce a broader feature without helping this request. Switches already expose their own state, so no additional removable tag is necessary.

### Preserve the current counting and archive pipeline

Apply running membership before grouping and archive bounding. Repository and search restrictions still narrow results; Hide archived still removes its column. Existing recent-activity and Hide merged exceptions already retain running changes. Keep lifecycle columns and the unfiltered To archive total unchanged. Re-render from session-list updates rather than storing a second list of matching cards, which could drift when sessions end or resume.

## Risks / Trade-offs

- ["Running" could be read as actively producing output] → Help and the tooltip explain that waiting and quiet agents are included; tests distinguish process state from badge state.
- [Session data arrives after the board or becomes stale] → Membership reflects the latest supplied list, using the existing polling/error behavior; do not infer running state from activity timestamps or add requests. A temporarily empty list can produce no matches.
- [The filter hides a known running change through search or Hide archived] → Keep switch state and existing filter controls visible, with integration coverage for composition and clearing.
- [A saved URL stays filtered when agent sessions are disabled] → Keep the switch and Clear filters usable even with zero sessions.

## Migration Plan

No persisted data migration or server change is needed. Existing URLs default to the current behavior. Ship the UI changes with Help and a new What's new entry. Reverting the UI change restores existing behavior; older clients ignore the new query parameter.
