## MODIFIED Requirements

### Requirement: Session endpoints

The API SHALL provide: `POST /api/sessions` with `{ repoId, change, action }` to open a session — with optional `resolveConflicts: true`, which opens it for Resolve conflicts as the `agent-sessions` capability specifies, taking the branch and pull request from the server's own scan and pull-request cache and ignoring any branch or pull-request field in the request — (returning, once the request passed the refusals listed below, the session that is already running for that repository and change if there is one, whatever action was asked for, `archive` included, and starting nothing in that case); `GET /api/sessions` returning the sessions and, for each configured agent, whether its executable was found; `GET /api/sessions/<id>`; `GET /api/sessions/<id>/worktree` reporting whether the worktree could be removed safely; `POST /api/sessions/<id>/resume`; `POST /api/sessions/<id>/close` with optional `{ removeWorktree }`, which ends the agent if it is running; and `DELETE /api/sessions/<id>` for a session that is not running. Opening MUST be refused with `403` when agent sessions are disabled or the repository is excluded from them, with `404` for an unknown repository or change, with `409` when the repository is not tracked or its last scan failed, with `400` for an invalid change name, an unknown action, an action not available in the change's stage or an agent without a prompt for it, with `503` when the agent's executable is not found, and with `500` and git's reason when the worktree cannot be created. With `resolveConflicts: true` the stage check does not apply; instead opening MUST be refused with `409` and the reason when neither conflict signal holds, when the linked pull request comes from a fork or is not known not to, when its head branch is the default branch or is checked out in the main checkout, when the branch is known neither locally nor as `origin/<branch>`, or when a session or session worktree of the change is on another branch; a session already running on the pull request's head branch is returned with the prompt submitted to it, under the rules for text sent on the user's behalf. All session routes other than `GET` are mutating and subject to the same-origin protection that applies to every mutating API request. `GET /api/state` SHALL remain unchanged.

#### Scenario: Duplicate open
- **WHEN** a session for repository `r` and change `c` is running and `POST /api/sessions` is sent again for `r` and `c`
- **THEN** the response contains the existing session and no second process is started

#### Scenario: Another action for a change that has a session
- **WHEN** a session for repository `r` and change `c` is running and `POST /api/sessions` is sent for `r` and `c` with `action: "archive"`
- **THEN** the response contains that running session, no worktree is created, no process is started and nothing is written to its terminal

#### Scenario: Feature disabled
- **WHEN** agent sessions are disabled and `POST /api/sessions` is called
- **THEN** the response is `403`, no worktree is created and no process is started

#### Scenario: Session routes are same-origin only
- **WHEN** a page from another origin sends `POST /api/sessions`
- **THEN** the response is `403` and no session is opened

#### Scenario: Deleting a running session
- **WHEN** `DELETE /api/sessions/<id>` targets a running session
- **THEN** the response is `409` and the session keeps running

#### Scenario: Resolve conflicts for a change without a worktree
- **WHEN** `POST /api/sessions` is sent with `{ repoId, change, resolveConflicts: true }` for a change whose linked open pull request is cached as `conflicting`, from a head branch known as `origin/<branch>`, and no session worktree of the change exists
- **THEN** a session is started in a new worktree on that head branch and returned

#### Scenario: Resolve conflicts with nothing to resolve
- **WHEN** `POST /api/sessions` is sent with `resolveConflicts: true` for a change with no conflict signal
- **THEN** the response is `409` with the reason, and no worktree is created and no process is started

