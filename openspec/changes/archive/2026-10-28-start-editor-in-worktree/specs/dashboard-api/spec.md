## ADDED Requirements

### Requirement: Editor endpoints
The API SHALL provide `POST /api/sessions/<id>/editor`, which opens the editor of the `editor-launch` capability on that
session's working directory, and `POST /api/worktrees/editor` with `{ repoId, name }`, which opens it on that session
worktree; both SHALL take the folder from the server's own session records and session worktree list and SHALL return
`{ started: true, command }` once the editor was started, `command` being the argument list that ran. `repoId` MUST be a
configured repository and `name` MUST be a single path segment of lower-case letters, digits, dots, dashes and
underscores. A request SHALL be refused, with no process started, with `403` when agent sessions are disabled or the
repository is excluded from them; `404` for an unknown session, repository or worktree; `400` for an invalid `name` or
for a session that belongs to no change (the main console, a project console or an integration session); `409` when
the folder no longer exists; `503` when the editor's executable is not found, naming the command; and `500` with the
system's reason when the start fails. Both routes are mutating and subject to the same-origin protection that applies
to every mutating API request. `GET /api/sessions` SHALL additionally return `editor`: the editor command in effect
(the configured one, or `code`) and whether its executable was found on this machine.

#### Scenario: Opening a session's worktree
- **WHEN** `POST /api/sessions/<id>/editor` is sent for an ended change session whose worktree exists
- **THEN** the response is `200` with `started: true` and the command that ran, whose last argument is that worktree's path

#### Scenario: Path traversal
- **WHEN** `POST /api/worktrees/editor` is sent with `name` set to `../x`
- **THEN** the response is `400` and no process is started

#### Scenario: A console is refused
- **WHEN** `POST /api/sessions/<id>/editor` names a project console session
- **THEN** the response is `400` and no process is started

#### Scenario: Feature disabled
- **WHEN** agent sessions are disabled and `POST /api/worktrees/editor` is sent
- **THEN** the response is `403` and no process is started

#### Scenario: Editor not found
- **WHEN** the editor command is `my-editor`, which is not on the `PATH`, and an editor request is sent
- **THEN** the response is `503` naming `my-editor`, and `GET /api/sessions` reports the editor as not found

#### Scenario: Editor routes are same-origin only
- **WHEN** a page from another origin sends `POST /api/worktrees/editor`
- **THEN** the response is `403` and no process is started
