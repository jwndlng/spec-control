## ADDED Requirements

### Requirement: Framework file names and formats stay in the framework module
Every name of a framework's own file or directory, and every rule for reading one of its files, SHALL come from the
framework module that reads the repository; the scanner, stale-change detection, discovery, label detection, the API and
the UI SHALL NOT name them. In particular:

- **Change metadata on a git ref.** Where stale-change detection reads a change's metadata from a git ref instead of
  from a checkout — the recorded branches of an archive directory on the default branch, and the created date of an
  active change on the default branch — the module SHALL supply the metadata file's path relative to a change directory
  (for OpenSpec, `.openspec.yaml`) and SHALL parse its text into the created date and the recorded branches, by the same
  rules it applies when it reads that file from a checkout. Stale-change detection SHALL only fetch that file's text
  with the read-only git it already runs and hand it to the module. A module that records no such metadata SHALL report
  none, and stale-change detection SHALL then treat every created date as unreadable and every change as recording no
  branches, as it already does for a change whose metadata file is missing.
- **Label detection** SHALL skip the directories the module names as its own (`FrameworkLayout.skipDirs`), not a fixed
  framework directory name.

For the OpenSpec module every result SHALL be what it was before — the same stranded archives, duplicates, stale
leftovers, recorded branches and detected labels — for every metadata file that the module's checkout parser and the
former separate reading on a git ref read alike. Where they differed, the file SHALL now mean on a git ref exactly what
it means in a checkout: one metadata file, one reading.

#### Scenario: One reading for a file the two parsers read differently
- **WHEN** an archived change's `.openspec.yaml` on `origin/main` records `branch: fix/rotate-keys` on an entry the checkout parser ignores (indented by a tab)
- **THEN** stale-change detection, like the scan of a checkout, finds no recorded branch in it

#### Scenario: Stale detection names no framework file
- **WHEN** the source of stale-change detection and of the scanner's label detection is searched for `.openspec.yaml` and for the directory name `openspec`
- **THEN** neither occurs; both come from the framework module

#### Scenario: Recorded branches on the default branch read through the module
- **WHEN** `origin/main` of `demo-ops` holds `openspec/changes/archive/2026-10-01-rotate-keys/.openspec.yaml` recording `branch: fix/rotate-keys`, and a scan looks for that change's stale leftovers
- **THEN** `fix/rotate-keys` is one of its branches, read from that file's text by the OpenSpec module's marker parser

#### Scenario: Created date on the default branch read through the module
- **WHEN** `origin/main` holds `openspec/changes/rotate-keys/` whose `.openspec.yaml` says `created: 2026-11-02` and an archive `2026-11-01-rotate-keys`
- **THEN** the change is not reported as a duplicate, exactly as before, because the module reads its created date as later than the archive

#### Scenario: A module without change metadata
- **WHEN** a registered module records no metadata file for its changes
- **THEN** stale-change detection reads no metadata for its changes, treats their created dates as unreadable and their recorded branches as none, and runs no git command for it
