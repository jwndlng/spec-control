# Tasks

## 1. Independent entry sources

- [x] 1.1 Define a typed entry-file format and a build-time loader that discovers entry files, checks filename/id
  agreement, validates entry fields and returns a deterministically ordered list; keep filesystem access out of the
  browser runtime.
- [x] 1.2 Move every existing entry out of `src/ui/changelog.ts` into its own id-named file, preserving ids, dates,
  titles, summaries and displayed order; retain `CHANGELOG` as the stable interface consumed by the UI.
- [x] 1.3 Update `scripts/build-ui.ts` and the development, compiled-binary and demo paths to consume the same
  assembled list without a checked-in generated aggregate.

## 2. Validation and authoring workflow

- [x] 2.1 Update `test/whatsNew.test.ts` to test aggregation, deterministic same-day sorting, filename/id agreement,
  duplicate detection and existing entry validity using the same loader and validation logic as the build.
- [x] 2.2 Update `CONTRIBUTING.md` and `openspec/config.yaml` to instruct contributors and agents to add an independent
  entry file and preserve the current user-facing copy and date conventions.
- [x] 2.3 Update `openspec/specs/whats-new/spec.md` from this change's delta when the implementation is complete.

## 3. Verification

- [~] 3.1 Run `bun run check` on a machine where tests can bind local sockets and spawn `ps`; the changelog tests and
  typecheck pass, but this environment's full run had 93 unrelated socket/process permission failures.
- [x] 3.2 Build the regular UI and demo; confirmed both bundles embed all 71 entries. The list is injected as static
  data at build time, with no changelog filesystem or network access at runtime.
