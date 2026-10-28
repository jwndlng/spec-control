# Proposal

## Why

Three places disagree with what they claim to follow:

- **Task counting is not the CLI's.** `TASK_LINE` in `src/server/tasksParser.ts` says it "mirrors what `openspec`
  counts", but it does not. It accepts any bracketed single character, so a Markdown link bullet counts as a task:
  `- [x](notes.md)` as a done one, `- [A](./design.md)` as an open one. And it requires whitespace between the list
  marker and the bracket, so `-[ ] b` is not counted at all. The `openspec` CLI (1.13.1,
  `dist/utils/task-progress.js`, `TASK_LINE_PATTERN`) rejects a single-character box whose `]` is followed by `(` or
  `[`, still counts a whitespace-only box wherever it is followed, allows no whitespace between marker and bracket, and
  limits ordered markers to nine digits. For
  `- [x] a`, `- [ ] b`, `- [a](./a.md)`, `- [x](x.md)`, `- [1](#ref) footnote` the board shows `2/5` where
  `openspec archive` and `openspec status` count `1/2`: a card can read further along — or even `Done` — while the CLI
  still reports open work, or the other way round.
- **The column rule in `kanban-board` contradicts the board.** "Board columns follow the lifecycle phases" says `Done`
  when `tasks.done == tasks.total` and `Implementing` when `tasks.done > 0`. `deriveStage` (`src/shared/columns.ts`)
  counts a `[~]` task as settled for both, and the same spec's sub-state scenarios rely on that — a change with
  `done: 13, awaiting: 2, total: 15` is in `Done` with **Validate**, which the requirement text forbids.
  `add-validate-phase` carries the corrected rule, but on a baseline from before `apply.requires`, so archiving it
  alone would also drop the required-artifact rule.
- **Framework specifics outside the module.** Invariant 3 keeps every framework detail in its module, yet
  `src/server/staleChanges.ts` names `.openspec.yaml` four times and parses it with its own `createdDate` and
  `parseRecordedBranches`, which read the file differently from the module's own `marker.ts` (a tab-indented entry, a
  different branch-name check). And `LABEL_SKIP_DIRS` in `src/server/scanner.ts` hard-codes `openspec`, which is
  exactly the module's `layout.skipDirs`.

## What Changes

- **Task lines are recognised by the CLI's pattern**, plus `[~]` as the awaiting state: the one addition changes which
  state a counted line is in, never whether it counts. A parity test runs the dashboard's counting and the CLI's
  `countTasksFromContent` over the same corpus and requires equal done and total for every file without `[~]`.
- **The `kanban-board` column rule says what the board does**: `Done` when every task is settled (done or awaiting),
  `Implementing` when at least one is, with the `validate`/`complete` sub-state. No code changes for this.
- **The module supplies change metadata read from a git ref**: `SpecFramework` gains the metadata file name (relative
  to a change directory) and a parser returning its created date and recorded branches; the OpenSpec module answers with
  `.openspec.yaml` and `parseMarker`. Stale-change detection fetches the text with the `cat-file --batch` it already
  runs and hands it to the module. Its own parsers are removed.
- **Label detection skips the module's own directories** (`layout.skipDirs`) instead of a literal `openspec`.

## Non-goals

- Changing what `[~]` means, or teaching the CLI about it.
- Skipping checkboxes inside code fences: the CLI counts them, so the dashboard does too.
- Any new git command, write, network access or column. For OpenSpec repositories every stale, duplicate and label
  result stays what it is, except a metadata file the two former parsers read differently, which now means the same on
  a git ref as in a checkout.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `change-scanner`: "Task progress is derived from tasks.md" — the CLI's line pattern, with link-bullet, no-space and
  whitespace-box scenarios and the parity rule.
- `kanban-board`: "Board columns follow the lifecycle phases" — settled tasks decide `Done` and `Implementing`.
- `spec-frameworks`: framework file names and formats stay in the module (change metadata on a git ref, label skip).
- `project-labels`: "Technology labels are detected from marker files" — the skipped framework directory comes from
  the module.

## Order and overlaps

- `add-validate-phase` (in flight, implemented, not archived) modifies the same two requirements, "Task progress is
  derived from tasks.md" and "Board columns follow the lifecycle phases", and owns `src/server/tasksParser.ts` and
  `src/shared/columns.ts`. Its board text predates `apply.requires`. Archive it **before** this change: this change's
  copy starts from the current main spec, so archiving it second restores the required-artifact rule and keeps the
  settled rule.
- `manual-tasks-need-you` (in flight) rewords "Task progress is derived from tasks.md" (`[~]` as "needs the user") and
  touches the task-counting module. Whichever of the two is archived second carries the other's wording into its copy
  first.
- No other in-flight change touches `src/server/staleChanges.ts`, `src/server/frameworks/` or `scanLabels`.

## Impact

- `src/server/tasksParser.ts` — `TASK_LINE` becomes the CLI's pattern; `[~]` still counted as awaiting.
- `src/server/frameworks/openspec/adapter.ts` — re-exports the library's `countTasksFromContent`, for the parity test
  only (invariant 3: library internals only through the adapter).
- `src/server/frameworks/framework.ts` — the change-metadata file name and parser on `SpecFramework`.
- `src/server/frameworks/openspec/index.ts`, `src/server/frameworks/openspec/marker.ts` — the OpenSpec answers
  (`.openspec.yaml`, `parseMarker`).
- `src/server/staleChanges.ts` — takes the module's metadata reader; `createdDate`, `parseRecordedBranches` and every
  `.openspec.yaml` literal removed.
- `src/server/source.ts` and the git source behind `strandedArchives`, `staleLeftovers`, `duplicates` — pass the
  reader through; `src/server/scanner.ts` — passes the framework's reader and `layout.skipDirs` to `scanLabels`.
- Tests: `test/parsers.test.ts` (patterns and the CLI parity corpus), `test/staleChanges.test.ts` (parser tests move
  to the module; stale, duplicate and leftover results unchanged), `test/scanner.test.ts` (`scanLabels` with the
  module's skip list), and `deriveStage` cases in `test/parsers.test.ts` (the three settled scenarios).
- `src/ui/changelog.ts` — What's new: link bullets no longer count as tasks.
- No change to `CLAUDE.md`: invariant 3 already says this.
