# activity-feed Specification

## Purpose
Defines the activity feed: the history of what the dashboard observed happening across the tracked repositories — how events are derived by comparing consecutive scan snapshots, what a first sight of a repository and a restart mean for them, which agent session events belong to it, where the log is kept and how it is bounded, and how the feed is shown, collapsed, filtered and counted in the UI.

## Requirements

### Requirement: Activity is detected by comparing consecutive snapshots
After every scan the dashboard SHALL compare the new snapshot with the previous one and record what changed as events: a change created, a change moved from one column to another, task progress within a column, a change archived, a change removed, a repository tracked or no longer tracked, and a repository's scan starting to fail or recovering. Changes SHALL be matched by repository and change name. A change that moved and progressed in the same scan SHALL yield one moved event carrying the new progress. While a repository's scan is failing its changes MUST NOT be compared. Detection MUST be a function of the two snapshots only and MUST NOT read or write any repository.

#### Scenario: A change becomes ready
- **WHEN** the previous snapshot shows change `cache-api-calls` of `demo-ops` in `Drafts` and the new one shows it in `Ready`
- **THEN** one event is recorded: `cache-api-calls` in `demo-ops` moved from `Drafts` to `Ready`

#### Scenario: Task progress
- **WHEN** a change stays in `Implementing` and its tasks go from `3/12` to `7/12`
- **THEN** one task progress event from `3/12` to `7/12` is recorded

#### Scenario: Moved and progressed at once
- **WHEN** a change goes from `Ready` with `0/7` to `Implementing` with `2/7` between two scans
- **THEN** exactly one event is recorded, moved from `Ready` to `Implementing`, carrying `2/7`

#### Scenario: Created, archived, removed
- **WHEN** between two scans change `add-login` appears, change `bump-toolchain` becomes archived and change `old-idea` disappears
- **THEN** a created, an archived and a removed event are recorded for them respectively

#### Scenario: A failing scan is not mistaken for activity
- **WHEN** a repository's scan fails and the dashboard keeps showing its previous changes
- **THEN** one scan-failing event with the error is recorded and no change events for that repository; when it succeeds again a recovered event is recorded and comparison resumes

#### Scenario: Old entries keep their column names
- **WHEN** the log holds an event recorded before the columns were simplified, `bump-toolchain` moved from `Specs` to `Ready`
- **THEN** the feed shows it with the names it was recorded with

#### Scenario: Renamed columns are not recorded as moves
- **WHEN** the dashboard starts with a snapshot kept from a version that placed `cache-api-calls` in `Specs`, and the first scan finds the change unchanged
- **THEN** no moved event is recorded for it

### Requirement: First sight of a repository is a baseline, not activity
A repository that was not part of the previous snapshot — on first run, after the snapshot cache was deleted, or when the repository was just enabled — SHALL yield exactly one repository-tracked event stating its number of open changes, and MUST NOT yield events for its individual changes. Archived changes that appear for a change not seen before SHALL be recorded only when their archive date lies within the last 7 days.

#### Scenario: First run
- **WHEN** the dashboard scans for the first time with 13 tracked repositories holding 140 changes
- **THEN** 13 repository-tracked events are recorded and no change events

#### Scenario: Enabling a repository
- **WHEN** the user enables repository `beta-soc` and the next scan completes
- **THEN** one repository-tracked event for `beta-soc` is recorded and none for its changes

#### Scenario: Old archives arriving
- **WHEN** a pull brings in archive directories dated months ago that the dashboard had not seen
- **THEN** no archived events are recorded for them

### Requirement: What happened while the dashboard was not running is caught up
Because the previous snapshot is restored from the cache on start, the first scan after a restart SHALL record what changed since the dashboard last ran. Such events SHALL be marked as caught up when the two snapshots are further apart than three poll intervals. An event's time SHALL be the change's last activity time when that lies between the two snapshots, and the time of detection otherwise; the time of detection SHALL always be kept as well.

#### Scenario: After a weekend
- **WHEN** the dashboard is started on Monday, the cached snapshot is from Friday, and change `add-login` was implemented and archived in between, with its last commit on Saturday 14:02
- **THEN** the archived event for `add-login` is recorded, marked as caught up, and timed Saturday 14:02

#### Scenario: No usable activity time
- **WHEN** a change moved between two regular scans and its last activity time is older than the previous snapshot
- **THEN** the event is timed at the moment of detection

