## MODIFIED Requirements

### Requirement: Each selected issue gets a change name
When the user checks an issue, the dialog SHALL propose a change name derived from its title: lower-cased, every run of
characters other than `a`–`z` and `0`–`9` replaced by one `-`, leading and trailing `-` removed, and cut to at most 48
characters at a `-` boundary where one exists; when that leaves nothing, the name SHALL be `issue-<number>`, and when it leaves a name the New change form refuses as reserved, the name SHALL be that name followed by `-<number>`. The name
SHALL be editable per issue and SHALL be validated live exactly as the New change form validates a name. The dialog
SHALL also refuse, as text next to the name, a name that an active or archived change of the repository already uses
or that another checked issue uses. The import action MUST NOT be available while no issue is checked or any checked
issue's name is refused, and SHALL state how many changes it will create.

#### Scenario: Name from the title
- **WHEN** the user checks issue `#42` titled `Retry webhook delivery on 5xx (again!)`
- **THEN** the proposed name is `retry-webhook-delivery-on-5xx-again`

#### Scenario: Title without usable characters
- **WHEN** the user checks issue `#7` titled `???`
- **THEN** the proposed name is `issue-7`

#### Scenario: Name already taken
- **WHEN** the proposed name of a checked issue is `add-audit-trail` and the repository has an archived change `add-audit-trail`
- **THEN** a message next to that name says it is taken and the import action is disabled until the name is changed

#### Scenario: Two issues, one name
- **WHEN** two checked issues propose the same name
- **THEN** both names are refused as duplicates and the import action is disabled

#### Scenario: Title that names the archive
- **WHEN** the user checks issue `#12` titled `Archive`
- **THEN** the proposed name is `archive-12`

#### Scenario: Reserved name typed by hand
- **WHEN** the user changes a checked issue's name to `archive`
- **THEN** a message next to that name says it is reserved and the import action is disabled until it is changed
