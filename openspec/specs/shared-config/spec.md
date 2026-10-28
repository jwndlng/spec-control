# shared-config Specification

## Purpose
Defines the shared OpenSpec config: named profiles of agent guidance (`context` and per-artifact `rules`) kept in the dashboard, the managed-section format they take in a repository's `openspec/config.yaml`, how the profiles a repository carries are derived from that file, and the explicit, previewed apply that is the dashboard's only write to a tracked repository.

## Requirements

### Requirement: Shared OpenSpec config profiles are kept in the dashboard
The dashboard SHALL store an ordered list of shared config profiles. Each profile SHALL have a stable id (a lower-case slug matching `^[a-z0-9][a-z0-9-]{0,62}$`, unique among profiles), a display name, a `context` text and `rules` (a map from artifact id to an ordered list of rule texts). Profiles SHALL be stored in the dashboard's own home directory, written atomically, and MUST NOT be stored in any tracked repository. Saving SHALL validate ids and names, that every artifact id matches `^[A-Za-z0-9._-]+$`, that every rule is a non-empty single-line string, and that no `context` contains either marker string, `spec-control:shared` or the former `openspec-dashboard:shared`; an invalid body SHALL be rejected without changing what is stored. Saving MUST NOT write to any tracked repository and SHALL trigger a rescan. While no profile exists, no shared-config information SHALL be shown anywhere.

#### Scenario: Two profiles
- **WHEN** the user creates profiles `base` (context `We use conventional commits.`) and `security` (rule `State the data classification` for artifact `proposal`) and saves
- **THEN** both are persisted in the dashboard home in that order, no file in any tracked repository changes, and a rescan starts

#### Scenario: Invalid profile
- **WHEN** a save request contains a profile id `Not A Slug`, a duplicate id, an artifact id `../x`, a rule spanning two lines, or a context containing `spec-control:shared` or `openspec-dashboard:shared`
- **THEN** the response is `400` and the stored profiles are unchanged

#### Scenario: Nothing configured yet
- **WHEN** no profile exists
- **THEN** the overview, repository headers and snapshot carry no shared-config information

### Requirement: Shared content lives in managed sections that name their profile
When applied to a repository's `openspec/config.yaml`, a profile's content SHALL be placed in managed sections recognisable in the file itself. Its context SHALL be one block inside the `context` string, delimited by an HTML comment line starting with `<!-- spec-control:shared:begin <profile id>` (which SHALL also state that the block is managed and that edits inside it are overwritten) and the line `<!-- spec-control:shared:end <profile id> -->`. Blocks SHALL come first in the string, in the dashboard's profile order, followed by the project's own context text if any. Each of its rules SHALL be an entry carrying the trailing YAML comment `spec-control:shared:<profile id>`, placed before the project's own entries of the same artifact id, in profile order. Everything outside the managed sections is the project's own content. Sections written by earlier versions with the former prefix `openspec-dashboard:shared` in place of `spec-control:shared` SHALL be recognised as managed sections exactly like current ones, and the prefix SHALL NOT count as content when deciding whether a carried profile is in sync. The dashboard SHALL write only the current prefix: an apply that writes a file SHALL write every managed section it keeps with `spec-control:shared`, and the preview SHALL show that marker change as part of the difference; an apply to a file whose sections are in sync but carry the former prefix is therefore not reported `unchanged`. Nothing else SHALL rewrite a former marker; a repository whose file is not applied to again keeps its former markers. A file with an unmatched or mismatched marker pair (a begin and end marker with different prefixes counting as mismatched), a nested block, a marker without a profile id, or two context blocks for the same profile SHALL be treated as unreadable.

#### Scenario: Two profiles and local content side by side
- **WHEN** profiles `base` and `security` are applied to a config whose `context` is `Tech stack: Go.` and whose `rules.proposal` is `[Mention the on-call impact]`
- **THEN** `context` holds the `base` block, then the `security` block, then `Tech stack: Go.`, and `rules.proposal` lists the `base` rule, then the `security` rule (each marked with its profile id), then `Mention the on-call impact` (unmarked)