### Requirement: Agent session events are part of the activity
When agent sessions are enabled, the dashboard SHALL record a session being started (with its action and agent name), a session ending (with its exit code, or that it failed and why), a session ended by the dashboard because its auto-merge pull request merged (with the pull request's number and whether its worktree was removed, or why it was kept), Ship being used (with whether the prompt was submitted), Resolve conflicts being used (with whether the prompt was submitted) and Merge being sent (with the pull request's number, whether the dashboard sent it on its own because a docs-only pull request was ready or the user sent it, and whether the prompt was submitted). With agent sessions disabled no session events exist. A Resolve conflicts event records only that the prompt was handed to the agent; whether the conflict was actually resolved is not recorded, because the dashboard never learns it from the agent — it is re-derived from git like every other work status. Likewise a Merge event records only that the prompt was handed to the agent; whether the pull request merged is learned from a later pull-request query, never from the agent.

#### Scenario: A session crashes
- **WHEN** the agent of a session for `cache-api-calls` exits with code 1
- **THEN** a session-ended event for that change with exit code 1 is recorded

#### Scenario: Conflicts handed to the agent
- **WHEN** Resolve conflicts is used for the session of `cache-api-calls` and the prompt is submitted
- **THEN** an event for that change is recorded in the sessions group, stating that the prompt was submitted

#### Scenario: Typed but not confirmed
- **WHEN** Resolve conflicts types the prompt but the agent never shows it, so Enter is not pressed
- **THEN** the recorded event states that the prompt was not submitted

#### Scenario: Ended because its pull request merged
- **WHEN** the dashboard ends the archive session of `cache-api-calls` because its auto-merge pull request `#88` merged, and removes its worktree
- **THEN** one event for that change is recorded in the sessions group, naming `#88` and stating that the worktree was removed, and no separate session-ended event is recorded for the same end

#### Scenario: Merge sent on its own
- **WHEN** the dashboard sends Merge for pull request `#88` into the running archive session of `cache-api-calls` because it is a ready docs-only pull request, and the prompt is submitted
- **THEN** one event for that change is recorded in the sessions group, naming `#88`, stating that the dashboard sent it and that it was submitted

### Requirement: The activity log lives in the dashboard home and is bounded
Events SHALL be appended to `activity.jsonl` in the dashboard home (`~/.spec-control/`), one JSON object per line, each with a unique sortable id, its time, its detection time, its kind, the repository id and the repository name at that time, and the fields of its kind. The dashboard MUST NOT write activity anywhere else, and never into a tracked repository. Reading SHALL skip lines it cannot parse or whose format version it does not know, and MUST NOT fail because of them. The log SHALL keep only events whose time lies within the last 7 days: an event older than that, or whose time cannot be read, SHALL NOT be shown in the feed, counted as unseen or recorded, also when it is caught up after the dashboard was not running for longer. In addition the log SHALL keep at most its newest 2 000 entries. The file SHALL be compacted to the entries it keeps, by writing a new file and renaming it, on start when it holds anything it does not keep, when it exceeds 5 000 lines, and while the dashboard runs at most once an hour when events are recorded and entries have aged out since the last compaction. Reading the feed MUST NOT write the file. A failure to write the log MUST NOT fail or delay a scan. Entries MUST NOT contain file system paths, terminal output or prompt text.

#### Scenario: Survives a restart
- **WHEN** events were recorded and the dashboard is restarted
- **THEN** the feed shows those events again

#### Scenario: A torn line
- **WHEN** the last line of the log is incomplete because the process was killed while writing
- **THEN** the feed shows all other events and new events are recorded normally

#### Scenario: Bounded
- **WHEN** the log reaches 5 001 lines, all within the last 7 days
- **THEN** it is compacted to its newest 2 000 entries and the older ones are gone

#### Scenario: Older than a week on start
- **WHEN** the dashboard starts and `activity.jsonl` holds events from 10 days, 6 days and 1 hour ago
- **THEN** the feed shows the events from 6 days and 1 hour ago, and the file is rewritten without the one from 10 days ago

#### Scenario: Aging out while running
- **WHEN** the dashboard keeps running and an event recorded 7 days ago passes the 7-day mark
- **THEN** the feed no longer shows it nor counts it, and once new events are recorded the file is rewritten without it within the hour

