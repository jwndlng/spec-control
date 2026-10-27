# Tasks

## 1. Prompts

- [x] 1.1 Extend `IMPLEMENT_TAIL` in `src/shared/agentDefaults.ts` to tasks only the user can verify or carry out: do every part possible, leave it `- [~]`, add to its line what exactly the user has to check or do
- [x] 1.2 Extend `VALIDATE_TAIL`: say for each `- [~]` task what to check or do, help with what it can, tick off only what the user confirms as done
- [x] 1.3 Add each preset's current Implement and Validate prompts to its `formerPrompts`; test that verbatim saved prompts upgrade and edited ones stay

## 2. Scan

- [x] 2.1 Add `awaitingTasks?: string[]` to `TaskProgress` in `src/shared/types.ts`
- [x] 2.2 Report the `[~]` tasks' text in the scanner: file order, trimmed, plain text, at most 10 entries of at most 200 characters (ellipsis when shortened), absent when there are none
- [x] 2.3 Scanner tests: text reported in order, bounded list and length, absent without `[~]`, counts unchanged

## 3. Board and detail view

- [~] 3.1 Replace the card's `Validate` badge with the **Needs you** badge (`N need you`), its tooltip and accessible name listing the tasks' text plus `and N more`; activating it opens the detail view on the tasks artifact — you: in `bun run dev` (or the demo's `verify-rate-limit-headers` card), check the badge looks right in light and dark, its tooltip shows one task per line, and clicking it opens the change on its tasks
- [x] 3.2 Meter label and accessible text: `13 + 2 need you / 15 Tasks`, "two need the user"
- [~] 3.3 Tasks view: `N tasks need you` and the list of those tasks above the checklist — you: open that change's tasks and check the note and list read well above the checklist
- [x] 3.4 Tests for the badge, the meter text and the tasks view; demo data in `src/ui/demo/sampleData.ts` carries `awaitingTasks`

## 4. Docs

- [x] 4.1 Update `src/ui/helpContent.tsx`: what `- [~]` means (needs you: check or do), the column texts for `Implementing` and `Done`, and the Needs you badge
- [x] 4.2 Add a What's new entry at the top of `src/ui/changelog.ts` (see "What's new" in CONTRIBUTING.md)
- [ ] 4.3 `bun run check` passes
