# Design

## Context

`RepoSource.readText` is a plain `readFile` that follows links and reads to the end. The artifact endpoint
(`readArtifactFile`) is the one reader that already checks containment, regular file and size, but it does so with
`stat` before a separate `readFile`, and even that reader would block on a named pipe that appears between the two
calls. `issue.yaml` has its own in-place check in `scanner.ts`. Every other read trusts the path. On the write side,
`activeDir` and `createChange` check only the last path segment, and `writeAtomic` in `sharedConfig.ts` follows a link
when it stats and replaces it when it renames.

## Decisions

### D1. One bounded read on `RepoSource`, and no unbounded one

`readBounded(absPath, { within, maxBytes, truncate? })` returns `{ text, truncated }` or a reason (`missing`,
`outside`, `not-a-file`, `too-large`, `unreadable`). It:

1. resolves `absPath` with `realpath` and requires the result to be `within`'s real path or below it;
2. opens the real path with `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`, so a named pipe opens at once instead of waiting for a
   writer and a final link swapped in after step 1 fails to open;
3. requires `fstat` on that descriptor to report a regular file — a pipe, socket or device (`/dev/zero`) is refused
   before a byte is read;
4. refuses a file larger than `maxBytes`, or with `truncate`, reads at most `maxBytes`;
5. reads from the descriptor — never more than `maxBytes + 1` bytes, so a file that grows meanwhile still cannot exceed
   the cap — and closes it in every case.

`readText` is removed from the interface, so a new caller cannot fall back to it. Rejected: keeping `readText` and adding
checks at each call site — that is how `prompt.md` ended up without the check `issue.yaml` has. Rejected: relying on the
repository scan timeout — it abandons the promise but cannot stop a read, so memory and the descriptor stay taken.

### D2. What a read must stay within

- Files of a change (`.openspec.yaml`, its tasks file, delta `spec.md`, schema outputs): within the change directory.
- `openspec/config.yaml`, main `openspec/specs/<capability>/spec.md` and a project-local schema: within the checkout
  being read (the main checkout or the linked worktree).

A link from one file of a change to another file of the same change keeps working, as it does for the artifact
endpoint ("A path whose resolved target lies outside the change directory MUST be refused as if it did not exist").

### D3. The dashboard's own files only in place

`prompt.md`, `depends-on.yaml` and `issue.yaml` are conventions of this dashboard, written by Create change as regular
files. They count only when `lstat` shows a regular file directly in the change directory; a link is ignored with a
warning, as `issue.yaml` is today. The three share one helper instead of three copies of the check.

### D4. Size limits

The existing limits stay: `prompt.md` 8 KiB (truncated, with the existing warning, reading only 8 KiB),
`depends-on.yaml` 16 KiB and `issue.yaml` 16 KiB (refused when larger). Every other file — `config.yaml`,
`.openspec.yaml`, tasks file, `spec.md`, `schema.yaml` — is refused above 1 MiB, the artifact endpoint's
`MAX_ARTIFACT_BYTES`, and the change (or, for `config.yaml`, the repository) carries a warning naming the file and the
limit. A refused `.openspec.yaml` leaves the change readable without its marker values (schema from the project, no
created date), as an unreadable marker does today; a refused tasks file reports `tasks: null` with a warning rather than
the absence of a tasks file.

### D5. Schema names and `apply.tracks`

A schema name from `.openspec.yaml` or `config.yaml` is used only when it matches `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` and is
not `.` or `..` — that is, a single plain path segment; otherwise the change carries a warning and falls back as for an
unknown schema. The adapter no longer calls the library's `loadSchema` (a plain `readFileSync`): the framework module
reads `openspec/schemas/<name>/schema.yaml` with the bounded read and hands the text to `parseSchema`, which is pure.
`apply.tracks` is joined to the change directory and the bounded read with `within` = the change directory decides; a
path outside is a warning and `tasks: null`. Invariant 3 is unaffected: the library is still only reached through the
adapter.

### D6. Writes and deletes reach their target through real directories only

A helper `realDirectoriesBelow(root, relDir)` `lstat`s each segment from the repository folder down to the target's
parent (`openspec`, `openspec/changes`, and for dismissal the change directory itself) and fails unless every one is a
directory and none is a link. The repository folder itself may be reached through a link (the user's own configuration,
`/tmp` on macOS), so the check starts below it. It runs in:

- `activeDir` — dismissal and `removeStaleChangeDirectory` — at preview and again immediately before `rm`, `409` with the
  segment named;
- `createChange` before the exclusive `mkdir`, `409` with the segment named;
- `applyTo` before the temporary file is created, a `refused` result with the segment named.

Rejected: comparing `realpath(dir)` with `realpath(repo.path) + relDir` alone. It is equivalent for the target but says
less about which segment is wrong, and the per-segment `lstat` is what the "never a symbolic link's target" wording
asks for.

### D7. Shared-config apply: refuse a link, unique temporary file, always cleaned up

`applyTo` refuses when `openspec/config.yaml` is a link (or anything but a regular file per `lstat`) — following it
would write outside the enumerated path, and replacing it would destroy the user's link. The temporary file is created
with an exclusive create (`wx`) as `openspec/.config.yaml.<random>.tmp`, so two concurrent applies never share one, and
is removed whenever the rename did not happen. It is the only file besides `config.yaml` that apply ever creates, and
dashboard-api's enumeration names it. A leftover from a killed process is not cleaned up by later applies: the dashboard
deletes nothing it did not create in this run.

Rejected: writing through the link — the target may be outside the repository. Rejected: an in-place truncate and
write — a crash would leave a half-written config, which the rename avoids.
