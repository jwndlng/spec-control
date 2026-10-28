## ADDED Requirements

### Requirement: Dismissal reaches the change directory through real directories only
Before it previews and again immediately before it deletes, dismissal SHALL check with `lstat` every path segment below
the repository's folder down to the change directory — `openspec`, `openspec/changes` and `openspec/changes/<name>` —
and SHALL refuse with `409`, naming the segment, unless every one of them is a directory and none is a symbolic link.
The repository's folder itself MAY be reached through a symbolic link. A refused dismissal MUST NOT delete, move or
stage anything, inside or outside the repository.

#### Scenario: Linked changes directory
- **WHEN** `openspec/changes` in `demo-ops` is a symbolic link to `/w/acme/shared-changes` and the user dismisses
  `lint-rules`
- **THEN** the dismissal is refused with `409` naming `openspec/changes`, and `/w/acme/shared-changes/lint-rules/` is
  byte-for-byte unchanged

#### Scenario: Linked openspec directory
- **WHEN** `openspec` in `demo-ops` is a symbolic link to a directory outside the repository
- **THEN** both the preview and the dismissal are refused with `409` and nothing is deleted

#### Scenario: Link appears after the preview
- **WHEN** the preview succeeded and `openspec/changes` is replaced by a symbolic link before the user confirms
- **THEN** the dismissal is refused with `409` and nothing is deleted
