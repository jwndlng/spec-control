# Design

## Context

Task progress, the board column and the stale checks all read files a framework defines. The scanner gets task
progress from `SpecFramework.parseTasks`, whose default is `parseTaskProgress` in `src/server/tasksParser.ts`.
Stale-change detection (`src/server/staleChanges.ts`) gets a `ChangesLayout` and reads metadata straight from git
objects with `cat-file --batch`, parsing it itself. The OpenSpec module already parses the same file from a checkout
(`parseMarker` in `frameworks/openspec/marker.ts`).

## Decisions

### D1. Copy the CLI's pattern, prove it with a parity test

`TASK_LINE` becomes the CLI's `TASK_LINE_PATTERN` (`@fission-ai/openspec` 1.13.1, `dist/utils/task-progress.js`):

```
/^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])/
```

The captured marker decides the state: `x`/`X` done, `~` awaiting, anything else (including an empty capture from a
whitespace-only box) open. `[~]` is already a character the CLI's class accepts and counts as not done, so the
addition never changes whether a line counts.

Rejected: calling the library's `parseTaskLines` through the adapter. It returns only `done: boolean`, so `[~]` would
need a second pass with our own pattern anyway, and two patterns are exactly what drifted. Rejected: keeping our
pattern and adding a link guard only — the no-space and nine-digit differences would remain.

The copy can drift when the library is upgraded, so a test does the comparing: the adapter re-exports
`countTasksFromContent`, and `test/parsers.test.ts` runs both over a corpus (link bullets, reference bullets,
`-[x]`, `- [ ](x)`, `- []`, `1)`, ten-digit ordered markers, CRLF, nested, fenced) and requires the dashboard's `done`
to equal the CLI's `completed` and its `total` to equal the CLI's `total` for every file without `[~]`. The re-export
is used by the test only; importing it does not call `resolveSchema`, so invariant 3's binary concern does not arise.

### D2. One metadata reader, owned by the module

`SpecFramework` gains an optional `changeMetadata?: { file: string; parse(text: string): { created?: string; recorded?:
ChangeRecord } }`. The OpenSpec module returns `{ file: ".openspec.yaml", parse: parseMarker }` (dropping warnings).
The scanner passes it, beside the layout, to `strandedArchives`, `staleLeftovers` and `duplicates`;
`staleChanges.ts` builds `<dir>/<file>` paths, fetches them with the `cat-file --batch` it already runs, and calls
`parse`. Without `changeMetadata` it fetches nothing and treats created dates as unreadable and recorded branches as
none — what it already does for a missing file.

`parseRecordedBranches` and `createdDate` are removed. They differ from `parseMarker`: they accept tab-indented
entries and check names with `isBranchName` instead of `validRecordedBranch`. The module's reading wins, so a file means
the same on a git ref as in the checkout the board shows. The test that exercised `parseRecordedBranches` moves to the
marker tests; every other stale test keeps its expectations.

Rejected: putting the file name into `ChangesLayout`. The layout is paths only; parsing is behaviour, and the parser
would still have to come from the module.

### D3. Label detection takes the module's skip list

`scanLabels(source, root, skip)` skips `node_modules`, `vendor`, `dist`, `build`, `target` and the framework's
`layout.skipDirs` (OpenSpec: `["openspec"]`). Same result for every OpenSpec repository.

### D4. The column rule is a spec fix only

`deriveStage` already counts `done + awaiting`. Only the `kanban-board` requirement text changes, copied in full from
the current main spec (which has `apply.requires`) so archiving after `add-validate-phase` keeps both rules.

## Risks

- A tasks file with link bullets now shows fewer tasks. That is the point: the CLI never counted them, and a done link
  bullet could push a card into `Done` early. Noted in What's new.
