# project-labels Specification

## Purpose
Lets the user group tracked repositories with labels — their own custom labels and technology labels the dashboard
detects from the repository's files — see those labels on the projects overview and the repository board, and narrow
the overview to the repositories carrying them.

## Requirements

### Requirement: A tracked repository can carry custom labels

Each repository entry in the dashboard configuration SHALL accept an optional list of custom labels, stored in
`~/.spec-control/config.json` with that entry and never in the repository. A label SHALL be trimmed, SHALL be 1 to
32 characters long, MUST NOT contain a control character or a comma, and SHALL be unique within its repository
ignoring case. A repository SHALL carry at most 20 custom labels. A configuration that breaks one of these rules SHALL
be refused on save with an error naming the repository and the label, and nothing SHALL be saved. A configuration
without labels SHALL load unchanged, and saving it SHALL NOT add an empty list. Labels SHALL keep the case the user
typed; comparisons between labels SHALL ignore case. Renaming a repository SHALL keep its labels.

#### Scenario: Labels persist with the repository entry
- **WHEN** the user gives `alpha-infra` the labels `client` and `infra` on the projects overview
- **THEN** the `alpha-infra` entry in `config.json` carries `["client", "infra"]` and no file in `alpha-infra` changes

#### Scenario: Duplicate label refused
- **WHEN** a save would give `beta-soc` the labels `Infra` and `infra`
- **THEN** the save is refused with an error naming `beta-soc` and `infra`, and the stored configuration is unchanged

#### Scenario: Over-long label refused
- **WHEN** a save would give a repository a 40-character label
- **THEN** the save is refused and the stored configuration is unchanged

#### Scenario: Older configuration
- **WHEN** a configuration written before labels existed is loaded and saved again without edits
- **THEN** no repository entry gains a `labels` or `hiddenLabels` key

### Requirement: Technology labels are detected from marker files

During every scan of a repository whose project folder exists, the dashboard SHALL derive detected labels from a
built-in rule table that maps the names of marker files and directories to labels. At least these rules SHALL exist:

| Marker | Label |
|---|---|
| a file ending in `.tf` | `terraform` |
| `go.mod` | `go` |
| `Cargo.toml` | `rust` |
| `package.json` | `javascript` |
| `tsconfig.json` | `typescript` |
| `pyproject.toml`, `requirements.txt`, `setup.py` or `Pipfile` | `python` |
| `Gemfile` | `ruby` |
| `pom.xml`, `build.gradle` or `build.gradle.kts` | `java` |
| a file ending in `.csproj` or `.sln` | `dotnet` |
| `composer.json` | `php` |
| `Package.swift` | `swift` |
| `Dockerfile`, `compose.yaml` or `docker-compose.yml` | `docker` |
| `Chart.yaml` | `helm` |
| `ansible.cfg` | `ansible` |

Detection SHALL look at the names of the entries of the project folder of the main checkout and of its immediate
subdirectories, and nothing deeper. It SHALL skip directories whose name starts with `.` and the directories
`node_modules`, `vendor`, `dist`, `build` and `target`, and the directories the framework module that reads the repository names as its own (`spec-frameworks`: "Framework file names and formats stay in the framework module"; for OpenSpec, `openspec`), SHALL read at most 64 subdirectories and at most 500
entries per directory, and SHALL NOT follow symbolic links. Detection MUST NOT open or read any file, MUST NOT run a
git command, MUST NOT write anything and MUST NOT contact a network. Matching SHALL be case-sensitive on file names.
Detected labels SHALL be part of the repository's snapshot, sorted by name and without duplicates, and SHALL change
with the next scan after the repository's files change. A repository whose scan fails SHALL have no detected labels.
A non-git folder SHALL be detected exactly like a git repository.

#### Scenario: Terraform repository
- **WHEN** `alpha-infra` has `main.tf` and `modules/network/` at its top level
- **THEN** its snapshot's detected labels are `["terraform"]`

#### Scenario: Marker in an immediate subdirectory
- **WHEN** `demo-ops` has `infra/main.tf` and `service/go.mod`
- **THEN** its detected labels are `["go", "terraform"]`

#### Scenario: Too deep
- **WHEN** a repository's only `.tf` file is `deploy/env/prod/main.tf`
- **THEN** `terraform` is not detected

#### Scenario: Dependency folders are skipped
- **WHEN** a repository has `package.json` and `node_modules/some-lib/Cargo.toml`
- **THEN** its detected labels are `["javascript"]`

#### Scenario: Detection follows the repository
- **WHEN** a `Dockerfile` is added to `beta-soc` and the next scan runs
- **THEN** `docker` is among `beta-soc`'s detected labels

#### Scenario: Read-only
- **WHEN** a scan detects labels in every fixture repository
- **THEN** every fixture repository is byte-for-byte unchanged and no git process was started for detection

