# Proposal

## Why

An agent works in a session worktree under `~/.spec-control/worktrees/`, a path nobody types by hand. To look at or
touch up what the agent did, the user today copies a `cd` from the Console tab, switches to a terminal and opens their
editor from there. Most users want to see the work in their editor — usually VS Code — and one click should get them
there.

## What Changes

- An **Open in editor** control wherever the dashboard offers **Copy cd** for a change's session or session worktree:
  the Console tab's header, the Console tab's "no session record" state and the worktree entries of Open work. It
  starts the user's editor on that session's folder — the worktree, or, for an in-place session, the tracked folder
  the agent runs in.
- One global **Editor command** in the Agent sessions settings: an argument list, one argument per line, with an
  optional `{path}` placeholder; without it the folder is added as the last argument. Absent means VS Code's `code`, so
  the control works out of the box wherever `code` is on the `PATH`. Any other editor that opens a folder from a
  command line (`cursor`, `zed`, `subl`, `idea`, `open -a <App>`, …) is configured the same way.
- The editor is started without a shell, detached, with no terminal, no input and its output discarded. The dashboard
  waits for nothing beyond the start, records nothing and does not track the process; it reports a start failure, or
  that the editor's executable was not found, in place of the control.
- The folder is always the server's own — a session record's working directory or a session worktree it listed —
  never a path from the browser. Two mutating routes, same-origin only: `POST /api/sessions/<id>/editor` and
  `POST /api/worktrees/editor` with `{ repoId, name }`.
- Like the agent, the editor is a program the user asked for: what it changes is the user's doing. It is offered only
  where agent sessions apply, so with agent sessions off still no process that can modify a repository is started.
  Consoles and integration sessions, which belong to no change, get no control. The demo shows the control and starts
  nothing.

## Capabilities

### New Capabilities

- `editor-launch`: opening a change's session folder in the user's configured editor — the setting, where the control
  appears, which folder it opens, how the editor is started and what the dashboard does not do.

### Modified Capabilities

- `agent-sessions`: the Agent sessions section of Settings also holds the editor command.
- `change-detail`: the Console tab's actions and its "no session record" state include **Open in editor**.
- `dashboard-api`: the two editor routes, and `GET /api/sessions` reports whether the editor's executable was found.

## Impact

- `src/shared/types.ts` — `AgentSessionsConfig.editor?: string[]`, the `editor` entry (command in effect, found or not) of the session list.
- `src/server/config.ts` — schema for the editor command (non-empty arguments, no control character, `{path}` the
  only placeholder, at most once, never the first argument).
- `src/server/sessions/editor.ts` (new) — builds the argument list and starts the editor; `src/server/api.ts` — the
  two routes; `src/server/sessions/manager.ts` — resolving a session's or a session worktree's folder.
- `src/ui/agentSettings.tsx` — the Editor command field; `src/ui/sessionPanel.tsx`, `src/ui/sessions.tsx` — the
  control; `src/ui/api.ts`; the demo's API stand-in.
- `CLAUDE.md` — invariant 1 says the editor, like the agent, is the user's program, not a write by the dashboard.
- `src/ui/changelog.ts`, `src/ui/helpContent.tsx` — What's new and help.
- Tests: config, the editor launch with a fake editor on `PATH`, the routes' refusals, the UI control.
- No new git command, repository path, network access or write by the dashboard; invariants 1–7 hold.
