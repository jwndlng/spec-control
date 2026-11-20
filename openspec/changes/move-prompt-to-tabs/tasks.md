# Tasks

## 1. Prompt tab and rendering

- [x] 1.1 Add a reserved Prompt tab before schema artifact tabs when `promptBody` is non-empty, remove prompt text from `ChangeFacts`, and render the body as wrapped plain text in the shared content panel; verify prompt, heading-only, and absent-prompt states in `test/changeDetail.test.ts`.
- [x] 1.2 Extend detail selection and URL handling for the Prompt tab, including prompt deep links, back/forward navigation, and fallback when the prompt is absent; verify selection resolution and navigation behavior in `test/changeDetail.test.ts`.
- [x] 1.3 Verify prompt selection and content follow the existing refresh rules without resetting scroll when content is unchanged; add or update focused refresh coverage in `test/changeDetail.test.ts`.

## 2. User-facing release note

- [x] 2.1 Add an independent What's new JSON entry under `src/ui/changelog/entries/` describing the Prompt tab; verify its schema and date/title/summary against neighboring entries and the changelog tests.