#### Scenario: Profile with rules only
- **WHEN** a profile with an empty context and one rule is applied
- **THEN** no context block is written for it and its rule entry carries its marker

#### Scenario: Malformed markers
- **WHEN** a config's `context` contains a begin marker for `base` but no matching end marker
- **THEN** the repository is `unreadable` and apply is refused for it

#### Scenario: Former markers are still recognised
- **WHEN** a repository's config carries `base` in sections marked `openspec-dashboard:shared` whose content equals the stored `base` profile
- **THEN** it reports `base` as `in-sync`, and scanning it writes nothing

#### Scenario: Applying again moves to the current marker
- **WHEN** the user applies `base` to that repository again and confirms
- **THEN** the preview showed the marker lines changing to `spec-control:shared`, and afterwards the file's `base` sections carry `spec-control:shared` and nothing else in the file changed

### Requirement: The profiles a repository carries are derived from its config file
For every scanned repository the dashboard SHALL derive, from the text of its `openspec/config.yaml` and the stored profiles alone — without writing anything and without any record of previous applies or intended assignments — whether the file is `unreadable` (missing, not valid YAML, `context` not a string, `rules` not a map of lists, or malformed markers) and otherwise the list of profiles it carries, each with a state: `in-sync` when its managed content equals the profile (context block text ignoring surrounding whitespace, and its rules per artifact id as ordered lists); `outdated` when it differs; `orphaned` when no profile with that id exists. Carried profiles SHALL be reported in the dashboard's profile order with orphaned ones last. A repository that carries no profile SHALL be reported as such and MUST NOT be presented as a problem.

#### Scenario: Untouched scaffold
- **WHEN** a repository's config is the OpenSpec scaffold with `context` and `rules` only as commented examples
- **THEN** it carries no profile and is not flagged

#### Scenario: Profile edited after applying
- **WHEN** a repository carries `base` and `security` in sync and the user then changes the `base` context and saves
- **THEN** after the rescan `base` is `outdated` and `security` is still `in-sync` for that repository

#### Scenario: Hand edit inside a managed block
- **WHEN** someone edits text between the `base` context markers in a repository
- **THEN** `base` is `outdated` for that repository

#### Scenario: Local edits do not count
- **WHEN** someone changes the project's own context below the managed blocks or adds an unmarked rule
- **THEN** every carried profile stays `in-sync`

#### Scenario: Profile deleted in the dashboard
- **WHEN** the user deletes profile `security` while a repository still carries its sections
- **THEN** that repository reports `security` as `orphaned`

#### Scenario: State survives a fresh dashboard home
- **WHEN** the same profiles are saved into an empty dashboard home and repositories that had them applied earlier are scanned
- **THEN** they report the same carried profiles as `in-sync`

### Requirement: Carried profiles are visible per repository
Once a profile exists, the projects overview SHALL show in each repository's row which profiles it carries, and the repository board SHALL show them for that repository in the Shared config section of its project details overlay (project-overview: "Repository board header"). The repository board header's quick view SHALL show only an attention marker, in text, when one of those profiles is not `in-sync` or the repository's `openspec/config.yaml` is unreadable. `outdated`, `orphaned` and `unreadable` SHALL be conveyed with text, not colour alone, and SHALL be visually distinguished from `in-sync`. The Settings page SHALL show all enabled repositories against all profiles.

#### Scenario: Overview
- **WHEN** `demo-ops` carries `base` outdated and `security` in sync, while `alpha-infra` carries only `base` in sync
- **THEN** the row for `demo-ops` names both profiles and marks `base` as outdated, and the row for `alpha-infra` names `base` without a warning

