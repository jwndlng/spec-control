# settings-page Specification

## Purpose
Defines the structure of the Settings page: the list of sections, the section navigation (jumping, current-section highlight, counts, keyboard and screen-reader behaviour), section deep links, the single-page/single-draft rule and the narrow-screen layout. What the individual panels do is defined by `repo-discovery`, `shared-config` and `agent-sessions`.

## Requirements

### Requirement: Settings is one page made of named sections
The Settings page SHALL present all settings on a single page as an ordered list of sections, each with a stable identifier and a label: Workspace roots (`roots`), Scanning (`scanning`), Agent sessions (`agents`), Shared OpenSpec config (`shared-config`), Updates (`updates`) and Environment (`environment`). Settings SHALL NOT manage repositories one by one: discovered, integratable, tracked and disabled repositories, their names and their per-repository agent settings are all on the projects overview. The Shared OpenSpec config section still lists tracked repositories, but only to preview and apply profiles to them. Environment SHALL be the last section: it reports on the machine rather than configuring anything, and it is where the environment indicator outside Settings links to. All sections that apply SHALL be rendered at the same time; navigating between them MUST NOT unmount a section, discard unsaved edits, or change what the save bar and the "unsaved changes" indicator cover. The navigation and the sections SHALL be produced from the same list, so that every section shown has exactly one navigation entry and every navigation entry has a section. Opening Settings with a `section` parameter naming a section that no longer exists (`tracked`, `discovered`, `integratable`) SHALL behave like any unknown identifier. Saving Settings MUST NOT change any repository's name, `enabled` state or agent-session settings: it keeps them as the dashboard last received them, including changes made on the overview after Settings was opened with unsaved edits.

#### Scenario: Unsaved edits survive navigation
- **WHEN** the user changes the poll interval without saving and then uses the navigation to go to Workspace roots and back to Scanning
- **THEN** the edited value is still in the field and the save bar still shows "unsaved changes"

#### Scenario: A section that is not available has no entry
- **WHEN** the configuration has not loaded yet, so the Shared OpenSpec config section is not rendered
- **THEN** the navigation has no Shared OpenSpec config entry, and it gains one when the section appears

#### Scenario: Find in page covers everything
- **WHEN** the user searches the page for a workspace root with the browser's find function while at the top of Settings
- **THEN** matches in any section are found, because all sections are present in the page

#### Scenario: Environment comes last
- **WHEN** Settings is opened
- **THEN** the last navigation entry and the last section are Environment, and the first section is still Workspace roots

#### Scenario: Environment does not join the draft
- **WHEN** the user opens the Environment section and asks for a fresh report without editing anything else
- **THEN** the save bar shows no unsaved changes

#### Scenario: No discovered section
- **WHEN** Settings is opened
- **THEN** neither the navigation nor the page has a Tracked repositories, Discovered or Without OpenSpec section

#### Scenario: An old deep link
- **WHEN** the user opens `/settings?section=tracked`
- **THEN** Settings opens at the top

#### Scenario: Saving does not undo the overview
- **WHEN** the user edits the poll interval in Settings without saving, goes to the overview, renames `beta-soc`, returns to Settings and saves
- **THEN** the saved config has the new poll interval and `beta-soc` keeps its new name

#### Scenario: Updates comes before Environment
- **WHEN** Settings is opened
- **THEN** Updates is the second-to-last navigation entry and section, directly before Environment

#### Scenario: Deep link to Updates
- **WHEN** the user opens `/settings?section=updates`
- **THEN** Settings opens with the Updates section at the top of the visible area and its entry current

### Requirement: A section navigation is shown beside the sections
On viewports wider than 720px the Settings page SHALL show a navigation to the left of the sections, listing every section in page order and starting level with the first section. Settings SHALL scroll as one page: the navigation and the sections SHALL share a single scroll area that spans the full width below the top bar, so that scrolling works wherever the pointer is. The navigation SHALL move along with the content beside the section it is placed by: the section occupying the top of the visible area, or, after the user activated an entry, that entry's section until the user scrolls again. While that section's start is in view the navigation SHALL be level with it; once that start has scrolled above the view, the navigation SHALL stay in view level with the top of the visible area until it reaches the end of that section, with which it then moves; it SHALL never extend below the last section. Reaching the end of the page, where the last section becomes the current entry without having reached the top of the visible area, SHALL NOT by itself move the navigation, and scrolling back from the end by a few pixels SHALL NOT move it either. When the section the navigation is placed by changes, the navigation SHALL glide to its new place; while scrolling within one section it SHALL keep pace with the content without lagging behind, and scrolling during a glide SHALL neither restart nor slow the glide. It SHALL NOT be pinned to the top of the page independently of the sections. Activating an entry SHALL bring the start of that section to the top of the visible area and move keyboard focus to that section, so that the next Tab press reaches the section's first control. When the page is scrolled back to its very top, the navigation SHALL be visible again, level with the first section. Scrolling and gliding SHALL be animated only when the user has not requested reduced motion. The save bar SHALL remain visible and unchanged.

