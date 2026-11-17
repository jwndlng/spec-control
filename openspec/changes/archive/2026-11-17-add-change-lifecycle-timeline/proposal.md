# Proposal: Organize change detail around a lifecycle timeline

## Why

Lifecycle actions compete with session maintenance, making change detail harder to navigate than the agent workflow it manages.

## What Changes

- Add a schema-aware timeline above file tabs with phase nodes and smaller artifact milestones.
- Place the contextual Draft artifacts, Implement, and Archive actions on the timeline and show delivery status separately from local progress.
- Move session maintenance to a menu and put an accessible copy-path icon beside the worktree path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: Timeline, contextual phase actions, session menu, and copy-path affordance.

## Impact

- `src/ui/changeDetail.tsx`
- `src/ui/sessionPanel.tsx`
- `src/ui/sessionState.ts (timeline derivation only)`
- `new timeline component and view model under src/ui/`
- `src/ui/styles/ or existing stylesheet files`
- `src/ui/demo/`
- `src/ui/helpContent.tsx`
- `test/ (timeline/detail/session UI)`
- `src/ui/changelog/entries/`

## Dependencies and session ownership

Required predecessors: `automate-lifecycle-delivery` Start the implementation session in this change's dedicated worktree and merge predecessors first. Shared files are owned only for the listed concern; do not refactor neighboring functionality. Refresh against latest origin/main before implementation and re-read predecessor contracts.

Shared-file landing order and external proposal overlaps are documented in SESSION.md. Implement only this change, never the former umbrella.