#### Scenario: Caught up after a long absence
- **WHEN** the dashboard is started after 10 days and change `add-login` was archived 9 days ago, with its last commit then, and change `cache-api-calls` moved to `Ready` 2 days ago
- **THEN** only the move of `cache-api-calls` is recorded, marked as caught up

#### Scenario: Log not writable
- **WHEN** the log file cannot be written
- **THEN** scans, the board and the overview work as before, the feed still shows only the last 7 days, and the problem is reported on the console

### Requirement: The log is history, never an input
The activity log SHALL record only what the dashboard observed and when. It MUST NOT be read by scanning, by column placement, by any count on the board or the overview, or by any action. The Activity view's summary tiles and its metrics — per day, by hour and per project — are part of the feed and SHALL be the only places that count the log. Deleting the log SHALL lose the history shown in the feed, including the summary's figures and the metrics, and nothing else.

#### Scenario: Deleting the log
- **WHEN** the user deletes `activity.jsonl` and restarts the dashboard
- **THEN** the board, the overview, all counts and all actions are exactly as before, and the feed starts again with one tracked event per repository only if the snapshot cache is missing too

### Requirement: Activity view in the top navigation
The top navigation SHALL offer **Activity** after *All changes*, opening a feed at `/activity` that lists events of all repositories newest first, grouped under day headings (`Today`, `Yesterday`, then dates). Each entry SHALL show its time, the repository name with the repository's colour, the change name in monospace where the event concerns a change, and a short statement of what happened, including the columns of a move and the figures of task progress. Events that were caught up SHALL be marked as having happened while the dashboard was not running. The change name SHALL link to the repository's board when the repository is still tracked, and be plain text otherwise. The feed SHALL load 100 entries and offer to load older ones. Once no older entries are left to load, the end of the feed SHALL state that activity is kept for 7 days; the empty state SHALL say so as well. The view MUST work in every supported theme and MUST NOT require network access beyond the dashboard's own API.

#### Scenario: Reading the feed
- **WHEN** the user opens Activity after a change moved to `Ready` today and another was archived yesterday
- **THEN** the feed shows `Today` with the move (`Specs → Ready`) and `Yesterday` with the archive, each with repository, change name and time

#### Scenario: Repository no longer tracked
- **WHEN** an entry belongs to a repository that has since been removed from the configuration
- **THEN** the entry still shows the repository's name as recorded and its change name is not a link

#### Scenario: Nothing yet
- **WHEN** no events have been recorded within the last 7 days
- **THEN** the view explains that activity appears here as the dashboard observes changes and that it is kept for 7 days

#### Scenario: The end of the feed
- **WHEN** the user has loaded every entry the log keeps
- **THEN** **Load older** is no longer offered and the end of the feed states that activity is kept for 7 days

### Requirement: Task progress is shown collapsed
Consecutive task progress events of the same change SHALL be shown as one entry when each lies within 60 minutes of the next, spanning from the first event's starting figures to the last event's resulting figures and timed at the last; any other event of that change in between SHALL end the run. Collapsing MUST NOT alter the recorded events.

#### Scenario: An hour of ticking tasks
- **WHEN** a change's tasks are observed going `3/12 → 4/12`, `4/12 → 6/12` and `6/12 → 7/12` within forty minutes
- **THEN** the feed shows one entry `3/12 → 7/12` timed at the last observation, and the log still holds three events

#### Scenario: A move ends the run
- **WHEN** progress events are followed by a move to `Done` and then further progress events
- **THEN** the feed shows progress, the move, and progress as three entries

### Requirement: The feed can be filtered
The feed SHALL be filterable by repository, using the same **Repositories** menu and removable repository tags as the board's filter bar, and by kind of event in the groups *Changes*, *Tasks*, *Sessions* and *Repositories*, shown as one group of toggles, with **Clear filters** while any filter is active. Filters SHALL apply to older entries loaded on demand as well and SHALL be kept in the URL query string.

#### Scenario: One repository, sessions only
- **WHEN** the user selects repository `demo-ops` and the group *Sessions*
- **THEN** only session events of `demo-ops` are shown, the URL reflects both filters, and reloading the page shows the same selection

