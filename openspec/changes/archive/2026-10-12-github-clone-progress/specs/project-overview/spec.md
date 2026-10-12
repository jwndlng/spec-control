# Spec Delta

## MODIFIED Requirements

### Requirement: The overview lists unmanaged projects in one list
Below the managed projects the projects overview SHALL show a section under the headline **Unmanaged projects** with the number of projects it lists. It SHALL list, in one list ordered by name, then path, whatever kind each entry is: repositories in the configuration with `enabled: false`, repositories the latest discovery run reported as candidates, repositories the latest discovery run reported as integratable, and the clones of the `github-repositories` capability that are queued, running, failed or cancelled since the dashboard started. Each entry SHALL show the repository's name, a label saying in words what it is — `disabled`, `OpenSpec` (a candidate), `no OpenSpec` (integratable), `queued`, `Cloning…`, `clone failed` or `clone cancelled` — with a tooltip explaining it, for a clone its `owner/name`, while it runs its progress bar with phase, percentage and elapsed time, and when it failed its reason, its path, the same-name path hint when its name collides with any other repository listed anywhere on the overview, and, for a candidate that shares its `origin` remote with other known repositories, a badge naming them whose tooltip lists their paths. The section SHALL NOT be split into groups or sub-headings. It SHALL be laid out the same in the `Table` and `Tiles` layouts. The overview's search SHALL filter the section by the same rule as the managed projects, and the Work in progress filter SHALL hide the whole section. The section MUST NOT show counts, work in progress or pull requests for its entries, and it MUST NOT offer any action on a checkout; a failed or cancelled clone offers only retrying it and dismissing its entry, and a queued or running clone offers only Cancel.

#### Scenario: One list
- **WHEN** `demo-agent` is configured and disabled, discovery reports the candidate `beta-soc` and the integratable repository `chat-groups`
- **THEN** the headline reads `Unmanaged projects · 3` and one list shows `beta-soc` labelled `OpenSpec`, `chat-groups` labelled `no OpenSpec` and `demo-agent` labelled `disabled`, in that order, with no sub-headings

#### Scenario: Search covers the section
- **WHEN** the user searches `beta` with `beta-soc` managed and `beta-tools` discovered
- **THEN** the managed projects show `beta-soc` and the unmanaged projects show only `beta-tools`

#### Scenario: Work in progress filter
- **WHEN** the user turns the Work in progress filter on
- **THEN** the Unmanaged projects section is not shown

#### Scenario: Second clone flagged
- **WHEN** `pkg-tools` is managed and the candidate `ops/repo-mirror/repos/pkg-tools` has the same `origin`
- **THEN** the candidate shows the path hint `ops/repo-mirror/repos` and a badge naming `pkg-tools`, and can still be enabled

#### Scenario: A running and a failed clone
- **WHEN** a clone of `acme/beta-soc` into `/w/acme` is running and one of `acme/missing-repo` failed
- **THEN** the section lists `beta-soc` labelled `Cloning…` with `acme/beta-soc`, its path, its progress bar and **Cancel**, and `missing-repo` labelled `clone failed` with its reason, **Retry** and **Dismiss**

#### Scenario: A cancelled clone
- **WHEN** the user cancels the clone of `acme/beta-soc` from its entry
- **THEN** the entry is labelled `clone cancelled` and offers **Retry** and **Dismiss**, and `/w/acme/beta-soc` is gone
