# Spec Delta

## ADDED Requirements

### Requirement: Board can show only changes with running sessions
The combined and repository boards SHALL offer a keyboard-accessible **Show running** switch, off by default, exposing its checked state. When on, only changes with at least one running session for the same repository and change name SHALL match. Archive sessions SHALL count; exited, failed, main-console, project-console and integration sessions SHALL NOT. A running session SHALL count regardless of its working, waiting or quiet badge.

#### Scenario: Default board
- **WHEN** a board opens without a running-filter parameter
- **THEN** Show running is off and session state does not restrict which changes match the filters

#### Scenario: Working and waiting agents
- **WHEN** Show running is on and three changes have running sessions whose badges are working, waiting and quiet respectively
- **THEN** all three changes match the running filter

#### Scenario: Ended sessions and unrelated activity
- **WHEN** Show running is on and a change has only exited or failed sessions, recent file activity, or a pull request with checks running
- **THEN** that change does not match the running filter

#### Scenario: Archive and in-place sessions
- **WHEN** Show running is on and one archived change has a running archive session and another change has a running in-place session
- **THEN** both match the running filter

#### Scenario: Matching the repository as well as the name
- **WHEN** two repositories have a change named `rotate-keys` and only one has a running session for it
- **THEN** only the change in that repository matches the running filter

#### Scenario: Consoles and integrations
- **WHEN** Show running is on and only the main console, a project console or an integration session is running
- **THEN** none of those sessions makes a change match the running filter

### Requirement: Running filter composes with board presentation
**Show running** SHALL compose with repository, search and archive visibility filters. Existing running-session exceptions to recent activity and **Hide merged** SHALL still apply. Counts and archive bounds SHALL use matching cards under their existing rules; lifecycle stages and the unfiltered **To archive** total SHALL remain unchanged. With no matches the board SHALL show its empty filtered result and retain the controls to clear filters.

#### Scenario: Search and repository restrictions still apply
- **WHEN** Show running is on and a running change is excluded by search or repository selection
- **THEN** that change is hidden

#### Scenario: Old merged archive with a live session
- **WHEN** Show running and Hide merged are on, the recent-activity threshold is 7 days, and a merged archive last active 30 days ago has a running archive session
- **THEN** it remains visible and counted when Archived is shown, and is hidden if Hide archived is enabled

#### Scenario: Counts follow existing rules
- **WHEN** Show running excludes some cards
- **THEN** column counts, the filter bar's shown-card count and the Open figure reflect the matching cards under existing archive bounds, while To archive still counts all complete changes

#### Scenario: No matching changes
- **WHEN** Show running is on and no change has a running session
- **THEN** the board shows no matching cards and Clear filters remains available

### Requirement: Running filter persists and follows session updates
The running filter SHALL apply instantly on the client, persist as `running=1` in the board URL, and be off for an absent or other value. Turning it off SHALL omit that parameter. **Clear filters** SHALL reset it while preserving the board layout. Membership SHALL update from the existing session list without extra fetching, repository writes or terminal-output interpretation.

#### Scenario: Reload and return from a change
- **WHEN** Show running is enabled and the user reloads, or opens a change then returns using its board return link
- **THEN** the board retains the running filter and its other URL filters on both combined and repository boards

#### Scenario: Clearing the filter
- **WHEN** the user turns Show running off or uses Clear filters
- **THEN** the running parameter is removed; Clear filters also restores the other filter defaults and retains the layout choice

#### Scenario: Session starts, ends and resumes
- **WHEN** Show running is on and the board receives a session-list update showing a change's first running session, its last running session ending, or an ended session resuming
- **THEN** that change respectively enters, leaves or re-enters the matching set without a page reload

#### Scenario: More than one session
- **WHEN** a change has two running sessions and one ends
- **THEN** the change continues to match until its last running session ends

#### Scenario: No sessions available
- **WHEN** Show running is on and the existing session list is empty, including when agent sessions are disabled
- **THEN** the board shows no matches and the user can turn the filter off

#### Scenario: Invalid URL value
- **WHEN** the board opens with `running=0` or `running=anything`
- **THEN** Show running is off
