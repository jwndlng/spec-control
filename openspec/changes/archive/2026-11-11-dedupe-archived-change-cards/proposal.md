## Why
When a change has more than one archive directory, Spec Control shows multiple cards for the same change even though its scanner and cleanup logic treat the newest archive as authoritative.

## What Changes
- Show only the newest archive for a change name on the board.
- Preserve the existing rule that leftovers attach to that newest archive.

## Capabilities
### New Capabilities
- `change-scanner`: archived changes with the same name produce one card for the newest archive.

## Impact
- `src/server/mergeChanges.ts`
- `test/mergeChanges.test.ts`
