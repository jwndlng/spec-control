## ADDED Requirements

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