#### Scenario: Jump to a section below the fold
- **WHEN** 17 repositories are tracked, the user is at the top of Settings and activates the "Scanning" entry
- **THEN** the Scanning section is scrolled to the top of the visible area and the navigation is level with it

#### Scenario: The navigation moves along to the next section
- **WHEN** the user scrolls Settings down by hand until "Agent sessions" becomes the current section
- **THEN** the navigation has glided to be level with the start of the Agent sessions section

#### Scenario: A section taller than the window
- **WHEN** the current section is taller than the visible area and the user scrolls further down inside it
- **THEN** the navigation stays in view at the top of the visible area, and when the end of that section reaches it, it moves up together with that end

#### Scenario: The last section
- **WHEN** the user scrolls to the end of Settings and the last section is shorter than the navigation
- **THEN** the navigation ends with the page and does not extend below the last section

#### Scenario: Reaching the end does not move the navigation
- **WHEN** the user scrolls Settings down by hand to its very end, where the short Environment section becomes the current entry while Shared OpenSpec config still occupies the top of the visible area
- **THEN** the Environment entry is marked current, and the navigation stays where it was beside the top of the visible area instead of moving down to the Environment section

#### Scenario: Leaving the end does not move the navigation
- **WHEN** the user is at the very end of Settings and scrolls up by a few pixels
- **THEN** the navigation keeps pace with the content and does not jump or glide

#### Scenario: Scrolling during a glide
- **WHEN** the navigation has started to glide to the next section and the user keeps scrolling
- **THEN** the glide finishes in its usual time at the navigation's place for the current scroll position, without starting over

#### Scenario: Back at the top
- **WHEN** the user has jumped to "Agent sessions" and scrolls back to the very top of Settings
- **THEN** the navigation is level with the first section

#### Scenario: Deep link
- **WHEN** the user opens Settings with `section=agents`
- **THEN** the Agent sessions section is at the top of the visible area and the navigation is level with it

#### Scenario: Scrolling works anywhere on the page
- **WHEN** the pointer is over the navigation or over the empty margin beside the sections and the user turns the mouse wheel
- **THEN** the Settings page scrolls exactly as it does with the pointer over a section

#### Scenario: Keyboard use
- **WHEN** the user tabs to the "Scanning" entry, presses Enter, and then presses Tab
- **THEN** focus is on the first interactive control inside the Scanning section

#### Scenario: Reduced motion
- **WHEN** the operating system requests reduced motion and the user activates an entry
- **THEN** the section is shown immediately without a scrolling animation and the navigation is placed beside it without gliding

#### Scenario: Save bar stays
- **WHEN** the user scrolls to the end of Settings with unsaved changes
- **THEN** the save bar with "unsaved changes" is still visible at the bottom

### Requirement: The navigation shows which section is in view
The navigation SHALL mark exactly one entry as current: the section occupying the top of the visible area, or the last section when the page is scrolled to its end. The current entry SHALL be distinguishable by more than colour and SHALL be exposed to assistive technology as the current item. When the user activates an entry, that entry SHALL become current immediately and remain so until the resulting scroll has finished.

#### Scenario: Highlight follows scrolling
- **WHEN** the user scrolls from the top of Settings until the Scanning section reaches the top of the visible area
- **THEN** the current entry changes from "Workspace roots" to "Scanning"

#### Scenario: Short last sections can become current
- **WHEN** the user scrolls to the very end of Settings
- **THEN** the last section's entry is current, even if that section is too short to reach the top of the visible area

#### Scenario: No flicker on jump
- **WHEN** the user is at the top and activates the last entry
- **THEN** the last entry is current throughout the scroll, without intermediate entries becoming current

### Requirement: Navigation entries show counts that matter
The "Environment" entry SHALL show the number of checks in the latest report whose status is neither `ok` nor `not-needed`, SHALL be visually emphasised when that number is greater than zero, and SHALL show a pending indicator instead of a number while the report is being computed and nothing instead of a number when no report could be loaded. No other entry SHALL show a count. Emphasis MUST NOT rely on colour alone. The count SHALL always equal the number shown in the Environment section heading.

