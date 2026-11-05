# whats-new Specification

## Purpose
Tells the people running the dashboard, inside the UI and without any network request, which user-visible features are
new: a curated changelog compiled into the UI, a What's new dialog, and a per-browser count of entries not yet seen.

## Requirements

### Requirement: The changelog is embedded in the UI
The dashboard SHALL carry a curated list of user-visible features as part of its UI build, each entry with a unique id,
a calendar date, a short title and a summary that MAY use Markdown. Each entry SHALL be authored in an independent JSON
file named by its id under `src/ui/changelog/entries/`; the build SHALL discover, validate and order these files into the
stable `CHANGELOG` interface consumed by the UI. The list SHALL be identical under `bun run dev`, in the compiled binary
and on the demo site. Reading it MUST NOT make any request, neither to the dashboard's own server nor to any other host,
and MUST NOT read or write any tracked repository.

#### Scenario: Independent entry additions
- **WHEN** two feature branches add entries with different ids
- **THEN** each branch adds only its own entry file and the merged build includes both

#### Scenario: Deterministic same-day order
- **WHEN** multiple entry files have the same date
- **THEN** the assembled list preserves established same-day positions and orders new entries by id ascending, regardless of filesystem enumeration order

#### Scenario: Invalid entry file
- **WHEN** a file name disagrees with its entry id, ids are duplicated, or an entry has an invalid date or empty text
- **THEN** the loader fails and identifies the offending entry

#### Scenario: Offline binary
- **WHEN** the compiled binary runs on a machine without network access and the user opens What's new
- **THEN** every entry is shown and the page has made no request for it

#### Scenario: Demo site
- **WHEN** a visitor opens What's new on the demo site
- **THEN** the same entries as in the binary built from the same commit are shown

### Requirement: What's new lists the entries newest first
A **What's new** control in the hero's top corner SHALL open a dialog listing every entry, newest first, grouped under
month headings, each with its date, title and summary. Summary Markdown SHALL be rendered with the same safe renderer as
artifacts, so no raw HTML from an entry reaches the page. The dialog SHALL link to the project's GitHub releases page
for the full release notes; that link SHALL be one the user follows, never a request the page makes. The dialog SHALL
close on Escape, on a click on the backdrop and with its close control.

#### Scenario: Two entries in different months
- **WHEN** the changelog holds `Project labels` dated 2026-10-02 and `Repository cleanup` dated 2026-09-24
- **THEN** the dialog shows `October 2026` with `Project labels` above `September 2026` with `Repository cleanup`

#### Scenario: Full release notes
- **WHEN** the user activates the release notes link in the dialog
- **THEN** the GitHub releases page opens as an ordinary link and nothing else is fetched

### Requirement: Unseen entries are counted per browser
The What's new control SHALL show the number of entries the user has not seen yet, and no number when there are none.
Which entries were seen SHALL be remembered in the browser's own storage only; nothing about it is sent to or stored by
the server. On the first visit in a browser — nothing remembered yet — every existing entry SHALL be taken as seen, so
the count starts at zero. Opening the dialog SHALL mark every entry seen and clear the count; entries that were unseen
when the dialog opened SHALL carry a **New** mark for as long as it stays open. A browser that refuses storage SHALL
still show the control and the dialog, with no count.

#### Scenario: First visit
- **WHEN** the dashboard is opened for the first time in a browser and the changelog holds 12 entries
- **THEN** the What's new control shows no count

#### Scenario: After an upgrade
- **WHEN** the user had seen every entry and upgrades to a binary whose changelog holds three more
- **THEN** the control shows `3`; opening the dialog shows those three marked **New** and the control then shows no count

#### Scenario: Entry removed from the changelog
- **WHEN** an entry the user had seen is removed from the changelog in a later build
- **THEN** the count is unaffected and no other entry becomes unseen

#### Scenario: Storage refused
- **WHEN** the browser throws on every storage access
- **THEN** the control and the dialog work and no count is shown

### Requirement: The changelog stays well-formed and current
The build and test suite SHALL use the same validation logic and fail when two entries share an id, an id is not of the
form `<YYYY-MM-DD>-<kebab-case-slug>` with the entry's own date, a date is not a valid calendar date, or a title or
summary is empty. `CONTRIBUTING.md` SHALL tell contributors to add an independent entry file for every `feat` pull
request whose change users can see, and this repository's OpenSpec configuration SHALL tell agents planning such a
change to include a task to add that file.

#### Scenario: Duplicate id
- **WHEN** a contributor adds an entry whose id is already in the list
- **THEN** `bun run check` fails naming that id

#### Scenario: Same-day order is stable
- **WHEN** filesystem enumeration returns same-day entries in a different order
- **THEN** the loader still returns existing entries in their established order and new entries in id ascending order

#### Scenario: Planning a feature
- **WHEN** an agent creates `tasks.md` for a change in this repository that adds a user-visible feature
- **THEN** the OpenSpec instructions it receives ask for a task to add an independent What's new entry file
