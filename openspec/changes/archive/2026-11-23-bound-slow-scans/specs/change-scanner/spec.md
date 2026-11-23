## ADDED Requirements

### Requirement: Concurrent archive inspection keeps stale-leftover reports ordered

The scanner SHALL check archives for stale leftovers with at most three concurrent archive inspections per repository. It SHALL report the results in the original archive enumeration order.

#### Scenario: A later archive is checked first

- **WHEN** a later archive's stale-leftover inspection finishes before an earlier one's
- **THEN** the report retains the original archive enumeration order and the same per-archive cleanup evidence