#### Scenario: Repository board
- **WHEN** the board of `demo-ops` is shown, which carries `base` outdated and `security` in sync
- **THEN** its quick view shows an attention marker for shared config, and its details overlay names both profiles and marks `base` as outdated

#### Scenario: All in sync
- **WHEN** the board of `alpha-infra` is shown, which carries only `base` in sync
- **THEN** its header shows no shared-config marker, and its details overlay names `base` without a warning

### Requirement: Apply is explicit, per repository, and previewed
The dashboard SHALL only write shared content to a repository in response to an explicit apply action by the user. The user SHALL choose for each repository the complete set of profiles it is to carry, with the choice pre-filled from what the repository carries now, so that different repositories can carry different profiles. Before applying, the user SHALL be shown, for every affected repository, the exact difference between the current file and the file that would be written, and any reason the repository would be refused; nothing SHALL be written until the user confirms. Producing the preview MUST NOT write anything. Scanning, polling, saving profiles and saving Settings MUST NOT apply anything.

#### Scenario: Different profiles for different repositories
- **WHEN** the user selects `base` for `alpha-infra` and `base` plus `security` for `demo-ops`, previews and confirms
- **THEN** `alpha-infra` carries only `base`, `demo-ops` carries both, and after the rescan both report them `in-sync` without a page reload

#### Scenario: Preview before writing
- **WHEN** the user changes the selection for three repositories and opens the preview
- **THEN** a diff per repository is shown and no file in any of them has changed

#### Scenario: Saving does not apply
- **WHEN** the user edits a profile and clicks Save without applying
- **THEN** no repository file changes and repositories carrying that profile report it `outdated`

### Requirement: Apply makes the file carry exactly the chosen profiles and nothing else changes
Applying SHALL modify only `<repository>/openspec/config.yaml`, and within it only the managed sections of the `context` and `rules` keys, so that afterwards the file carries exactly the chosen profiles in the dashboard's profile order: chosen profiles are added or updated, and managed sections of profiles not chosen — orphaned ones included — are removed. The `schema` key and every other key, all comments, key order, the project's own context text and the project's own rule entries (including their order and comments) SHALL be preserved byte for byte. `context` SHALL be written as a YAML literal block. Applying a selection the file already reflects SHALL NOT write the file. Applying an empty selection SHALL remove all managed sections — and the `context` or `rules` key if nothing of the project's own remains — restoring the file byte for byte to what it was before the first apply, with one exception: a project's own `context` that was not written as a literal block keeps its value but is left as a literal block. The write SHALL be atomic and preserve the file mode, and no git command SHALL be run; the result is an uncommitted modification in the repository's working tree.

#### Scenario: Scaffold keeps its comments
- **WHEN** a profile is applied to the untouched OpenSpec scaffold
- **THEN** `schema: spec-driven` and every commented example line are still present unchanged, and `context` and `rules` have been added

#### Scenario: Idempotent
- **WHEN** apply is confirmed for a repository that already carries exactly the chosen profiles in sync
- **THEN** the file's bytes and modification time are unchanged and the result is reported as `unchanged`

#### Scenario: Update touches only that profile
- **WHEN** the `base` context changes and is applied to a repository carrying `base` and `security` next to its own context and a local rule with a comment
- **THEN** only lines of the `base` sections differ in the resulting diff

#### Scenario: Detach one profile
- **WHEN** a repository carries `base` and `security` and the user applies with only `security` chosen
- **THEN** the `base` block and the `base` rule entries are gone, and the `security` sections and the project's own content are unchanged

#### Scenario: Removal restores the original
- **WHEN** profiles are applied to a file and later an empty selection is applied to it
- **THEN** the file is byte-for-byte identical to the original

#### Scenario: Quoted one-line context
- **WHEN** profiles are applied to a file whose own context is `context: "One line."` and later removed again
- **THEN** the file's `context` value is `One line.` again, written as a literal block, and everything else is byte-for-byte as before

