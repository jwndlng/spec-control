# Tasks

## 1. Bounded read (server)

- [x] 1.1 Add `readBounded` to `RepoSource` and `LocalRepoSource` as in design D1 (real-path containment, non-blocking no-follow open, `fstat` regular file, capped read, descriptor always closed) and remove `readText`; verify with unit tests in `test/scanner.test.ts` (or a new `test/source.test.ts`) against temporary directories holding a link to `/dev/zero`, a named pipe, a link out of the root, a file over the cap and an ordinary file
- [x] 1.2 Read `openspec/config.yaml`, `.openspec.yaml`, the tasks file and delta and main `spec.md` through it with the containment and limits of design D2 and D4; verify with `test/scanner.test.ts` and `test/specSync.test.ts`: a change whose `.openspec.yaml` links to `/dev/zero`, whose tasks file is a named pipe, or whose delta spec links outside the repository is reported with a warning while the repository scans `ok: true` within its timeout and its other changes are unaffected
- [x] 1.3 Read `prompt.md`, `depends-on.yaml` and `issue.yaml` only as regular files in place (design D3) through one helper, `prompt.md` truncated by reading only 8 KiB; verify with `test/scanner.test.ts`: `prompt.md -> /w/acme/elsewhere/hosts` gives no prompt text and a warning, and `snapshot.json` holds none of the target's text
- [x] 1.4 Read the artifact endpoint's file through `readBounded`; verify with `test/artifacts.test.ts` (existing scenarios unchanged, plus a named pipe answering `404`)

## 2. Schemas and tracked tasks (framework module)

- [x] 2.1 Accept a schema name only as a plain segment (design D5) in `marker.ts`/`index.ts`; verify with `test/frameworks.test.ts`: `schema: ..` and `schema: ../../x` give a warning and the unknown-schema fallback, and no file outside `openspec/schemas/` is opened
- [x] 2.2 Read a project-local `schema.yaml` with the bounded read and pass its text to `parseSchema` in `adapter.ts` (no `loadSchema`); contain `apply.tracks` in the change directory; verify with `test/frameworks.test.ts`: a local schema whose `apply.tracks` is `../../../outside.md` reports `tasks: null` with a warning, and a local `schema.yaml` linked to `/dev/zero` is refused with a warning
- [x] 2.3 Verify the compiled binary still reads the bundled and a project-local schema (`bun run build`, then scan a temporary repository with `dist/spec-control`)

## 3. Writes through real directories only (server)

- [x] 3.1 Add the segment check of design D6 and use it in `activeDir` (dismissal and `removeStaleChangeDirectory`), at preview and before `rm`; verify with `test/dismissChange.test.ts` and `test/staleCleanupApi.test.ts`: with `openspec/changes` (and separately `openspec`) a link to a directory outside the repository, dismissal and the stale directory removal are refused with `409` and the link's target is byte-for-byte unchanged
- [x] 3.2 Use the same check in `createChange` before `mkdir`; verify with `test/createChange.test.ts`: a linked `openspec/changes` gets `409` and nothing is created in its target
- [x] 3.3 In `applyTo`, refuse a linked or non-regular `openspec/config.yaml` and a linked `openspec/`, and write through a uniquely named, exclusively created temporary file that is removed on every failure (design D7); verify with `test/sharedConfig.test.ts`: the link and its target are unchanged after a refused apply, two concurrent applies to one repository leave one consistent file and no `*.tmp`, and a failing rename leaves no `*.tmp`

## 4. Documentation and verification

- [x] 4.1 Update invariant 1 in `CLAUDE.md` for the shared-config temporary file and the no-link rule of dismissal and create-change; verify by reading it against the dashboard-api delta
- [x] 4.2 Run `bun run check` and `bun run build`, and scan a temporary repository holding each hostile file from 1.1 with the compiled binary: memory stays flat and every poll completes
