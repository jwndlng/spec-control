## MODIFIED Requirements

### Requirement: Dismiss endpoints
`GET /api/repos/<id>/changes/<name>/dismiss` SHALL preview reversible dismissal of the server-resolved active change identity and its checkout copies without writing. `POST` to the same route with the preview's identity token SHALL persist dismissal in the dashboard home and return its identity and `dismissed: true`. It SHALL NOT delete or stage files. Both routes SHALL support worktree-only changes and validate configured/enabled/successfully scanned projects and valid nonreserved names. The server SHALL return 400 for malformed input, 404 for unknown changes, and 409 for ineligible projects or changed identities. Mutations SHALL use same-origin protection and SHALL NOT require agent sessions to be enabled.

#### Scenario: Worktree-only dismissal
- **WHEN** POST confirms the current identity of a change found only in a linked worktree
- **THEN** it returns 200 with `dismissed: true`, hides the card by default, and changes no repository file

#### Scenario: Old client deletion request
- **WHEN** a client sends only the legacy deletion fingerprint to the dismissal route
- **THEN** it receives 400 with an explanation that dismissal is now reversible and no directory is deleted

#### Scenario: Changed identity
- **WHEN** the preview identity now belongs to an older incarnation of the named change
- **THEN** POST returns 409 without dismissing the new incarnation

#### Scenario: Foreign origin
- **WHEN** a foreign origin posts a dismissal
- **THEN** it receives 403 and no dismissal state changes

#### Scenario: Preview
- **WHEN** GET dismissal is requested for an active change with committed and untracked files
- **THEN** it returns the change identity and checkout copies and explains that files are preserved

#### Scenario: Dismiss
- **WHEN** POST dismissal confirms the current identity token
- **THEN** it returns 200 with `dismissed: true`, preserves the directory and index, and updates visibility

#### Scenario: Stale fingerprint
- **WHEN** a caller supplies only the previous destructive API's file fingerprint
- **THEN** it receives 400 with the revised contract and nothing is deleted or dismissed

#### Scenario: Traversal in the name
- **WHEN** the name is `..` or `archive`
- **THEN** the server returns 400 and changes no state

#### Scenario: Worktree-only change
- **WHEN** either dismissal route names a change found only in a linked worktree
- **THEN** it supports preview and confirmed dismissal without requiring a main-checkout directory

#### Scenario: Disabled repository
- **WHEN** either route names a disabled repository
- **THEN** it returns 409 and changes no state

## ADDED Requirements

### Requirement: Dismissed identities can be listed and restored
GET `/api/repos/<id>/dismissed-changes` SHALL list project-scoped dismissal records. POST `/api/repos/<id>/changes/<name>/restore` with its recorded identity SHALL remove that dismissal and refresh visibility. Restore SHALL be idempotent, same-origin protected, and scoped to configured projects. It SHALL NOT modify files, git, agent sessions, or remote state.

#### Scenario: Restore twice
- **WHEN** the same dismissed identity is restored twice
- **THEN** both operations succeed and the active change appears at most once

### Requirement: Deleting change files has a distinct API
The former destructive dismissal operation SHALL be exposed only through GET/POST `/api/repos/<id>/changes/<name>/delete-files`. Preview, fingerprints, loss warnings, path checks, running-session refusal, deletion scope, and best-effort staging SHALL preserve the previous deletion contract. No caller SHALL infer successful logical dismissal from successful file deletion.

#### Scenario: Deletion confirmation
- **WHEN** POST delete-files carries a current fingerprint for a safe main-checkout directory
- **THEN** only its confirmed files are deleted, only their removal is staged, and the result reports staging separately from dismissal