#### Scenario: No git activity
- **WHEN** an apply completes
- **THEN** no git command that writes has been run and `git status` in the repository shows `openspec/config.yaml` as modified and nothing else

### Requirement: Apply refuses unsafe targets
Apply SHALL refuse a repository, without writing to it and without failing the other repositories, when: its id is not an enabled repository in the dashboard config; its path or `openspec/config.yaml` does not exist; the file is `unreadable`; a chosen profile id does not exist; or the resulting `context` would exceed 50KB in UTF-8 bytes (the size above which OpenSpec ignores the context). The target path MUST be built from the dashboard config and MUST NOT be taken from the request. Each refusal SHALL be reported with its reason, both in the preview and in the apply result. The file SHALL be re-read and re-evaluated at write time rather than relying on an earlier preview.

#### Scenario: Context too large
- **WHEN** a repository's own context is 48KB and the chosen profiles add 4KB
- **THEN** that repository is refused with a reason naming the combined size and the 50KB limit, and the other repositories are still applied

#### Scenario: Invalid YAML
- **WHEN** a repository's `openspec/config.yaml` has a YAML syntax error
- **THEN** it is refused as `unreadable` and its file is untouched

#### Scenario: Unknown repository or profile id
- **WHEN** an apply request names a repository id that is not enabled in the config, or a profile id that does not exist
- **THEN** that entry is refused, nothing is written for it, and no path outside the configured repositories is touched

#### Scenario: File changed after preview
- **WHEN** a repository's config is edited on disk between preview and apply
- **THEN** the apply is computed from the file as it is at write time

### Requirement: Apply writes exactly what was previewed
Confirming Apply in the preview SHALL apply exactly the repositories and profile sets that preview was produced for, as
they were when the user opened it — never the grid's selection or the snapshot's state at the moment of the click. A
scan, a poll or any other change to the snapshot while the preview is open SHALL NOT add a repository to the apply,
remove one from it or change the profiles one is to carry. Closing the preview SHALL discard it; a changed selection
SHALL need a new preview before anything can be applied.

The preview SHALL carry, per repository it would write, a **digest** of the file text it showed and the text it would
write. Apply SHALL send that digest back with each repository, and the server SHALL, after re-reading the file and
computing the result afresh, write a repository only when the digest of what it read and what it would write equals the
digest sent; otherwise that repository SHALL be reported `refused` with a reason saying the file or the profiles
changed since the preview, nothing SHALL be written to it, and the other repositories SHALL still be applied
independently. A repository sent without a digest SHALL be refused the same way. The digest SHALL be computed by the
server only and SHALL NOT be a way to send file content: the server never writes text it received.

#### Scenario: A poll while the preview is open
- **WHEN** the user ticks `base` for `alpha-infra` and opens the preview, which lists only `alpha-infra`, and a poll then reports `demo-ops`'s `base` section `outdated` before the user confirms
- **THEN** Apply sends only `alpha-infra`, only `alpha-infra`'s `openspec/config.yaml` is written, and `demo-ops`'s file is byte-for-byte unchanged

#### Scenario: A repository added while the preview is open
- **WHEN** a new repository is tracked while the preview is open and its grid row would count as pending
- **THEN** Apply does not include it

#### Scenario: The file changed after the preview
- **WHEN** `alpha-infra`'s `openspec/config.yaml` is edited after the preview was shown and the user then confirms Apply
- **THEN** `alpha-infra` is reported `refused` with a reason saying it changed since the preview, its file keeps the edited content, and the preview has to be opened again to apply it

#### Scenario: The profiles were saved after the preview
- **WHEN** the `base` profile is saved with new context in another tab after the preview was shown, and the user confirms Apply
- **THEN** every repository whose result would now differ from the preview is refused, and none of them is written

#### Scenario: Unchanged file and profiles
- **WHEN** nothing changed between the preview and the confirmation
- **THEN** every previewed repository is `written` or `unchanged` exactly as the preview showed
