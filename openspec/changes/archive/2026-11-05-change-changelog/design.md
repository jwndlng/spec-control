# Design

## Context

The UI imports `CHANGELOG` from `src/ui/changelog.ts`; `scripts/build-ui.ts` bundles the same UI for development,
the compiled binary and the demo. `test/whatsNew.test.ts` imports that export and checks the entries' shape and order.
Today the source of every entry is a single array, and the repository guidance explicitly tells each feature change to
edit the top of that array. Concurrent changes therefore contend for one file.

The changelog is curated product copy, not release metadata. Entry ids are persisted in browser storage, so existing
ids and dates cannot be regenerated or casually changed.

## Goals and non-goals

**Goals**

- Each feature branch can add its own entry without editing a shared changelog list.
- All three UI distributions use the same assembled entries and order.
- Existing entry data and user-seen ids remain unchanged.
- Invalid or duplicate entries still fail validation with a useful id-specific error.

**Non-goals**

- Changing display, storage, release-note links, or the wording/date of existing entries.
- Generating entries from commits or GitHub.

## Decisions

### D1. One source file per entry

Use `src/ui/changelog/entries/<id>.ts` (or the repository-consistent equivalent) with one typed entry object per file.
The filename is the entry id. A feature adds its file and does not edit an index, manifest, generated artifact, or the
existing feature entries. This makes independent worktree additions naturally mergeable. The stable `CHANGELOG`
export remains available to the UI and existing state helpers.

### D2. Assemble the list deterministically at build time

The browser bundle must not enumerate the filesystem at runtime. A build-time loader discovers entry files, loads
their data, validates the aggregate and orders it by date descending before exposing it through the stable
`CHANGELOG` interface. The dev UI, binary UI and demo all consume this same loader.

The implementation should avoid a checked-in generated aggregate: that would recreate the shared-file edit on every
feature branch. Tests should exercise the same aggregation and validation logic as the build, and identify duplicate
ids even if a collision is introduced through file contents or filenames.

### D3. Preserve entry history

Move all current entries verbatim to individual files. Keep each entry's id and date, because browsers remember ids
and the list is historical. Do not rewrite old summaries as part of the migration.

### D4. Change the authoring instructions

`CONTRIBUTING.md` and `openspec/config.yaml` will direct contributors and planning agents to add a new entry file
under the entry directory. They will retain the current content rules: user-visible `feat` changes only, merge date,
immutable id, short title and one or two sentences in user-facing language.

## Risks and mitigations

- **Bundler/runtime mismatch:** a filesystem glob may work in Bun tests but fail in the browser bundle. Keep discovery
  in a build-time module and verify both normal and demo builds consume the same assembled list.
- **Accidental content changes during migration:** compare the assembled pre- and post-migration entry arrays by id,
  date, title and summary.
- **Nondeterministic same-day ordering:** explicitly sort with a stable secondary key and test it.
- **Invalid filenames or duplicate ids:** validate filename/id agreement and report the offending entry.

## Open questions

- Whether entry modules should export typed TypeScript objects or use a data-only format. Prefer the simplest format
  that the build-time loader can validate without adding runtime filesystem access or a dependency.
