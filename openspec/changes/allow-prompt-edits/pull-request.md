## Problem

A change's prompt can be entered at creation or import, but the dashboard only displays it afterward. Users need to revise those instructions, or add them to an empty scaffold, before drafting begins.

## Intended outcome

The Prompt tab will let users add or revise instructions until the first schema-defined artifact exists, including in a linked worktree. Saved prompts will remain readable after that point. Save will verify the current checkout and prompt version, then update only that checkout's `prompt.md`.

## Planned verification

- Cover first save, edit, cancel, deep links, and read-only behavior in the detail UI and demo.
- Test stale saves, artifacts appearing after the editor opens, skipped specs, custom artifact paths, and filesystem safeguards. Compare Git state and neighboring files before and after Save.
- Run `bun run check` and smoke-test the create, edit, and draft flow in the compiled dashboard.
