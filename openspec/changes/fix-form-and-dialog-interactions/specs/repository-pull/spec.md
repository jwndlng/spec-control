## ADDED Requirements

### Requirement: The blocked-pull list stays open while Resolve and pull runs
When the user confirms **Resolve and pull** from the list of blocking files opened beside a repository's Pull control,
the list SHALL stay open while the pull runs, showing the files it was confirmed for with Resolve and pull disabled and
stating that it is running, and SHALL then show the new outcome. It SHALL NOT close because the repository's pull is
running.

#### Scenario: Resolve and pull from the Pull control
- **WHEN** the pull of `demo-ops` was refused over two change leftovers, the user opens the list from the badge and
  confirms Resolve and pull
- **THEN** the list stays open showing "Resolving…" with Resolve and pull disabled, and once the pull finishes it shows
  the outcome, such as the fast-forward and the files replaced
