# Proposal

## Why

A new change's name is checked only against the character set `^[A-Za-z0-9._-]+$` (`CHANGE_NAME_PATTERN` in
`src/shared/types.ts`, `CHANGE_NAME` in `src/server/source.ts`), in the New change form, in Import from issues and in
`createChange`. Several names pass that the rest of the dashboard cannot handle:

- **`archive`** is accepted. With no change archived yet, Create change makes `openspec/changes/archive/` with
  `.openspec.yaml` and `prompt.md`, stages it and reports success — and the next scan shows nothing, because that
  directory is the archive root. Dismissal refuses `archive` (`isDismissableName`), so the board offers no way to remove
  it, and the next real `openspec archive` puts its first archive next to those files. Import from issues proposes
  exactly this name for an issue titled "Archive". On a case-insensitive file system (macOS by default) `Archive` and
  `ARCHIVE` are the same directory.
- **`.` and `..`** reach `mkdir` and fail with `EEXIST`, reported as "a change named "." already exists".
- **Names starting with `.`** — `.git` creates a directory git refuses to stage, and `.hidden` is a name the session
  branch `feat/.hidden` cannot have, so Draft fails later in `git worktree add`.
- **Names git cannot use as a branch component** — containing `..`, ending in `.` or `.lock` — are created fine and then
  fail at the first session for the same reason.
- **Names starting with `-`** are protected from git: every git call the dashboard makes puts a change name behind a
  prefix (`feat/`, `chore/archive-`, `openspec/changes/`) and after `--` where it is a path. But the name is also typed
  into agents' prompts (`openspec archive <name>`, `/opsx:apply <name>`), where a leading `-` reads as an option.

Meanwhile three places carry their own copy of a stricter rule: `isDismissableName` in `src/server/dismissChange.ts`,
`isChangeLeftoverPath` in `src/server/pull.ts`, and the archive-root skip in `LocalRepoSource.listChanges`.

## What Changes

- **One shared module, `src/shared/changeNames.ts`, with two rules.**
  - `isNewChangeName(name)` — what the dashboard may create: the character set, plus not starting with `.` or `-`, not
    containing `..`, not ending in `.` or `.lock`, at most 128 characters, and not `archive` in any letter case.
    `newChangeNameProblem(name)` returns the reason as text, or null.
  - `isChangeDirName(name)` — what may name an existing change directory the dashboard acts on: the character set, not
    `.` or `..`, and not `archive` in any letter case. It replaces `isDismissableName` and the inline check in `pull.ts`.
- **Every place a new name is decided uses `isNewChangeName`**: the New change form (one project and by label), the
  Import from issues name check, `createChange` (and so `POST /api/repos/<id>/changes`) and `stageChangeDir`. The form
  and the dialog show the reason next to the field; the server answers `400` with it.
- **Import from issues never proposes a reserved name.** When the title yields one, the suggestion becomes
  `<name>-<number>` (`archive-12`). Titles never yield a leading `.` or `-` or a `..`, so `archive` is the one case.
- **Existing directories are unaffected.** The scanner keeps showing every directory that matches the character set,
  and sessions, dismissal and cleanup keep working on them; only creating such a name is refused.

## Non-goals

- Renaming or migrating an existing `openspec/changes/archive/.openspec.yaml` created before this change: the user removes
  it by hand; the board already shows nothing for it.
- Refusing sessions for existing changes whose names git cannot use as a branch: they fail at `git worktree add` as today.
- Reserving names other frameworks might need: only the OpenSpec layout exists.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `change-creation`: the live validation names the new rule; a refusal requirement for reserved and unusable names.
- `issue-import`: the suggested name avoids a reserved name; validation follows the form.
- `dashboard-api`: the create-change endpoint's name rule.

## Order and overlaps

- `contain-repository-reads` changes the directory checks in `src/server/createChange.ts` and `src/server/dismissChange.ts`;
  this change touches the name checks in the same files. No requirement is shared; whichever lands second rebases.

## Impact

- `src/shared/changeNames.ts` (new): `isNewChangeName`, `newChangeNameProblem`, `isChangeDirName`.
- `src/shared/issues.ts`: `issueChangeName` avoids a reserved name.
- `src/ui/newChangeForm.tsx`, `src/ui/importIssuesState.ts`: the reason from `newChangeNameProblem`.
- `src/server/createChange.ts`: `createChange` and `stageChangeDir` use `isNewChangeName`; the `400` message names the
  reason.
- `src/server/dismissChange.ts`, `src/server/api.ts`, `src/server/pull.ts`: `isChangeDirName` in place of
  `isDismissableName` and the inline check.
- `src/ui/helpContent.tsx`: the naming rule where Help describes New change.
- Tests: `test/changeNames.test.ts` (new), `test/createChange.test.ts`, `test/createChangeApi.test.ts`,
  `test/importIssuesState.test.ts`, `test/sharedIssues.test.ts`, `test/newChangeByLabel.test.ts`,
  `test/dismissChange.test.ts`, `test/pullResolve.test.ts`.
- No new dependency, no network, no change to what is written to a repository.