#### Scenario: The framework's own tree is skipped
- **WHEN** `demo-ops`, read by the OpenSpec module, has `openspec/package.json` and nothing else that is a marker
- **THEN** its detected labels are empty, exactly as before the skipped name came from the module

### Requirement: A detected label can be hidden per repository

Each repository entry SHALL accept an optional list of hidden detected labels, stored in the dashboard configuration
under the same rules as custom labels. A detected label whose name is in that list (ignoring case) SHALL NOT be shown
or used for filtering for that repository. The labels dialog of a managed project on the projects overview SHALL list
that repository's detected labels, as last scanned, with a control to hide or show each one, taking effect at once. A
hidden name that is no longer detected SHALL have no effect and SHALL be kept.

#### Scenario: Hiding a wrong guess
- **WHEN** `demo-ops` is detected as `go` and `docker`, and the user hides `docker` in its labels dialog on the overview
- **THEN** `demo-ops` shows only `go` without any Save, and filtering the overview by `docker` does not list it

#### Scenario: Showing it again
- **WHEN** the user shows `docker` again for `demo-ops` in its labels dialog
- **THEN** `demo-ops` shows `docker` and `go`

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

### Requirement: The overview can be filtered by label

The projects overview SHALL offer a label filter listing every label displayed on at least one listed repository,
ignoring case. Activating a label in the filter, on a row or on a tile SHALL add it to the filter, and activating an
active label SHALL remove it. Activating a label on a row or tile MUST NOT open the repository's board. With several
labels in the filter, only repositories displaying all of them SHALL be listed. The label filter SHALL combine with the
search and the work-in-progress filter, SHALL apply instantly on the client, SHALL be the same in the table and the
tiles layout, and SHALL persist in the URL query string as one `label=<name>` parameter per label, omitted when empty.
A `label` value that matches no displayed label SHALL stay in the filter and list no repository, and the filter SHALL
show it so it can be removed. Sorting SHALL be unaffected by the label filter.

#### Scenario: Filter by one label
- **WHEN** `alpha-infra` and `demo-ops` display `terraform`, `beta-soc` does not, and the user activates `terraform`
- **THEN** only `alpha-infra` and `demo-ops` are listed and the URL contains `label=terraform`

#### Scenario: Several labels combine with AND
- **WHEN** the user opens `/?label=terraform&label=client` and only `alpha-infra` displays both
- **THEN** only `alpha-infra` is listed

#### Scenario: Activating a label on a row
- **WHEN** the user activates the `client` chip on the `alpha-infra` row
- **THEN** `client` is added to the filter and the overview stays open

#### Scenario: Combines with search and layout
- **WHEN** the user opens `/?label=go&q=demo&view=tiles`
- **THEN** the tiles layout lists only repositories whose name contains `demo` and that display `go`

#### Scenario: Unknown label in the URL
- **WHEN** the user opens `/?label=cobol` and no repository displays `cobol`
- **THEN** no repository is listed, the filter shows `cobol` as active, and removing it lists every repository again

### Requirement: Custom labels are edited on the projects overview