#### Scenario: New repositories to enable
- **WHEN** discovery finds 3 repositories that are not tracked
- **THEN** no navigation entry counts them; the Workspace roots section states that 3 untracked repositories were found and links to the projects overview

#### Scenario: Nothing to enable
- **WHEN** no untracked repositories are found
- **THEN** the Workspace roots section says that none were found and no navigation entry is emphasised because of discovery

#### Scenario: Counts follow the draft
- **WHEN** the user switches agent sessions on and changes the poll interval without saving
- **THEN** no navigation entry gains a count, and the "Environment" entry's count is unchanged

#### Scenario: Two environment problems
- **WHEN** the latest report has one `problem`, one `warning` and the rest `ok` or `not-needed`
- **THEN** the "Environment" entry shows `2` and is emphasised, and the Environment section heading says the same number

#### Scenario: A healthy environment
- **WHEN** every check in the latest report is `ok` or `not-needed`
- **THEN** the "Environment" entry shows `0` without emphasis

### Requirement: Sections can be linked to
The current section SHALL be reflected in the URL as the query parameter `section` holding the section identifier, updated without adding browser history entries and without discarding other query parameters. Opening Settings with a valid `section` parameter SHALL show that section at the top of the visible area once it is available; an unknown identifier SHALL be ignored and Settings SHALL open at the top. This SHALL work the same in the locally served dashboard and in the demo build, whose route is carried in the URL fragment. Navigation entries SHALL be real links that can be opened in a new tab.

#### Scenario: Deep link on the dashboard
- **WHEN** the user opens `/settings?section=discovered`
- **THEN** Settings opens with the Discovered section at the top of the visible area and its entry current

#### Scenario: Deep link in the demo
- **WHEN** the user opens the demo at `index.html?section=agents#/settings`
- **THEN** Settings opens at the Agent sessions section

#### Scenario: Back button is not polluted
- **WHEN** the user opens Settings from the board, scrolls through four sections, and presses the browser's back button once
- **THEN** the board is shown

#### Scenario: Unknown section
- **WHEN** the user opens `/settings?section=nope`
- **THEN** Settings opens at the top with "Workspace roots" current

### Requirement: The navigation adapts to narrow screens
On viewports of 720px width or less, the navigation SHALL be shown as a single horizontally scrollable row above the sections instead of a left column, and SHALL scroll away with the sections; unlike the wide navigation it SHALL NOT be moved along, pinned or sticky, and it MUST NOT cover any section. The keyboard focus order SHALL remain navigation first, then the sections in page order. The row SHALL keep the current entry within its visible part by scrolling the row sideways only, and every visible entry SHALL be activatable however far the row has been scrolled sideways. Updating the current entry MUST NOT scroll the page. All other navigation behaviour SHALL be the same as on wide viewports.

#### Scenario: Phone-width layout
- **WHEN** Settings is shown in a 400px wide viewport
- **THEN** the sections use the full width, the navigation is a row above them that can be scrolled sideways, and activating an entry still jumps to its section

#### Scenario: Jump on a narrow viewport
- **WHEN** the user activates "Scanning" in a 400px wide viewport
- **THEN** the Scanning section is at the top of the visible area and no section content is hidden behind the row

#### Scenario: The row scrolls away
- **WHEN** the user scrolls down on a narrow viewport until the third section is at the top
- **THEN** the navigation row has scrolled out of view above it

#### Scenario: Marker updates never move the page
- **WHEN** the user keeps scrolling down through three sections
- **THEN** the page position changes only by the user's scrolling, the URL's `section` parameter follows the section in view, and the page is never pulled back

#### Scenario: Current entry stays visible in the row
- **WHEN** the user has scrolled to the last section on a narrow viewport and scrolls back up until the row is in view
- **THEN** the row shows the entry that is current without the user having to scroll the row sideways, and clicking any visible entry jumps to its section

### Requirement: Sections open with a coloured headline
Every Settings section SHALL open with exactly one headline naming it, shown in the theme's brand accent colour and set apart from the section's hints and labels by a larger size and a heavier weight as well, so that the colour is never the only difference. A group within a section (for example Ignored paths, Agents, Shortcuts, Console, Projects, Repositories) SHALL have a subordinate heading: visibly smaller than the section's headline, larger or heavier than hint text, and not in the brand accent colour. Headlines and subordinate headings SHALL be exposed to assistive technology as headings of two consecutive levels. In both themes their text SHALL have a contrast ratio of at least 4.5:1 against the panel behind it, and they SHALL be drawn from the theme's tokens. The headings of views other than Settings SHALL NOT change.

