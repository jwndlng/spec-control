## ADDED Requirements

### Requirement: A configuration save cannot undo a write it did not see

Every response whose body is the saved configuration — `GET /api/config`, `PUT /api/config` and every other endpoint that answers with the saved config — SHALL carry the configuration's revision in an `ETag` header. The revision SHALL be derived from the saved content, so equal configurations have the same revision and any change gives a new one. `PUT /api/config` with an `If-Match` header SHALL be applied only when it names the revision of the configuration as the previous write left it, compared within the same one-at-a-time order as every other configuration write; otherwise it SHALL be refused with `412`, a JSON body holding an `error` message and the current configuration, and the current `ETag`, and nothing SHALL be written, no scan triggered and no schedule changed. `PUT /api/config` without `If-Match` SHALL be applied as before. The dashboard's own UI SHALL always send `If-Match`.

#### Scenario: Label colour chosen while Settings was open
- **WHEN** Settings received the configuration with revision `r1`, a label colour is then chosen in a project's labels dialog, and Settings sends `PUT /api/config` with `If-Match: r1`
- **THEN** the response is `412` with the current configuration, and the saved configuration still holds the label colour

#### Scenario: Clone tracked while Settings was open
- **WHEN** Settings received revision `r1`, a GitHub clone holding the project marker is then tracked as `demo-ops`, and Settings sends `PUT /api/config` with `If-Match: r1` and a configuration without `demo-ops`
- **THEN** the response is `412` and `demo-ops` stays tracked

#### Scenario: Up-to-date save
- **WHEN** `PUT /api/config` is sent with `If-Match` naming the current revision
- **THEN** the configuration is saved and the response carries the new revision as `ETag`

#### Scenario: Command-line client
- **WHEN** `curl -X PUT -H 'content-type: application/json'` sends a valid configuration without `If-Match`
- **THEN** it is saved as before