Each managed project on the projects overview, as a table row and as a tile, SHALL offer a **Labels** action in its
project settings dialog (see the `project-overview` capability, "Each managed project carries its own settings on the
overview"). Activating it SHALL replace the settings dialog with a labels dialog for that project. The labels dialog SHALL show the project's custom labels as removable chips and SHALL offer an input
to add one. Adding a label that is empty, too long, contains a comma or already exists on that repository (ignoring
case) SHALL be refused in place with a message, without a request. While labels are typed, the input SHALL suggest
labels already used on other tracked repositories. Each addition, removal or hide/show toggle SHALL take effect at once,
persisting the configuration without a separate save; while one is being saved the dialog SHALL show that it is
working, and when it fails the dialog SHALL show the reason and the labels SHALL stay as they were. Changing only labels
SHALL NOT trigger a scan. Activating Labels MUST NOT open the repository's board. When the labels dialog closes, focus
SHALL return to the settings button of the project's row or tile.

#### Scenario: Adding a label
- **WHEN** the user opens the labels dialog of `alpha-infra`, types `client` and confirms
- **THEN** a `client` chip appears in the dialog and on the `alpha-infra` row, and the configuration carries it without any Save

#### Scenario: Reached from the project settings dialog
- **WHEN** the user opens the settings dialog of `alpha-infra` and activates Labels, then presses Escape
- **THEN** the labels dialog of `alpha-infra` replaces the settings dialog, the board is not opened, and after Escape no
  dialog is open and focus is on the settings button of `alpha-infra`

#### Scenario: Suggesting an existing label
- **WHEN** `beta-soc` carries the label `client` and the user types `cl` into the label input of `demo-ops`
- **THEN** `client` is offered as a suggestion

#### Scenario: Removing a label
- **WHEN** the user removes the `infra` chip of `alpha-infra` in its labels dialog
- **THEN** `alpha-infra` no longer carries `infra` and no scan starts

#### Scenario: Duplicate refused in place
- **WHEN** `alpha-infra` carries `client` and the user adds `Client`
- **THEN** the label is not added, no request is made, and the input says it already exists

### Requirement: Labels are shown in a label colour

Every displayed label — custom or detected — SHALL be painted in a label colour wherever it is shown: on the overview
row and tile, in the repository board header, in the overview's label filter and in the labels dialog. A label's colour
SHALL be decided by its name ignoring case, so a label has the same colour on every repository and in every view. When
the user has chosen a colour for the label, that colour SHALL be used; otherwise the colour SHALL be derived
deterministically from the label's name, without configuration, and SHALL stay the same across reloads, scans, filter
changes and machines.

Every hue a label can be shown in, derived or chosen, SHALL be one of the hues assignable to repository colours
(kanban-board: "Each repository has its own stable colour"), so it keeps at least 12° from every status role hue and from the
brand accent. The theme SHALL supply the colour's lightness and chroma, so that a label's text keeps a contrast ratio
of at least 4.5:1 against its chip, laid over the row, tile, board header, filter bar and dialog backgrounds, in both
themes.

Colour MUST NOT be the only cue. A label SHALL always show its text; a detected label SHALL keep its icon and its
tooltip naming the marker; and a label that is active in the overview's label filter SHALL show a check mark and the
brand-coloured border in addition to its own colour, so that active and inactive chips of the same label differ by more
than colour.

#### Scenario: Same label, same colour
- **WHEN** `alpha-infra` and `beta-soc` both carry the custom label `client`, and `demo-ops` carries `Client`
- **THEN** the `client` chips on all three rows, their tiles and the label filter are painted in one colour

#### Scenario: Derived colour is stable
- **WHEN** nobody chose a colour for `terraform` and the dashboard is reloaded, rescanned or opened on another machine
- **THEN** `terraform` is shown in the same colour each time

#### Scenario: A label never looks like a status
- **WHEN** any label is shown in either theme
- **THEN** its hue is at least 12° from the `info`, `branch`, `success`, `warning` and `danger` hues and from the brand
  accent

#### Scenario: Legible in both themes
- **WHEN** the theme is switched between dark and light
- **THEN** every label's text keeps a contrast ratio of at least 4.5:1 against its chip on every background it is shown on

#### Scenario: Active filter chip
- **WHEN** the user activates `terraform` in the label filter
- **THEN** the `terraform` chips show a check mark and the brand border while keeping their label colour, and the other
  chips show neither

### Requirement: The user can choose a label's colour

The labels dialog of a managed project on the projects overview SHALL offer, for each custom label and each detected
label it lists, a control that chooses that label's colour from the assignable hues, plus **Auto**, which returns the
label to its derived colour. A choice SHALL apply to the label's name ignoring case on every repository, SHALL take
effect at once without a separate save, and SHALL persist in `~/.spec-control/config.json` in a top-level
`labelColors` map from the label's name in lower case to the chosen hue, never in a repository. **Auto** SHALL remove
the label's entry, so the map never holds a derived colour. While a choice is being saved the dialog SHALL show that it
is working; when it fails the dialog SHALL show the reason and the label's colour SHALL stay as it was. Choosing a
colour SHALL NOT trigger a scan.

The configuration SHALL accept `labelColors` only as an optional map whose keys follow the label rules and are in lower
case, whose values are whole numbers from 0 to 359, and which holds at most 200 entries; a configuration that breaks
one of these rules SHALL be refused on save with an error naming the label, and nothing SHALL be saved. A stored hue
that is not one of the assignable hues SHALL be shown as the nearest assignable hue, so retuning the palette never makes
a saved configuration unreadable. A configuration without `labelColors` SHALL load unchanged, and saving it SHALL NOT
add an empty map. An entry for a label no repository displays any longer SHALL have no effect and SHALL be kept.

#### Scenario: Choosing a colour
- **WHEN** the user opens the labels dialog of `alpha-infra` and chooses a colour for `client`
- **THEN** `client` takes that colour on `alpha-infra`, on `beta-soc` and in the label filter without any Save, the
  configuration's `labelColors` carries `client`, no scan starts and no file in any repository changes

#### Scenario: Back to Auto
- **WHEN** the user chooses **Auto** for `client`
- **THEN** `client` returns to its derived colour and `labelColors` no longer has a `client` entry

#### Scenario: Recolouring a detected label
- **WHEN** the user chooses a colour for the detected label `go` in the labels dialog of `demo-ops`
- **THEN** every repository that displays `go` shows it in that colour

#### Scenario: Failed save
- **WHEN** saving a colour choice fails
- **THEN** the dialog shows the reason and the label keeps the colour it had

#### Scenario: Older configuration
- **WHEN** a configuration written before label colours existed is loaded and saved again without edits
- **THEN** it gains no `labelColors` key

#### Scenario: Invalid hue refused
- **WHEN** a save would store the hue `400` for `client`
- **THEN** the save is refused with an error naming `client` and the stored configuration is unchanged
