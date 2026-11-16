# Spec Delta

## MODIFIED Requirements

### Requirement: Cards are grouped by repository within each column
Within every column, including the expanded `Archived` column, the board SHALL group cards by repository: all cards of one repository SHALL be adjacent, under a group header showing the repository name and the number of cards in that group. Groups SHALL be ordered by repository name, case-insensitively, and the order SHALL be the same in every column. Within a group, cards SHALL keep the order they would have had without grouping. A repository with no visible cards in a column SHALL NOT produce a group there. Column counts SHALL remain the total number of cards in the column. Grouping SHALL be applied after filtering, and in the `Archived` column after selecting the most recently archived changes, so it never changes which cards are shown. Each group header SHALL provide a clearly identifiable link to that repository's board, with an accessible name and tooltip that identify it as opening the project's overview. Activating the link SHALL navigate to `/repo/<repoId>` and SHALL NOT expand or collapse the group.

#### Scenario: Two repositories in one column
- **WHEN** the `Implementing` column contains changes `a1` and `a2` from repository `alpha` and `b1` from repository `beta`, scanned in the order `a1`, `b1`, `a2`
- **THEN** the column shows a group `alpha` with count `2` containing `a1` then `a2`, followed by a group `beta` with count `1` containing `b1`, and the column count is `3`

#### Scenario: Same group order across columns
- **WHEN** repositories `zeta` and `Alpha` both have cards in `Drafts` and in `Done`
- **THEN** the `Alpha` group is above the `zeta` group in both columns

#### Scenario: No empty groups
- **WHEN** repository `beta` has no cards in the `Ready` column
- **THEN** the `Ready` column shows no `beta` group header

#### Scenario: Filtered-out repository
- **WHEN** the repository filter selects only `alpha`
- **THEN** every column shows at most one group, `alpha`, and its header count equals the number of visible `alpha` cards in that column

#### Scenario: Archived column keeps its bound
- **WHEN** 96 changes are archived across repositories and the `Archived` column is expanded
- **THEN** the 25 most recently archived changes are shown, grouped by repository, with each group's cards in archive-date descending order, and the column header still reports the total of `96`

#### Scenario: Open a project's board from its group
- **WHEN** the user activates the project link in the `alpha` group header
- **THEN** the dashboard opens `/repo/<alpha's id>` and the group's expand or collapse state is unchanged
