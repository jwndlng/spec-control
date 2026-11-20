# Design

## Context

See proposal.md for the motivation and specs/change-detail/spec.md for the user-visible contract. `ChangeFacts` currently renders the prompt body in the header. `ArtifactTabs` derives tabs from schema artifacts and optionally appends Console; artifact selection is serialized through the detail route's `artifact` query parameter. Prompt text is already included in the snapshot, and `promptBody` removes the generated heading.

## Goals / Non-Goals

**Goals:**

- Make the prompt a first-class selection in the existing detail tab strip without treating it as a schema artifact.
- Keep prompt text plain, bounded to the panel, and navigable through the existing URL and refresh model.
- Preserve artifact status labels, Console ordering, and existing artifact/file selection behavior.

**Non-Goals:**

- Change prompt storage, scanning, API payloads, or prompt editing.
- Render prompt Markdown or add actions to the prompt panel.

## Decisions

1. **Represent Prompt as a reserved detail selection.** Add a stable reserved tab id (for example, `prompt`) alongside `CONSOLE_TAB`. Extend selection resolution with prompt availability so `?artifact=prompt` selects the tab only when non-empty prompt body exists; stale prompt links fall back to the normal first available artifact. This keeps URL behavior consistent without adding prompt to schema-derived artifacts or their progress counts. A local-only component state was considered, but would make deep links, back/forward navigation, and refresh retention inconsistent with other tabs.

2. **Insert Prompt before schema artifacts.** Add it at the start of the existing tab strip, followed by schema artifacts and then Console. Prompt has no artifact state badge and stays enabled whenever its body exists. A missing or heading-only prompt adds no tab. This gives it a stable position and keeps the existing Console-last convention.

3. **Render in the shared content panel as plain text.** Remove the prompt note from `ChangeFacts`; when the reserved selection is active, render the normalized prompt body in the content panel with preserved line breaks and wrapping. Do not pass it through Markdown rendering. The panel's existing scroll behavior handles long prompts.

4. **Keep selection in the existing artifact query field.** The route already owns tab selection and refresh re-reads content while preserving the selected artifact when content is unchanged. Reusing this query mechanism avoids a separate URL contract. Tests should cover prompt selection, stale links when the prompt is absent, query navigation, and prompt content updates on refresh.

## Risks / Trade-offs

- [Reserved id collides with a future schema artifact] → Use one exported constant and ensure selection resolution gives the special tab precedence only when prompt content exists; document the reserved id in code.
- [A user may not notice prompt content after it leaves the header] → Give the tab a clear `Prompt` label and ensure it appears before artifact tabs whenever prompt content is available.

## Migration Plan

No data migration is needed. Existing detail URLs continue to resolve; URLs without a selected tab retain their current default. A `?artifact=prompt` URL is accepted only when prompt content is present.

## Open Questions

None.
