# Proposal

## Why

A change can span several sessions and pull requests. Showing one branch’s review, checks, work status and implementation model above the timeline makes those details look like facts about the whole change.

## What Changes

- Keep change identity, status labels, source issue, checkout provenance, dependencies, warnings and change actions above the timeline.
- Show pull requests at their lifecycle checkpoints and the recorded Implement model at Implementing. Drop the header’s PR availability notice.
- Keep the source checkout’s path and copy control when the snapshot comes from a linked worktree. Show individual sessions’ paths and work status in Console.

## Capabilities

### New Capabilities

### Modified Capabilities

- `change-detail` defines which facts belong above the timeline.
- `kanban-board` updates references from card and session-list requirements to detail surfaces.
- `pull-requests` updates where detail consumes cached PR information.
- `demo-site` demonstrates the same placement with simulated data.

## Impact

The implementation touches the change detail and lifecycle timeline components in `src/ui/`, header-specific PR presentation in `pullRequests.tsx`, and their change detail, timeline, worktree, board, PR and demo tests. The existing Console panel and the in-flight `restructure-console-header` change own session controls. The selected path is rendered in the Console facts row in `sessionPanel.tsx`. This change uses the existing snapshot, session and delivery data.
