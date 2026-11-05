# Tasks

## 1. Shorten built-in Ship instructions

- [x] 1.1 Shorten `DEFAULT_SHIP_PROMPT`, `CONVENTIONAL_COMMITS_SHIP_SENTENCE` and `AUTO_MERGE_DOCS_INSTRUCTION` in `src/shared/types.ts`, preserving the obligations described in design.md; update affected existing prompt assertions and verify the relevant agent tests pass.
- [x] 1.2 Shorten the OpenSpec `recordInstruction()` text in `src/server/frameworks/openspec/index.ts`, retaining all recording constraints; update affected existing assertions and verify branch-record tests pass for implementation and archive sessions and other consumers of the shared instruction.

## 2. Verify the composed result and announce it

- [x] 2.1 Review composed default Ship prompts with and without title convention, branch recording and docs auto-merge; record before/after character counts to confirm a material reduction, verify custom prompts and additional instructions are preserved in order, verify Fast-forward includes the record instruction once, and run `bun run check`.
- [x] 2.2 Add a concise What's new entry at the top of `src/ui/changelog.ts` describing the shorter Ship instructions; verify its ID, date and ordering with `bun test test/whatsNew.test.ts`.