### Requirement: Unseen activity is indicated on the navigation entry
The Activity navigation entry SHALL show the number of events newer than the newest event the user had seen when they last opened the feed, capped at `99+`, and no number when there are none. Opening the feed SHALL mark all current events as seen. What was seen SHALL be remembered in the browser; when it cannot be read or written, no number is shown and the feed works normally. On the very first visit nothing counts as unseen.

#### Scenario: New events since the last visit
- **WHEN** the user last opened the feed yesterday and five events were recorded since
- **THEN** the navigation entry shows `5`, and after opening the feed it shows no number

#### Scenario: First visit
- **WHEN** the user has never opened the feed
- **THEN** no number is shown

### Requirement: The feed is summed up above it
Above the feed, the Activity view SHALL show a row of summary tiles, one per figure, for everything the log keeps, labelled as covering the last 7 days:

- **changes created**: the number of change-created events.
- **changes moved**: the number of change-moved events.
- **changes archived**: the number of change-archived events.
- **tasks completed**: across all task progress events, the sum of each event's increase in finished tasks. An event whose finished count did not rise adds nothing. Figures carried by a move are not counted.
- **sessions run**: the number of session-started events, resumed sessions included.
- **need attention**: the number of events the feed shows in its danger tone. These are a repository's scan starting to fail, and a session that failed or ended with a non-zero exit code.

Each tile SHALL show its figure's value and label, and a trend: the same figure for every day of the per-day metrics, oldest to today, each drawn relative to that figure's busiest day, with today's mark set apart from the other days. The trend SHALL state each day's value on hover and in its accessible description, and a figure that is zero on every day SHALL draw a flat trend. The **need attention** tile SHALL be shown in the danger tone when its value is above zero, with its label always visible, so the state never depends on colour alone.

The figures SHALL count recorded events, not the entries the feed shows, so collapsing task progress MUST NOT change them. They SHALL cover every retained event that matches the view's repository and kind filters, whether or not it is loaded, and SHALL be updated whenever the feed reloads. A figure whose events are all excluded by the kind filter SHALL NOT be shown. The figures describe the feed only: they are part of the history the log provides and MUST NOT appear on, or be used by, the board, the overview or any action. The tiles SHALL NOT be shown when no event matches. The tiles MUST work in every supported theme and at phone width without horizontal scrolling.

#### Scenario: A week in figures
- **WHEN** the log keeps 3 created, 5 moved and 2 archived events, task progress events `0/8 → 3/8`, `3/8 → 5/8` and `5/8 → 4/8`, 4 session-started events, one session that ended with exit code 1 and one scan that started to fail
- **THEN** the tiles show 3 changes created, 5 changes moved, 2 changes archived, 5 tasks completed, 4 sessions run and 2 need attention

#### Scenario: A figure's trend
- **WHEN** 2 changes were created on Monday, none on Tuesday and 4 today
- **THEN** the changes created tile's trend shows Monday at half of today's height, Tuesday empty and today set apart, and hovering Monday's mark states 2

#### Scenario: Beyond the loaded page
- **WHEN** the log keeps 350 change-moved events and the feed has loaded its first 100 entries
- **THEN** the tiles show 350 changes moved

#### Scenario: Collapsing does not change the figures
- **WHEN** three task progress events of one change within forty minutes go `3/12 → 4/12`, `4/12 → 6/12` and `6/12 → 7/12`, and the feed shows them as one entry
- **THEN** the tiles count 4 tasks completed

#### Scenario: Filters apply
- **WHEN** the user selects repository `demo-ops` and the group *Sessions*
- **THEN** only the sessions run and need attention tiles are shown, counted over the events of `demo-ops` alone

#### Scenario: Aged out
- **WHEN** an archived event passes the 7-day mark while the view is open, and the feed reloads after the next scan
- **THEN** changes archived no longer counts it

### Requirement: The feed shows its metrics per day and per project
Below the summary tiles, the Activity view SHALL show charts for everything the log keeps, in three panels: **Per day**, **When** (see the hour-of-day requirement) and **Per project**.

