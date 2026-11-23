# Proposal

## Why

Unexpected blank bands in the **Clean up leftovers** dialog interrupt the preview and make the warnings and confirmation controls harder to scan.

## What Changes

- Make the standalone dialog use consistent spacing between visible sections and keep related item details together.
- Keep the cleanup preview, warnings, acknowledgement and results readable as sections appear or disappear, including at narrow widths.

## Capabilities

### New Capabilities

### Modified Capabilities

- `stale-changes` adds a layout expectation for the standalone cleanup preview and outcome.

## Impact

- `src/ui/staleCleanup.tsx` and the stale cleanup rules in `src/ui/styles.css`. The stylesheet also has lifecycle and console changes in flight, so layout edits belong with the stale cleanup selectors.
- An independent What's new entry under `src/ui/changelog/entries/`.
- The delta is confined to the dialog layout. Existing cleanup eligibility, confirmation, backups and result handling govern the flow.
