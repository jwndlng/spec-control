# Proposal

## Why

Every user-visible feature adds its What's new entry to `src/ui/changelog.ts`. That file is one long, append-at-the-top
array, so two change branches that add entries from separate worktrees both modify the same lines. When those changes
are merged or rebased, the entries conflict even though the feature work is otherwise independent. This turns a small
release-note task into shared-file coordination and makes it easy to lose or misorder an entry.

## What Changes

- Store each What's new entry in its own source file, named by its immutable entry id, so separate feature branches
  add separate files.
- Keep one typed `CHANGELOG` export for the UI, assembled from the entry files in date-descending order at build time.
- Validate uniqueness, id/date agreement, valid dates, required text and ordering across the assembled list.
- Update contributor and OpenSpec instructions to add entries as individual files rather than editing a shared list.
- Migrate existing entries without changing their ids, dates, copy or the resulting display order.

## Capabilities

### Modified Capabilities
- `whats-new`: changelog entries are independent source files assembled and validated into the embedded list.

## Impact

- `src/ui/changelog.ts` and new `src/ui/changelog/` entry files — stable list interface and per-entry source.
- `scripts/build-ui.ts` and/or a focused changelog loader — assemble entry sources for browser builds.
- `test/whatsNew.test.ts` — validate the assembled list and independent source entries.
- `openspec/specs/whats-new/spec.md` — define the file-per-entry contract.
- `openspec/config.yaml` and `CONTRIBUTING.md` — point feature work to the new entry workflow.

## Non-goals

- Changing the What's new dialog, entry wording, seen-state behavior, or release notes.
- Automatically writing entries from pull request metadata or changing their release dates.
- Introducing generated or committed files that every feature branch must update in common.
