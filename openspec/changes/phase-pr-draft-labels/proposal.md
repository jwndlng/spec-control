# Proposal

## Why

The timeline can show one proposal pull request in both Drafts and Implementation when its recorded branch is `docs/<change>`. Its artifact labels also wrap in the narrow Drafts checkpoint, making progress harder to scan.

## What Changes

- Keep proposal and implementation PR matching phase-specific, even when `.openspec.yaml` records a proposal branch in the generic branch field.
- Keep Drafts artifact milestone labels on one line while retaining their full accessible names.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-detail`: keep phase PR links distinct and artifact milestone labels readable.

## Impact

- `src/shared/pullRequestLink.ts` phase-specific branch matching.
- `src/ui/styles.css` Drafts milestone label wrapping.
- `test/pullRequestLink.test.ts` and `test/lifecycleTimeline.test.ts` regression coverage.