- **Per day**: a column for every calendar day of the user's local time zone from the day that holds the start of the 7-day retention window up to and including today, in order, a day without events shown as an empty column. Each column SHALL be stacked by kind of event in the groups *Changes*, *Tasks*, *Sessions* and *Repositories*, always in that order and each group always in the same colour, sized against a value axis whose scale fits the busiest day, with the day's total of events stated at its top. A legend SHALL name every group drawn. Hovering or focusing a column SHALL show the day, its number of events per group, its total and its number of distinct changes touched. The panel's heading SHALL state the totals: the number of events and the number of distinct changes touched.
- **Per project**: every repository with at least one counted event, ordered by number of events, busiest first, then by name. Each SHALL show the repository's name with a swatch in its colour (neutral when it is no longer tracked), its number of events, its number of distinct changes touched, and a bar relative to the busiest repository, stacked by the same groups in the same colours as the per-day panel. Hovering or focusing a repository SHALL show its number of events per group. When there are more than 6, only the first 6 SHALL be shown, followed by **Show N more**, where N is the number left out; activating it SHALL show all of them and offer **Show fewer**. Activating a repository that is still tracked SHALL filter the feed to that repository alone, exactly as choosing it in the **Repositories** menu; a repository that is no longer tracked SHALL NOT be activatable.

A group excluded by the kind filter SHALL NOT be drawn nor named in the legend, and the colours of the groups still drawn MUST NOT change. The user SHALL be able to switch the panels between **Chart** and **Table** with one control; the table view SHALL state, for every day, every hour with events and every listed repository, the same numbers the chart draws, so no number is reachable only by hovering or only by telling colours apart. The choice SHALL be remembered in the browser, and when it cannot be read or written the charts are shown.

An event SHALL count on the day of its time (the time the feed groups it by), also when it was caught up. A change is touched by an event that concerns it; changes SHALL be told apart by repository and change name, so the same name in two repositories counts twice. The metrics SHALL count recorded events, not the entries the feed shows, so collapsing task progress MUST NOT change them. They SHALL cover every retained event that matches the view's repository and kind filters, whether or not it is loaded, and SHALL be updated whenever the feed reloads. The metrics SHALL NOT be shown when no event matches, and the per-project panel SHALL NOT be shown while the repository filter selects a single repository.

The user SHALL be able to hide and show the metrics with one control next to them; the choice SHALL be remembered in the browser, and when it cannot be read or written the metrics are shown. Hiding them MUST NOT hide the summary tiles, nor change the feed, its paging or **Load older**.

The metrics describe the feed only: they are part of the history the log provides and MUST NOT appear on, or be used by, the board, the overview or any action. The view MUST work in every supported theme, at phone width without horizontal scrolling, and MUST NOT require network access beyond the dashboard's own API or load anything from another host.

#### Scenario: A week per day
- **WHEN** it is Wednesday afternoon, and the log keeps 12 events today touching 3 changes, none yesterday and 40 last Thursday touching 9 changes
- **THEN** the per-day panel shows eight columns from last Wednesday to today, Thursday's the tallest stating 40, today's stating 12, and yesterday's empty, and focusing Thursday's column states 40 events and 9 changes

#### Scenario: A day by kind
- **WHEN** today holds 5 change events, 3 task progress events and 2 session events
- **THEN** today's column is stacked *Changes* 5, *Tasks* 3 and *Sessions* 2 in that order, states 10 on top, and the legend names *Changes*, *Tasks*, *Sessions* and *Repositories*

#### Scenario: Local days
- **WHEN** the user's time zone is `Europe/Zurich` and an event happened at 23:30 UTC on 6 October, which is 01:30 on 7 October in Zurich
- **THEN** it counts on 7 October

#### Scenario: Per project
- **WHEN** the log keeps 30 events of `demo-ops` touching 4 changes, 12 of `alpha-infra` touching 5 changes, and 2 repository events of `beta-soc`
- **THEN** the per-project panel lists `demo-ops` (30 events, 4 changes), `alpha-infra` (12 events, 5 changes) and `beta-soc` (2 events, 0 changes), in that order, with `demo-ops`'s bar the longest and `beta-soc`'s drawn in the *Repositories* colour alone

#### Scenario: Many projects
- **WHEN** 9 repositories have counted events
- **THEN** the 6 busiest are listed followed by **Show 3 more**, which lists all 9 and offers **Show fewer**

#### Scenario: Narrowing to a project
- **WHEN** the user activates `alpha-infra` in the per-project panel
- **THEN** the feed, the summary tiles, the per-day panel and the **When** panel show `alpha-infra` alone, the URL reflects the filter, its tag appears in the filter bar, and the per-project panel is not shown

