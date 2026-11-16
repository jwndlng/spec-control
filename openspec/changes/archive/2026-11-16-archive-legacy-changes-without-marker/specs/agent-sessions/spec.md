## ADDED Requirements

### Requirement: Session branch recording supports changes without metadata markers
When the dashboard records a session branch and the matching active or archived change directory exists without `.openspec.yaml`, it SHALL create the marker in the session worktree and record the branch there. It SHALL NOT create or modify the marker in the main checkout. Existing markers SHALL keep their other content, and missing change directories or unsafe paths SHALL still be refused.

#### Scenario: Deterministic Archive of a markerless change
- **WHEN** the user starts deterministic Archive for a complete change whose active directory has no `.openspec.yaml`
- **THEN** the archived change in the session worktree has an `.openspec.yaml` recording `archive-branch`, the archive ships successfully, and the main checkout remains unchanged

#### Scenario: Ship of a markerless active change
- **WHEN** a session ships a change whose active directory has no `.openspec.yaml`
- **THEN** the session worktree gains an `.openspec.yaml` recording the session branch and Ship continues

#### Scenario: Missing or unsafe change directory
- **WHEN** the matching change directory does not exist or a path segment is a symbolic link
- **THEN** branch recording is refused and no marker is created outside the session worktree
