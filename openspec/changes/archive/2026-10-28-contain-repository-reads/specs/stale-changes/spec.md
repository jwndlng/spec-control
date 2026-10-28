## ADDED Requirements

### Requirement: A stale change directory is removed through real directories only
The main checkout's change directory confirmed in a stale change's cleanup SHALL be removed only when, immediately before
the removal, every path segment below the repository's folder down to it — `openspec`, `openspec/changes` and
`openspec/changes/<name>` — is a directory and none is a symbolic link, checked with `lstat`, exactly as for dismissal.
Otherwise that item SHALL be left untouched and reported with the segment that is a link, and the other confirmed items
SHALL still be handled.

#### Scenario: Linked changes directory
- **WHEN** the leftovers of `rotate-keys` include the main checkout's `openspec/changes/rotate-keys/`, and
  `openspec/changes` is a symbolic link to `/w/acme/shared-changes`
- **THEN** that item is reported as refused naming `openspec/changes`, `/w/acme/shared-changes/rotate-keys/` is unchanged,
  no backup is written for it, and the other confirmed leftovers are still removed