#### Scenario: Section starts are recognisable
- **WHEN** the user scrolls through Settings
- **THEN** each of Workspace roots, Scanning, Agent sessions, Shared OpenSpec config and Environment starts with a headline in the accent colour, larger and heavier than the text below it

#### Scenario: Groups are subordinate to their section
- **WHEN** the Agent sessions section is shown
- **THEN** its Agents, Shortcuts, Console and Projects headings are smaller than the Agent sessions headline, not in the accent colour, and exposed as headings one level below it

#### Scenario: Readable in the light theme
- **WHEN** the active theme is `light`
- **THEN** every Settings headline and subordinate heading has a contrast ratio of at least 4.5:1 against its panel

#### Scenario: Other views keep their headings
- **WHEN** the user opens the board, the projects overview or a dialog after this change
- **THEN** their headings look as they did before

### Requirement: Saving Settings keeps changes made elsewhere

Saving Settings MUST NOT undo a configuration change that was saved elsewhere after the Settings draft was seeded — a repository tracked, enabled, disabled or forgotten, an ignore path added from the overview, a label colour, the fast-forward warning, a project setting or a save from another tab. Settings SHALL send the revision of the configuration its draft was seeded from. When the server answers that the configuration has changed since, Settings SHALL apply the user's edits — each top-level setting where the draft differs from the copy it was seeded from — onto the current configuration, with the repositories as the current configuration has them. When none of the settings the user edited was changed elsewhere, Settings SHALL save the result without asking. Otherwise it SHALL show the result, with the user's edits over the newer values, say that settings were changed elsewhere while Settings was open, keep the save bar's "unsaved changes", and save only when the user saves again. The setup wizard SHALL likewise recompute a save that was refused this way from the current configuration and try once more.

#### Scenario: An ignore path added from the overview survives
- **WHEN** the user edits the poll interval in Settings without saving, in another tab ignores `/w/acme/mirror` on the overview, and then saves Settings
- **THEN** the saved configuration has the new poll interval and `/w/acme/mirror` among its ignore paths, without a second save

#### Scenario: The same setting changed in two tabs
- **WHEN** the user edits the poll interval to 120 seconds in one Settings tab, another tab saves it as 90 seconds, and the first tab saves
- **THEN** nothing is saved yet, the first tab shows 120 seconds with a notice that settings were changed elsewhere, and saving again saves 120 seconds

### Requirement: Argument fields keep what is typed
Every Settings field that takes an argument list as one argument per line — an agent profile's **Command**, **Launch
arguments** and **Resume command**, and the **Editor command** — SHALL keep its text exactly as the user types it while
the field is edited, including spaces inside, before and after an argument and empty lines. What is stored SHALL be the
parsed list: each line trimmed, empty lines dropped, and an empty list stored as no value where the field is optional.
The field's text SHALL be replaced from the stored list only when that list is changed by something other than typing
in the field, such as adding a preset or switching to another profile.

#### Scenario: An argument with spaces
- **WHEN** the user types `open`, Enter, `-a`, Enter, `Visual Studio Code`, Enter, `{path}` into the Editor command
- **THEN** the field shows those four lines as typed and the stored editor command is `open`, `-a`,
  `Visual Studio Code`, `{path}`

#### Scenario: A new line for the next argument
- **WHEN** the user types `claude` into a profile's Command and presses Enter
- **THEN** the cursor is on a new, empty line, and the stored command is still `claude` until a second argument is typed

#### Scenario: Surrounding whitespace is not stored
- **WHEN** a profile's Launch arguments field holds `  --mode auto ` and an empty last line
- **THEN** the stored launch arguments are `--mode auto` alone

### Requirement: Settings saves after a tracked folder's spelling changed
Saving Settings SHALL succeed when a tracked repository's folder was renamed by case only or replaced by a symbolic link to the same directory since Settings was opened, as long as the rest of the draft is valid: the repository SHALL keep its id, name, enabled state and every other setting, and the saved configuration SHALL hold the path in its new canonical spelling. Settings MUST NOT show the save as failed or ask the user to restart the dashboard for such a change.

#### Scenario: Saving after a tracked folder was respelled
- **WHEN** Settings is open, a tracked folder `/w/acme/Acme` is renamed to `/w/acme/acme` on a case-insensitive file system, and the user changes the poll interval and saves
- **THEN** the save succeeds and the project keeps its id and its sessions, with the path `/w/acme/acme`
