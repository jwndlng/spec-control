## ADDED Requirements

### Requirement: The feed shows the answer to its latest request
The feed SHALL show only the answer to the most recent request it made for the filters in force. When the filters change
or a new snapshot makes the feed reload while an earlier request is still outstanding, the earlier answer SHALL be
discarded when it arrives — its entries, summary, metrics, next page and newest entry alike — whichever request answers
first. **Load older** SHALL append its page only to the list it was requested for: an older page that arrives after the
filters changed or the feed reloaded SHALL be discarded and SHALL NOT change how many entries a later reload asks for.
Only the newest entry of an answer the feed shows SHALL be reported as seen to the navigation's unseen count. A
discarded answer's error SHALL NOT be shown either.

#### Scenario: A slow answer for the old filter
- **WHEN** the user selects repository `demo-ops`, and the request for all repositories made just before answers after the one for `demo-ops`
- **THEN** the feed shows only `demo-ops`'s entries, its summary and metrics are `demo-ops`'s, and the late answer changes nothing

#### Scenario: Load older across a filter change
- **WHEN** the user presses **Load older** and switches the group to *Sessions* before that page arrives
- **THEN** the arriving page is not appended to the *Sessions* list

#### Scenario: Seen follows the shown answer
- **WHEN** a discarded answer names a newer entry than the answer the feed shows
- **THEN** the unseen count's baseline is the shown answer's newest entry, not the discarded one's
