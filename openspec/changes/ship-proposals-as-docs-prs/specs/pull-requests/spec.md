## ADDED Requirements

### Requirement: A proposal pull request is linked to its change
The branch `docs/<name>`, where `<name>` is the change name exactly as written, SHALL be one of a change's candidate branches in addition to those named by "A pull request is linked to a change by its head branch", for an active and an archived change alike, and SHALL be the same branch name the dashboard gives a Draft session that ships its proposal. It SHALL be compared exactly like the other candidates — no normalisation, abbreviation or containment — and SHALL take part in the same choice when several pull requests match: an open one first, otherwise the most recently merged, closed or opened, otherwise the higher number; the rule on pull requests that settled before the change was created SHALL apply to it as well. A pull request linked through `docs/<name>` SHALL be marked as the change's **proposal pull request** wherever the link is shown. Like every link, it is derived on display and MUST NOT be stored, logged, or affect a change's column, sub-state, progress, counts or filters.

#### Scenario: Proposal awaiting review
- **WHEN** change `rotate-keys` is `Ready` and an open pull request `#90` has the head branch `docs/rotate-keys`
- **THEN** `#90` is shown as that change's pull request, marked as its proposal pull request

#### Scenario: Implementation opened after the proposal merged
- **WHEN** `#90` from `docs/rotate-keys` is merged and an open pull request `#94` has the head branch `feat/rotate-keys`
- **THEN** `#94` is shown, not marked as a proposal pull request

#### Scenario: Containment is still not a match
- **WHEN** change `rotate` has no pull request of its own and an open pull request has the head branch `docs/rotate-keys`
- **THEN** no pull request is shown for `rotate`
