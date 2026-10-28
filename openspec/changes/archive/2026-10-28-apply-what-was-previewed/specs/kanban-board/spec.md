## ADDED Requirements

### Requirement: An older snapshot never replaces a newer one
Whatever fetched it — the initial load, the poll interval, the Refresh button, auto-refresh or a refresh after an
action — the dashboard SHALL replace the snapshot it shows only with one whose `generatedAt` is the same as or later
than the shown one's. A snapshot that answers late with an earlier `generatedAt` SHALL be discarded, so the board, its
counts, the header's age and every view that reads the snapshot never step back to an earlier scan. Discarding it SHALL
NOT be reported as an error, and SHALL NOT stop polling or auto-refresh.

#### Scenario: A slow poll after Refresh
- **WHEN** a poll's `GET /api/state` is still outstanding when the user presses Refresh, the refresh shows the snapshot of its new scan, and the poll then answers with the snapshot from before that scan
- **THEN** the board keeps showing the refreshed snapshot and the header's `updated` age is not reset to the older one

#### Scenario: Same snapshot again
- **WHEN** a poll answers with a snapshot whose `generatedAt` equals the one shown
- **THEN** it is taken, exactly as today
