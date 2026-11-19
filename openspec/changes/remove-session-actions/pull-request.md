## Problem

The Console hides session controls behind a collapsed “Session actions” disclosure, making available controls easy to miss.

## Intended outcome

Show applicable session controls directly in a labeled Console group while preserving their eligibility, labels, confirmations, and behavior.

## Planned verification

- Update the Console and editor UI assertions to confirm actions render without a disclosure and retain their existing availability.
- Remove disclosure-only styles and add a What's new entry; verify it with `test/whatsNew.test.ts`.
