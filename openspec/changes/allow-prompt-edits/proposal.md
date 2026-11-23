# Proposal

## Why

The dashboard accepts a prompt when creating or importing a change, then displays it as read-only. Users need to correct or add instructions from the change detail before the first planning artifact is written.

## What Changes

- Let users add or edit the prompt in the change detail while the active change has no generated artifacts. Keep the prompt readable after drafting begins and on archived changes.
- Use the change's schema to identify generated artifacts. Scaffold metadata, dependencies, issue links, the prompt itself, and skipped artifact statuses do not count.
- Recheck eligibility and the prompt's current contents on Save. Limit the write to the displayed change copy's `prompt.md` and refresh the dashboard after success.

## Capabilities

### New Capabilities

### Modified Capabilities

- `change-detail` gains an editable Prompt tab before the first artifact exists.
- `dashboard-api` gains a same-origin save operation and a narrowly scoped repository-write exception for prompt edits.

## Impact

- Prompt tab, selection, editor, and feedback in `src/ui/changeDetail.tsx` and its related components and styles, plus HTTP and demo API adapters and types.
- Change routing, live framework artifact resolution, checkout selection, and a bounded prompt writer in `src/server/`. The mutation leaves Git and the OpenSpec CLI out of the write path.
- Focused filesystem, API, detail UI, demo, and worktree regressions under `test/`, plus the built-in Help, `CLAUDE.md` write-invariant guidance, and a What's new entry.
