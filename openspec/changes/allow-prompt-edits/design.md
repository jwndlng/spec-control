# Design

## Context

Change creation writes an optional `prompt.md` with a generated heading. The scanner includes a bounded copy in the dashboard snapshot, and the detail view displays its body through the Prompt tab. Detail already reads artifacts from the scanner's leading checkout. The OpenSpec module resolves the output paths for the change's schema, including custom schemas and globs. It also marks skipped specs as done for workflow purposes.

## Goals / Non-Goals

**Goals**

- Keep the prompt file as the source of truth and use the same form for adding and editing its body.
- Enforce the artifact cutoff on the server and protect newer prompt contents from stale editors.

**Non-Goals**

- Prompt deletion, cross-checkout synchronization, and changes to agent starter prompts.

## Decisions

1. **Define the cutoff by files the schema produces.** Resolve live output paths through the framework module and check for actual files. Workflow status can report done for skipped specs, and board columns depend on several signals, so neither answers whether the first output exists. Reuse the scanner's active-copy and archive rules when checking the main checkout and linked worktrees. Use a fresh read of the relevant copies on Save, including worktrees added since the last snapshot. An unresolved schema or an unreadable relevant checkout makes eligibility uncertain and prevents a write.
2. **Save to the checkout the user opened.** Resolve the target using the same server-owned checkout selection as artifact detail. The edit-state read returns the full bounded prompt body and an opaque version derived from the checkout, change identity and exact current file contents or absence. A client path would let the request select where to write, and the snapshot alone may be truncated or stale. Reuse the existing prompt byte limit for the formatted file. Sharing prompt formatting with creation keeps the generated heading consistent and lets the editor preserve headings inside the user's body.
3. **Use a dedicated same-origin writer.** Follow the path and file replacement safeguards used by task confirmation within the existing framework write allowlist. Serialize edits for the same change and coordinate with its session setup so the normal worktree copy cannot overlap a save. Verify the checkout, reject symlinks along the destination path, and recheck eligibility and the full file version at publication. Use an exclusive temporary file in the same directory, clean it up on failure, and use atomic replacement for an existing prompt and exclusive publication for a missing one. A direct write could leave a partial prompt or overwrite a prompt created by someone else. The framework supplies the file location and artifact evidence, and the server performs the write.
4. **Keep the edit within the Prompt tab.** Use the existing detail route and refresh cadence. A successful Save refreshes the saved body from the repository. Polling can update eligibility while the editor is open, while typed text stays available if Save is refused. Provide equivalent in-memory behavior in the demo so the interaction can be exercised there.

## Risks / Trade-offs

- An agent or external editor can create artifacts independently of dashboard locks. Keep the final eligibility and version checks close to publication and cover the case where an artifact appears while an editor is open.
- Multiple worktrees can hold different versions of a change. Bind the save to the displayed checkout and reject stale eligibility when another active copy has advanced. Update exactly one copy so the operation has a predictable filesystem effect.
- A new session receives the saved prompt when setup copies the change directory from the displayed checkout. A session checkout where the change directory already exists reads its own copy under the existing setup rules.
- Large or unsafe prompt files are ineligible for editing. Explain the refusal and keep the existing bounded display behavior.

## Migration Plan

Existing prompt files work in place. Deployment and rollback need no data migration.
