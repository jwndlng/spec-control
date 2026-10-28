# Tasks

## 1. Task counting

- [x] 1.1 Replace `TASK_LINE` in `src/server/tasksParser.ts` with the CLI's pattern (design D1), keeping `[x]`/`[X]` done, `[~]` awaiting, everything else open; verify with `test/parsers.test.ts` cases for the change-scanner scenarios "Link bullets are not tasks", "No space after the list marker", "A whitespace-only box followed by a link" and the existing ones
- [x] 1.2 Re-export `countTasksFromContent` from `src/server/frameworks/openspec/adapter.ts` and add the parity test over the corpus in design D1; verify with `test/parsers.test.ts` ("Counts agree with the CLI")
- [x] 1.3 Add `deriveStage` cases for `done: 13, awaiting: 2, total: 15`, `done: 0, awaiting: 1, total: 4` and `done: 0, awaiting: 3, total: 3`; verify with `test/parsers.test.ts`

## 2. Framework specifics in the module

- [x] 2.1 Add `changeMetadata` to `SpecFramework` and answer it in the OpenSpec module with `.openspec.yaml` and `parseMarker` (design D2); verify with a marker test that moves the former `parseRecordedBranches` cases, plus the tab-indented case of "One reading for a file the two parsers read differently"
- [x] 2.2 Pass the reader from `scanRepo` through `src/server/source.ts` to `findStrandedArchives`, `staleLeftovers` and `findDuplicates`; remove `createdDate`, `parseRecordedBranches` and every `.openspec.yaml` literal from `src/server/staleChanges.ts`; verify with `test/staleChanges.test.ts` unchanged apart from passing the reader, and a case with no reader that runs no metadata `cat-file`
- [x] 2.3 Let `scanLabels` take the framework's `layout.skipDirs` instead of the literal `openspec` (design D3); verify with `test/scanner.test.ts` for "The framework's own tree is skipped"
- [x] 2.4 Add a static test that `src/server/staleChanges.ts` and `scanLabels` name neither `.openspec.yaml` nor `"openspec"`; verify with that test

## 3. Wrap-up

- [x] 3.1 Add a What's new entry to `src/ui/changelog.ts` (link bullets no longer count as tasks); verify with `bun run check`
- [x] 3.2 Run `bun run check` and `bun run build`, and confirm the compiled binary shows the same task counts as `openspec status` for a fixture change with link bullets; verify by running both
