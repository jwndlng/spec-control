# Proposal

## Why

A tracked repository is untrusted input: anyone can commit a symbolic link, and **Add from GitHub** clones a stranger's
repository with two clicks. Several places read or write through such links as if they were ordinary files:

- **The scanner reads without a limit and without containment.** `openspec/config.yaml`, every change's
  `.openspec.yaml`, its tasks file, `prompt.md`, `depends-on.yaml` and the delta and main `spec.md` files are read with a
  plain `readFile` (`LocalRepoSource.readText`), following links, with no regular-file check and no size cap. A committed
  `.openspec.yaml -> /dev/zero` took a scan to 4.3 GB of memory in half a second, and the repository's scan timeout cannot
  stop a read in progress. A named pipe in its place, or a link to one, makes the scan wait forever and leaks a file
  descriptor on every poll. One bad file should fail at most its own change, bounded in size (change-scanner,
  change-dependencies); today it can take the whole dashboard down.
- **`prompt.md` and `depends-on.yaml` follow links out of the repository.** Only `isFile` is checked on the resolved path,
  so `prompt.md -> /etc/hosts` came back as the change's prompt, and from there into `snapshot.json` and the UI.
  `issue.yaml` already refuses anything but a regular file in place; its two siblings do not.
- **The schema can point reads elsewhere.** `schema: ..` in `.openspec.yaml` or `openspec/config.yaml` passes the marker's
  name pattern and makes the adapter load `openspec/schemas/../schema.yaml`; `schema: ../../..` leaves the repository.
  A project-local schema's `apply.tracks` is joined to the change directory unchecked, so `../../../x` counts the
  checkboxes of any file. Only checkbox counts leak, but the read is still unbounded (the library's `loadSchema` is a
  plain `readFileSync`).
- **Dismissal can delete outside the repository.** `activeDir` (`src/server/dismissChange.ts`, also behind
  `removeStaleChangeDirectory`) checks with `lstat` only that the change directory itself is not a link. When
  `openspec/` or `openspec/changes/` is a link, the real-path comparison of the directory with its parent still passes,
  and `rm -r` deletes the change in the link's target — a folder outside the repository. dashboard-api allows deleting
  "never a symbolic link's target".
- **Applying shared config replaces a link and leaves temporary files.** `applyTo` stats through a linked
  `openspec/config.yaml`, writes `config.yaml.<pid>.tmp` beside it and renames that over the link, so the link becomes a
  regular file (and, with a linked `openspec/`, the write lands outside the repository). The temporary name is the same
  for two concurrent applies, and it is left in `openspec/` — a path invariant 1 does not enumerate — when the process
  dies between write and rename.
- **Create change writes through a linked changes directory.** The same `stat` that dismissal lacks lets
  `createChange` make `openspec/changes/<name>/` inside the target of a linked `openspec/` or `openspec/changes/`.
  Found while confirming the dismissal finding; it is the same rule, so it is fixed here.

## What Changes

- **One bounded read for every repository file the scanner reads.** `RepoSource` gains `readBounded(absPath, { within,
  maxBytes })`: resolve the path, require the real path inside `within` (the checkout, or the change directory), open it
  non-blocking and without following a final link, require a regular file from `fstat` on that descriptor, refuse it when
  it is larger than `maxBytes` (or, where truncation is the rule, read only that many bytes), then read from the
  descriptor and close it. `readText` is removed, so nothing can read a repository file the unbounded way again.
- **Every scanner read goes through it**: `openspec/config.yaml` (also for carried shared-config profiles), each
  change's `.openspec.yaml`, its tasks file, `prompt.md`, `depends-on.yaml`, `issue.yaml`, delta and main `spec.md`, a
  project-local `schema.yaml`, and the artifact endpoint's file read. A refused read is a warning on the change (or the
  repository, for `config.yaml`), never a failed scan.
- **The dashboard's own files are read only in place.** `prompt.md`, `depends-on.yaml` and `issue.yaml` count only as a
  regular file directly in the change directory, not a link — the rule `issue.yaml` has today.
