## ADDED Requirements

### Requirement: Apply writes only a real config file and leaves no temporary file
Apply SHALL refuse a repository, without writing to it, when `openspec` is a symbolic link or not a directory, or when
`openspec/config.yaml` is a symbolic link or not a regular file, each checked with `lstat` both when the preview is
computed and immediately before writing; the refusal SHALL name the reason. The preview SHALL read the file with the
scanner's bounded read. Apply SHALL write the new content to a temporary file in `openspec/` whose name is unique to
that one write and that it creates exclusively, then rename it over `openspec/config.yaml`; whenever the rename does not
happen, it SHALL remove that temporary file. Two applies running at once MUST NOT share a temporary file. Apply SHALL
NOT remove any file it did not create in the same write.

#### Scenario: Linked config file
- **WHEN** `openspec/config.yaml` in `demo-ops` is a symbolic link to `/w/acme/common/config.yaml` and profiles are applied
- **THEN** `demo-ops` is refused with a reason saying the file is a symbolic link, the link still exists, and its target
  is byte-for-byte unchanged

#### Scenario: Write fails
- **WHEN** the rename onto `openspec/config.yaml` fails
- **THEN** the apply is reported as refused with the reason, `openspec/config.yaml` is unchanged, and no temporary file is
  left in `openspec/`

#### Scenario: Two applies at once
- **WHEN** two apply requests for `demo-ops` run at the same time
- **THEN** `openspec/config.yaml` afterwards holds the complete content of one of them and no temporary file is left in
  `openspec/`
