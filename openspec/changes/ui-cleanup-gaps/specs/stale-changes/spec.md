# Spec Delta

## ADDED Requirements

### Requirement: The standalone stale cleanup dialog spaces visible content consistently

The **Clean up leftovers** dialog opened from change detail SHALL use consistent spacing between visible sections and keep each leftover's details together. Optional sections SHALL occupy space only when shown. Long paths and restore commands SHALL remain readable within the dialog at narrow widths.

#### Scenario: Preview has only a branch to remove

- **WHEN** the preview lists a branch with zero kept items and requires no acknowledgement
- **THEN** the branch details, backup guidance and action row appear in order with ordinary section spacing and no blank rows for absent content

#### Scenario: Preview includes files outside the change

- **WHEN** the preview includes a stale worktree with an uncommitted file outside the change and a kept leftover
- **THEN** the file list stays grouped with its worktree, and the kept reason, backup guidance and required acknowledgement each appear before the action row

#### Scenario: Results on a narrow viewport

- **WHEN** a cleanup outcome includes a backup path and a restore command on a narrow viewport
- **THEN** the path and command stay within the dialog, and the item outcome, copy controls and Close button are reachable without horizontal page scrolling
