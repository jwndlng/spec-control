# Proposal

## Why

On a repository board the only way to another project is back through the Projects overview and down again: two
navigations and a scroll for something users do constantly when several agents work across repositories. The board's
header already names the project in its breadcrumb; that name should be the place to switch.

## What Changes

- The repository name in the repository board header's breadcrumb (`Projects / <name>`) becomes a **project switcher**:
  a button showing the name and a chevron that opens a list of every tracked project.
- The list is sorted by name, marks the current project, gives same-named projects the same path hint the overview
  uses, flags a project whose last scan failed, and has a search field at the top that narrows it by name or hint.
- Choosing a project opens that project's board in place, without a page reload; each entry is an ordinary link, so a
  modifier or middle click opens it in a new tab. The list is fully usable from the keyboard (arrow keys, Enter,
  Escape) and closes when focus or a click leaves it.
- The `Projects` breadcrumb link, the repository's full path as the name's tooltip, and everything else in the header
  stay as they are.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `project-overview`: adds a requirement that the repository board header's project name switches to any other tracked
  project.

## Impact

- `src/ui/kanban.tsx` (`RepoHeader` breadcrumb), a new `src/ui/projectSwitch.tsx` (the switcher) and
  `src/ui/projectSwitchState.ts` (its pure entry list and search), `src/ui/styles.css`.
- Tests: a new `test/projectSwitch.test.ts`.
- No server, API, configuration or network change; nothing is written anywhere. Invariants are untouched.