- **Schema names and tracked task files stay inside.** A schema name is used only when it is a plain name (no `.`/`..`,
  no separator); a project-local schema is read from `openspec/schemas/<name>/schema.yaml` with the bounded read; a
  tasks file that resolves outside the change directory is not read and the change says why.
- **Deletion and writes reach only real directories.** Dismissal, the stale change directory's removal, Create change and
  shared-config apply require every directory between the repository folder and their target to be a real directory, not
  a link (checked with `lstat`, segment by segment, and re-checked immediately before the write or delete).
- **Shared-config apply refuses a linked `config.yaml`** and writes through a temporary file with a unique, exclusively
  created name in `openspec/`, removed on every failure; the dashboard-api enumeration names that temporary file.

## Non-goals

- Links inside a change that point to other files inside the same change, or delta specs linked within the checkout:
  still read, as today.
- Defending against a local user who swaps files while the dashboard runs: the checks narrow the window to the moment
  between `lstat` and the operation and use descriptors where the platform offers them, nothing more.
- Linked worktrees: only the main checkout is ever written or deleted in; worktree reads use the same bounded read.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `change-scanner`: bounded, contained reads for every repository file; schema names and tracked task files stay inside.
- `change-dismissal`: no symbolic link anywhere on the path to the deleted directory.
- `stale-changes`: the same for the stale change directory's removal.
- `shared-config`: apply refuses a linked `config.yaml` or `openspec/` and leaves no temporary file.
- `dashboard-api`: the never-writes enumeration names the temporary file of (1) and refuses links for (1), (4) and (7).

## Order and overlaps

- `reserve-change-names` changes `src/server/createChange.ts` (name check) and `src/server/dismissChange.ts`
  (`isDismissableName` moves to `src/shared/`). This change touches the directory checks in the same two files; whichever
  lands second rebases, no requirement is shared.
- `manual-tasks-need-you` touches `src/server/scanner.ts` and the change-scanner requirement on task progress; this change
  adds requirements only and changes how the scanner reads, not how it counts.

## Impact

- `src/server/source.ts`: `readBounded` on `RepoSource` and `LocalRepoSource` (non-blocking, no-follow open, `fstat`,
  capped read); `readText` removed; a helper that `lstat`s each segment below a root.
- `src/server/scanner.ts`: tasks, `prompt.md`, `depends-on.yaml`, `issue.yaml` and the carried shared-config read through
  `readBounded`; the in-place rule for the three convention files.
- `src/server/frameworks/openspec/index.ts`, `specSync.ts`, `marker.ts`: `config.yaml`, `.openspec.yaml` and `spec.md`
  through `readBounded`; the plain schema-name rule.
- `src/server/frameworks/openspec/adapter.ts`: the local schema read as text through the bounded read and passed to
  `parseSchema` (no `loadSchema`), `apply.tracks` contained in the change directory.
- `src/server/frameworks/framework.ts`: the contract's signatures if the schema text is passed in.
- `src/server/artifacts.ts`: the file read through `readBounded`.
- `src/server/dismissChange.ts`: `activeDir` checks every segment.
- `src/server/createChange.ts`: the same check for `openspec/` and `openspec/changes/` before `mkdir`.
- `src/server/sharedConfig.ts`: refuse a linked target, unique exclusive temporary file, cleanup.
- `CLAUDE.md`: invariant 1's wording for the shared-config entry (its temporary file) and for dismissal and create-change
  (no linked directory on the way).
- Tests: `test/scanner.test.ts`, `test/specSync.test.ts`, `test/frameworks.test.ts`, `test/artifacts.test.ts`,
  `test/dismissChange.test.ts`, `test/staleCleanupApi.test.ts`, `test/createChange.test.ts`, `test/sharedConfig.test.ts`.
  Links, named pipes and `/dev/zero` targets are made in temporary directories by the tests, never committed under
  `test/fixtures/`.
- No new dependency, no network, no new git subcommand.
