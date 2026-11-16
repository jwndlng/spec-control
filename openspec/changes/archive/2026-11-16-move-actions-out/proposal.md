# Proposal

## Why

Important actions in a change's Console tab are hidden inside a collapsed “More actions” section, so users can miss controls they need. Keep the actions organized while making the available controls visible without an extra click.

## What Changes

- Show the Console tab's action groups by default instead of hiding them behind “More actions.”
- Preserve the existing action grouping, labels, availability, and behavior.
- Keep Ship in its existing prominent position.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: Make available Console actions visible while retaining their organization.

## Impact

- Change Console tab presentation in `src/ui/sessionPanel.tsx` and `src/ui/styles.css`.
- Update the `change-detail` behavior specification. No API or dependency changes.
