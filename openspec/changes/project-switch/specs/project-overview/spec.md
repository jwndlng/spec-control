# Spec Delta

## ADDED Requirements

### Requirement: The repository board header switches between projects
The repository name in the repository board header's breadcrumb SHALL be a control that opens a list of every tracked
project in the current snapshot, so the user can go to another project's board without returning to the overview. The
control SHALL show the repository name and a chevron, keep the repository's full path as its tooltip, and say that it
switches projects to assistive technology. The `Projects` link before it SHALL be kept.

The list SHALL be sorted by project name, ignoring case, and SHALL mark the current project as current. A project
sharing its name with another listed project SHALL show the same path hint the overview gives it; a project whose last
scan failed SHALL be marked as such and still be listed. Every entry SHALL expose the project's full path as its tooltip.
The list SHALL begin with a search field, focused when the list opens, that narrows the entries to those whose name or
hint contains the text, ignoring case, and that says when nothing matches.

Choosing an entry SHALL open that project's board without a page reload and close the list; choosing the current
project SHALL only close the list. Each entry SHALL be a link to the project's board, so a modifier or middle click
opens it in a new tab or window and leaves the current board as it is. From the search field the Down arrow SHALL move
to the first entry, the arrows SHALL move between entries, and Enter in the search field SHALL open the first matching
entry. Escape SHALL close the list and return focus to the control without leaving the page, and the list SHALL close
when a click or the focus moves outside it. Opening the list and searching SHALL change nothing but what is shown.

#### Scenario: Switching to another project
- **WHEN** the board of `alpha-infra` is shown, `beta-soc` and `gamma-web` are also tracked, and the user activates the
  name `alpha-infra` in the header and chooses `gamma-web`
- **THEN** the board of `gamma-web` is shown without a page reload, its header reads `Projects / gamma-web`, and the
  list is closed

#### Scenario: List content
- **WHEN** the user opens the switcher on the board of `beta-soc` while `gamma-web`, `alpha-infra` and `beta-soc` are
  tracked
- **THEN** the list reads `alpha-infra`, `beta-soc`, `gamma-web` in that order, with `beta-soc` marked as current, and
  the search field has the focus

#### Scenario: Same-named projects
- **WHEN** `/w/acme/chat-groups` and `/w/ops/repos/chat-groups` are both tracked as `chat-groups`
- **THEN** their entries show the hints `acme` and `ops/repos`, and typing `ops` leaves only the second

#### Scenario: Searching
- **WHEN** the user types `ga` into the search field
- **THEN** only `gamma-web` is listed, and pressing Enter opens its board

#### Scenario: No match
- **WHEN** the user types `zzz` into the search field
- **THEN** no entry is listed and the list says that no project matches

#### Scenario: Failed scan
- **WHEN** the last scan of `beta-soc` failed
- **THEN** its entry is still listed and is marked as a failed scan

#### Scenario: Opening in a new tab
- **WHEN** the user ⌘-clicks or middle-clicks `gamma-web` in the list
- **THEN** the browser opens the board of `gamma-web` in a new tab and the current board stays as it is

#### Scenario: Escape
- **WHEN** the list is open and the user presses Escape
- **THEN** the list closes, the focus returns to the project name, and the board stays shown
