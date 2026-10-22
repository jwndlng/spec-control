# Proposal

## Why

The repository board's header has grown one feature at a time: a breadcrumb and counts, a status row of checkout chips,
a branches control, a pull-requests control, label chips, shared-config badges and an "updated" age, and an action area
of six controls (Console, Pull, the fetch note, Clean up, Import from issues, New change) that mixes information with
actions and explains none of them. Someone new to Spec Control cannot tell what matters, what each button does, or
where the project's own settings are — those are reachable only from the projects overview.

## What Changes

- **Actions are grouped and described.** The header's action area holds its actions in named groups, each with a small
  visible caption: **Agent** (Console), **Repository** (Pull, Clean up) and **Changes** (Import from issues, New
  change). Each action's tooltip and accessible description say in one sentence what it does and what it leaves
  alone. The order stays Console first and New change last as the only filled primary button; a group with no
  action available is not shown, and the area wraps as whole groups on a narrow window.
- **Information moves out of the action area.** The fetch note ("fetched 4m ago", auto fetch, auto fetch failed)
  leaves the action area and becomes part of the quick view.
- **A quick view of the most important facts.** Under the title the header shows one compact row: the open and
  to-archive counts, the main checkout's chip, the branches control (`<n> branches`, `<m> with work`), the open
  pull-requests control, the fetch note, an attention marker when a shared-config profile is not in sync or the config
  is unreadable, and a **Details** control. Labels, in-sync shared-config profiles and the "updated" age leave the
  header.
- **A project details overlay.** **Details** opens a dialog with everything about the project in labelled sections:
  the repository (its path, git or not, last updated), its checkouts (the list the branches dialog shows today), sync
  (last fetch with exact time, auto fetch interval or failure, the default-branch notice), pull requests (the count and
  a way into the existing pull-requests dialog), shared config profiles with their state, and labels. The branches
  control opens this overlay at its checkouts section instead of a dialog of its own. Repository warnings and a failed
  scan stay as notices in the header, never hidden in the overlay.
- **Project settings on the board.** The title row offers the project's settings button beside its name, opening the
  same settings dialog the overview opens (agent sessions, agent, PR titles, docs auto-merge, auto fetch, labels,
  Disable). Disabling the project from the board closes the dialog and returns to the projects overview.
- Nothing new is written, fetched or run: every control keeps its behaviour, every setting is saved through the
  existing configuration route, and the overlay shows only what the snapshot, config and cached pull-request list
  already carry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: "Actions have their own area" gains captioned action groups with descriptions and loses the fetch
  note; "The board opens with a header band" places the repository board's counts in its quick view.
- `project-overview`: "Repository board header" is restructured into a title row with the settings button, a quick
  view and a details overlay that takes over the branches dialog; "A project shows when it was last fetched" places
  the board's fetch note in the quick view; the project settings dialog is also opened from the board.
- `project-labels`: "Labels are shown on the overview and the board header" moves the board's labels into the
  project details overlay.
- `shared-config`: the repository board shows its profiles in the details overlay, with only a not-in-sync or
  unreadable state surfacing in the header.

## Impact

- UI only: `src/ui/kanban.tsx` (`RepoHeader`), `src/ui/checkout.tsx` (the branches control opening the overlay, the
  checkout list reused), `src/ui/projectSettings.tsx` and `src/ui/untracked.tsx` (settings dialog and tracking state
  usable from the board), `src/ui/pull.tsx` (fetch note placement), `src/ui/pullRequests.tsx` (opening the
  pull-requests dialog from the overlay), a new `src/ui/projectDetails.tsx`, `src/ui/app.tsx` (config updates from the
  board), `src/ui/styles.css`, `src/ui/helpContent.tsx` and the tour if it points at moved controls.
- Tests: `test/` UI-logic tests for the quick view's facts, the action groups and the overlay sections.
- No server, API, configuration format or network change; invariants 1–7 are untouched.
