## ADDED Requirements

### Requirement: The watch is limited per repository by the server

The server SHALL remember, in memory, when the last pull-request query of each GitHub repository settled, whether it succeeded or failed. A refresh made by a board's pull-request watch SHALL NOT query a GitHub repository whose last query settled less than 60 seconds ago, even though the watch ignores the freshness window; that repository's cached list SHALL be answered instead. This SHALL hold across every tab and window, so that any number of open boards together start at most one watch query per GitHub repository per minute. A refresh the user started — activating Refresh, or opening a view that shows pull requests with a stale cache — SHALL NOT be limited by this rule.

#### Scenario: Three tabs on the same board
- **WHEN** three visible tabs show the board of `alpha-infra`, which links an open pull request whose checks are running
- **THEN** `alpha-infra`'s pull requests are queried at most once a minute, not once a minute per tab

#### Scenario: The user's Refresh is not held back
- **WHEN** a watch refresh of `alpha-infra` settled ten seconds ago and the user activates Refresh in the Pull requests view
- **THEN** `alpha-infra`'s pull requests are queried

### Requirement: The pull-request cache is written one at a time

Writes of the pull-request cache in the dashboard home SHALL happen one at a time, each written from the in-memory lists as they are when it starts and replacing the file by renaming a complete temporary file, so that concurrent refreshes of different repositories can neither tear the file nor drop each other's lists.

#### Scenario: Two refreshes finish together
- **WHEN** refreshes of `alpha-infra` and `demo-ops` finish at the same moment and the dashboard is restarted
- **THEN** the cached lists of both repositories are shown
