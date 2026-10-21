## MODIFIED Requirements

### Requirement: Labels are shown on the overview and the board header

The labels displayed for a repository SHALL be its custom labels in the order the user gave them, followed by its
detected labels that are not hidden and not equal (ignoring case) to one of its custom labels, sorted by name. They
SHALL be shown on the repository's overview row, on its overview tile and in the Labels section of its repository
board's project details overlay (project-overview: "Repository board header"); the repository board header itself
SHALL NOT show them. A detected label SHALL be distinguishable from a custom label by an icon and by a tooltip naming
the marker that produced it, not by colour alone. A table row SHALL show at most three labels and, when there are
more, a `+<n>` indicator whose tooltip lists the rest; the tile and the details overlay SHALL show every label,
wrapping. A repository with no label SHALL show nothing in their place, and its details overlay no Labels section.

#### Scenario: Custom and detected labels together
- **WHEN** `alpha-infra` carries the custom label `client` and is detected as `terraform`
- **THEN** its row, tile and board details overlay show `client` followed by `terraform`, and `terraform` carries the
  detected icon and a tooltip naming `.tf` files

#### Scenario: Not in the board header
- **WHEN** the board of `alpha-infra` is shown
- **THEN** its header shows neither `client` nor `terraform`, and its **Details** overlay shows both

#### Scenario: Custom label shadows a detected one
- **WHEN** `beta-soc` carries the custom label `Go` and is detected as `go`
- **THEN** one label `Go` is shown, as a custom label

#### Scenario: More labels than a row shows
- **WHEN** a repository displays five labels
- **THEN** its row shows the first three and `+2`, whose tooltip names the other two, and its tile shows all five

#### Scenario: No labels
- **WHEN** a repository has no custom labels and nothing is detected
- **THEN** its row shows no label chips and no `+0` indicator
