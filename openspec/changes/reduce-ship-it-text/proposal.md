# Proposal

## Why

The Ship prompt becomes a long block of text when its default instructions and automatic additions are combined. Shorter wording will make the request easier to read and check without changing what the agent is asked to do.

## What Changes

- Shorten the built-in Ship prompt and its Conventional Commits and docs auto-merge additions.
- Shorten the OpenSpec branch-record instruction that Ship includes, preserving every recording constraint.
- Preserve prompt composition, custom profile text, branch recording and the existing review and merge rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a wording-only change; existing requirements remain applicable. Set `skip_specs: true` for this change.

## Impact

- `src/shared/types.ts`: built-in Ship prompt and Ship-specific additions.
- `src/server/frameworks/openspec/index.ts`: shared branch-record instruction; its shorter wording also reaches other prompts that include it.
- Relevant prompt assertions in `test/agents.test.ts`, `test/recordInstruction.test.ts` and other tests that assert the changed text.
- `src/ui/changelog.ts`: a short user-facing entry, as required by this project's task rules.
- No API, dependency or prompt-composition changes. Archive and Draft auto-merge wording is outside scope; custom prompts and additional instructions stay user-controlled.