#### Scenario: Same name in two projects
- **WHEN** change `add-login` has events in `demo-ops` and in `alpha-infra`
- **THEN** the totals count 2 changes touched

#### Scenario: Collapsing does not change the metrics
- **WHEN** three task progress events of one change within forty minutes are shown as one entry
- **THEN** the per-day and per-project panels count 3 events

#### Scenario: Beyond the loaded page
- **WHEN** the log keeps 350 events and the feed has loaded its first 100 entries
- **THEN** the per-day heading states 350 events

#### Scenario: Filters apply
- **WHEN** the user selects the group *Sessions*
- **THEN** the panels count only session events, only *Sessions* is drawn and named in the legend, in the same colour as without the filter, and a repository without session events is not listed

#### Scenario: Table view
- **WHEN** the user switches the metrics to **Table** and reloads the page
- **THEN** the panels show tables with each day's events per group, total and changes, each day's hours with events, and each repository's events per group, total and changes, and switching back to **Chart** shows the charts again

#### Scenario: Hiding the metrics
- **WHEN** the user hides the metrics and reloads the page
- **THEN** the metrics stay hidden, the summary tiles and the feed are shown as before, and showing them again brings the panels back

#### Scenario: Nothing matches
- **WHEN** no retained event matches the filters
- **THEN** neither the summary tiles nor the metrics are shown, only the empty state

### Requirement: The feed shows when activity happened
The metrics SHALL include a **When** panel: a grid with one row for every day of the per-day panel, oldest at the top, and one column for every hour of the day, `00` to `23`, in the user's local time zone, each cell shaded by the number of counted events whose time falls in that hour of that day. Shading SHALL use a single hue in four steps, from fewer to more events relative to the busiest hour of the window, and an hour without events SHALL be shown unshaded. The rows SHALL be labelled with the days as in the per-day panel, the columns with hours at least every 6 hours, and a legend SHALL explain the shading from fewer to more. Hovering a cell SHALL state its day, its hour and its number of events. The panel's heading SHALL name the busiest hour of the day across the window when there are events. On a day with a daylight-saving change, an hour that does not exist SHALL stay empty and an hour that occurs twice SHALL count both.

The panel SHALL follow the same filters, counting, hiding, table view and theme rules as the per-day panel, and SHALL fit at phone width without horizontal scrolling.

#### Scenario: Afternoon work
- **WHEN** today holds 6 events between 14:00 and 14:59 local time and 1 at 09:10, and no other day holds events
- **THEN** today's row shows the 14:00 cell in the darkest step, the 09:00 cell in the lightest step, every other cell unshaded, and the heading names 14:00 as the busiest hour

#### Scenario: Local hours
- **WHEN** the user's time zone is `Europe/Zurich` and an event happened at 23:30 UTC on 6 October
- **THEN** it counts in the 01:00 cell of 7 October

#### Scenario: Hover
- **WHEN** the user hovers the 14:00 cell of today's row holding 6 events
- **THEN** a tooltip states today, 14:00–15:00 and 6 events

### Requirement: Busy days are collapsed
When a day of the feed has more than 30 loaded entries, the view SHALL show only its newest 20 entries, followed by **Show N more**, where N is the number of that day's loaded entries left out. Activating it SHALL show all of that day's loaded entries and offer **Show fewer**, which collapses the day again. A day's state SHALL be kept when the feed reloads or loads older entries, and SHALL be reset when the filters change. Entries loaded later by **Load older** that belong to a collapsed day SHALL be counted in its N. Each day's heading SHALL stay visible at the top of the view while that day's entries are scrolled, whether the day is collapsed or not. Collapsing a day MUST NOT change paging, **Load older** or the summary strip.

#### Scenario: A busy day
- **WHEN** the loaded feed holds 140 entries for today and 12 for yesterday
- **THEN** today shows its newest 20 entries and **Show 120 more**, then yesterday shows all 12 entries

#### Scenario: Expanding and collapsing
- **WHEN** the user activates **Show 120 more** under today
- **THEN** all 140 of today's entries are shown, followed by **Show fewer**, which returns to the newest 20

#### Scenario: A quiet day
- **WHEN** a day has 30 loaded entries
- **THEN** all 30 are shown and no **Show more** is offered

#### Scenario: A new scan
- **WHEN** the user has expanded today and a scan records new events, so the feed reloads
- **THEN** today stays expanded and shows the new entries at the top
