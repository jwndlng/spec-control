# Proposal

## Why

The repository board header has a line of its own showing the project's path in monospace, followed by a **Copy cd**
button. Neither earns its space: the path is long and rarely read, and the header already has the checkout status, the
branches control and the board's actions competing for attention. The user asked for both to go.

## What Changes

- Remove the path line from the repository board header: the monospace path and its **Copy cd** button.
- Keep the path discoverable without a line of its own: the repository name in the header's breadcrumb carries the
  full path as its tooltip, as overview rows already do.
- Nothing else changes. The **Copy cd** controls elsewhere — the session panel, the project console, the change
  detail's worktree path, the branches dialog's per-checkout paths — stay, and so does `cdCommand`, which they use.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-overview`: the "Repository board header" requirement no longer shows the path or offers an action that
  copies `cd <path>`; the repository name exposes the path as a tooltip instead, and the "Copy cd" scenario now says no such action is offered.

## Impact

- `src/ui/kanban.tsx` — the board header (`RepoHeader`): drop the `row path` line, add the path as the name's tooltip.
  `CopyButton` stays exported; `cleanup.tsx`, `commandSteps.tsx` and `changeDetail.tsx` use it.
- `src/ui/styles.css` — drop the now unused `.repo-head .path` rules.
- `openspec/specs/project-overview/spec.md` — through the delta in this change.
- No server, API, config or git behaviour changes; no invariant is touched.
