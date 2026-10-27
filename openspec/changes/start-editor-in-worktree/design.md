# Design

## Context

A change session's folder is known on the server: `Session.worktreePath` (the worktree, or the tracked folder for an
in-place session) and the session worktree list (`SessionWorktree.path`, under `~/.spec-control/worktrees/<repo>/`). The
UI shows it through **Copy cd** in `src/ui/sessionPanel.tsx` (Console tab header and the no-record state) and in
`src/ui/sessions.tsx` (`OrphanActions`, Open work). Processes are started without a shell everywhere; the one
fire-and-forget start today is `openBrowser` in `src/server/index.ts` (`Bun.spawn(...).unref()`). Agent executables are
looked up with `Bun.which`, and the desktop app already gives the server its login shell's `PATH`, so `code` installed
by VS Code's "Install 'code' command in PATH" is found there too. Invariant 1 says that with agent sessions disabled no
process that can modify a repository is started; an editor can.

## Goals / Non-Goals

**Goals:**
- One click from a change's session to the user's editor on that folder, VS Code without any setting.
- No path from the browser on a command line; no new write, git command or network access.

**Non-Goals:**
- Per-project or per-agent editors. One global command; a per-project override can come later without changing it.
- Editor presets or detection of installed editors. The field's hint names examples; `code` is the only default.
- Opening the main checkout, the main console's folder or a project console's folder. Those belong to no change; the
  project console already offers the folder to its agent.
- Opening a linked worktree the dashboard did not create (the detail header's worktree badge). It is not a session
  folder and is shown even with agent sessions off; it can follow once this has proven itself.
- Knowing whether a window actually opened. `code` hands off to a running VS Code and exits; the dashboard can only
  say it started the command.

## Decisions

### D1 — `agentSessions.editor?: string[]`, `{path}` optional, `code` when absent

An argument list like an agent's command keeps the no-shell rule and covers `open -a <App> {path}`. Appending the path
when `{path}` is missing keeps the common case to one line (`code`, `zed`, `cursor`). Absent means `["code"]` so the
default can change later without rewriting configs, and a fresh config stays as it is. Validation in
`src/server/config.ts` mirrors `launchArgs`: non-empty arguments, no control character, `{path}` the only placeholder,
at most one argument holding it, never the first. No bypass check — it is not an agent.

Alternatives: a single string (needs a shell or a parser — refused by the project's rules); a list of presets (more UI
than the request needs, and every editor's CLI is already one line).

It lives under `agentSessions` because it is offered only where agent sessions apply (D4) and edited in that section.

### D2 — The browser names a session or a worktree, never a path

`POST /api/sessions/<id>/editor` takes the folder from the session record; `POST /api/worktrees/editor` takes
`{ repoId, name }`, validated exactly as `/api/worktrees/remove` validates them, and resolves the folder from the
server's session worktree list. Two routes instead of one `{ path }` route because accepting a path would mean checking
it against every list anyway, and a path from the browser on a command line is what invariant 1 and the session rules
keep out. The `{path}` substitution uses only that server-side string.

Before starting, the server checks the folder exists (`stat`, a directory) so a deleted worktree is a clear `409`
instead of an editor opening an empty window.

### D3 — Start detached, wait for nothing, keep nothing

`src/server/sessions/editor.ts`: `editorArgv(config, folder)` (pure, tested) and `openEditor(argv, folder)`, which checks
`Bun.which(argv[0])` (`503` with the command when missing) and runs `Bun.spawn(argv, { cwd: folder, stdin: "ignore",
stdout: "ignore", stderr: "ignore", detached: true }).unref()`. A synchronous spawn error becomes `500` with its message.
Exit codes are not awaited: `code` and `open` exit at once after handing off, while other editors stay in the
foreground for as long as they are open, so an exit code means nothing either way. No PTY, no session record, no
activity entry, no keep-awake: it is not an agent and nothing about it is the dashboard's to watch. `detached` keeps the
editor alive when the dashboard (or the desktop app's server child) stops.

The environment is the server's own, unchanged — an editor needs no variable removed, and the agent profile's
`unsetEnv` is about the agent's login.

### D4 — Offered only where agent sessions apply, and only for change sessions

The control sits beside **Copy cd** for change sessions and session worktrees (`sessionPanel.tsx`, `OrphanActions` in
`sessions.tsx`), so it inherits the feature switch and per-repository exclusion; the routes re-check both (`403`). This
keeps invariant 1's "with agent sessions disabled no process that can modify a repository is ever started" true without
an exception. Changeless sessions (`isChangeless()`) are refused (`400`) and get no control.

### D5 — Availability reported with the session list

`GET /api/sessions` gains `editor: { command: string[], found: boolean }`, computed like the agents' `found` with
`Bun.which`. The UI disables the control with "`<cmd>` was not found — change the editor in Settings" and links to
`/settings?section=agents`. The tooltip shows the command that will run, with the folder.

### D6 — The demo

The demo's in-memory API (`src/ui/demo/demoApi.ts`) implements both calls by refusing with "The demo opens no editor",
and reports the editor as found so the control is visible and enabled.

## Risks / Trade-offs

- [`code` not on `PATH` — common on macOS until the user runs VS Code's "Install 'code' command"] → the control is
  disabled with that reason and a link to Settings; the help page names the VS Code command and `open -a "Visual
  Studio Code" {path}` as an alternative.
- [The editor writes into an in-place session's tracked folder] → that is the user's own editor, opened on their click,
  exactly as the agent there is; the panel already says in-place work has no branch and no undo. CLAUDE.md invariant 1
  gains a sentence saying the editor is the user's program, like the agent.
- [A user configures something that is not an editor] → it is their command, started without a shell with one
  server-chosen path; the dashboard grants it nothing the user's own terminal would not.
- [A misconfigured editor that never exits, started repeatedly] → each click starts one process the user asked for;
  no retry, no loop.

## Migration Plan

Additive. A configuration without `editor` means `code`. Rollback: an older binary's schema drops the unknown `editor`
key when it loads the configuration (and loses it on its next save), so the control is gone and nothing else changes;
the user sets the command again after upgrading.
