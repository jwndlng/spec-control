## MODIFIED Requirements

### Requirement: Integration is confirmed by the marker, never by the agent's word

The dashboard SHALL treat an integration as finished only when `openspec/config.yaml` exists in the folder. It SHALL
re-check the folder when the integration session ends, and every discovery run SHALL re-check the folder of every
integration session that is still running. Each integration session SHALL confirm its folder at most once: on the first
check that finds the marker, the dashboard SHALL record on the session that its folder was confirmed and, when the
repository is not in the configuration at that moment, add it with `enabled: true` and its default name —
disambiguated by the same `<basename> (<parent>)` rule that applies to an enabled candidate — the configuration SHALL
be written with the existing atomic write, and a scan SHALL start so the repository appears on the board. A session
whose folder was confirmed, and a session that has ended, MUST NOT be checked by a later discovery run.

Nothing SHALL be read from the agent's output to decide this. If the session ends without the marker, the folder stays
integratable, nothing is added to the configuration, and the session's outcome — its exit code and reason — is shown.

#### Scenario: The marker appears
- **WHEN** an integration session ends and the folder now holds `openspec/config.yaml`
- **THEN** the repository is added to the configuration with `enabled: true` and its default name, a scan starts, and it appears on the board

#### Scenario: The agent exits without doing it
- **WHEN** an integration session ends and the folder holds no `openspec/config.yaml`
- **THEN** the configuration is unchanged, the repository is still listed as integratable, and the session's exit code and reason are shown

#### Scenario: The agent claims success it did not achieve
- **WHEN** an integration session's terminal shows that OpenSpec was initialised but no `openspec/config.yaml` is on disk
- **THEN** nothing is added to the configuration

#### Scenario: The marker appears without the session ending
- **WHEN** the marker is written while the integration session is still running and the user runs discovery
- **THEN** that discovery adds the repository, starts a scan, and no longer lists the folder as integratable

#### Scenario: Colliding default name
- **WHEN** an integrated repository's basename is already the name of a tracked repository
- **THEN** its name defaults to `<basename> (<parent directory name>)`, as it does for an enabled candidate

#### Scenario: A marker written after the session ended
- **WHEN** an integration session ended without the marker and the user later writes `openspec/config.yaml` in the folder and runs discovery
- **THEN** the configuration is unchanged and the folder is listed as a candidate

## ADDED Requirements

### Requirement: A forgotten integrated repository stays forgotten

Forgetting a repository that was added by a confirmed integration SHALL have the same effect as forgetting any other
repository: it SHALL leave the configuration and, while it lies under a workspace root, be listed as a candidate. No
integration session, ended or still running, SHALL add it to the configuration again; only the user enabling the
candidate SHALL.

#### Scenario: Forget after the setup session ended
- **WHEN** `/w/acme/chat-groups` was added by an integration session that has ended, the user disables and forgets it, and the overview runs discovery
- **THEN** `/w/acme/chat-groups` is not in the configuration and is listed as a candidate with its default name

#### Scenario: Forget while the setup agent still runs
- **WHEN** `/w/acme/chat-groups` was added while its integration session still runs as the project's console, the user disables and forgets it, and discovery runs
- **THEN** `/w/acme/chat-groups` is not in the configuration and is listed as a candidate
