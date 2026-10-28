# Design

## Context

`CHANGE_NAME_PATTERN` is one regular expression used for two different questions: "may this string reach the file system
or git safely" (scanner, sessions, artifacts, dependencies) and "may the dashboard create a change of this name"
(form, import, `createChange`). The first question is about safety and must keep accepting every directory a repository
already has; the second is about producing a change the rest of the dashboard, git and OpenSpec can work with. Three
modules already patched the gap for their own case.

## Decisions

### D1. Two named rules in one shared module

`src/shared/changeNames.ts` exports:

- `isChangeDirName(name)`: `CHANGE_NAME_PATTERN`, not `.` or `..`, not `archive` ignoring case. For actions on an existing
  directory: dismissal, stale cleanup, pull leftovers.
- `isNewChangeName(name)` / `newChangeNameProblem(name)`: `isChangeDirName`, plus not starting with `.` or `-`, no `..`,
  not ending in `.` or `.lock`, at most 128 characters.

`CHANGE_NAME_PATTERN` stays for reading. Rejected: tightening `CHANGE_NAME` itself — existing changes named `.draft` or
`-wip` would vanish from boards with a warning, and their sessions, dismissal and cleanup would stop working. Rejected:
one rule for both — dismissing an existing `.draft` change must stay possible.

### D2. What the new-name rule refuses, and why

- `archive` (any case): the archive root; on a case-insensitive file system `Archive` is the same directory.
- leading `.`: `.`/`..`, hidden directories, `.git`; and `feat/.x` is not a valid ref.
- leading `-`: the name is typed into agents' commands (`openspec archive <name>`), where it reads as an option. Git is
  already safe: every call puts the name behind a prefix or after `--`.
- `..`, trailing `.`, trailing `.lock`: `git check-ref-format` rejects `feat/<name>` for each, so the first session would
  fail in `git worktree add`.
- more than 128 characters: keeps worktree paths and branch names well inside file-system limits; issue names are
  already cut at 48.

The reason text names the specific rule ("`archive` is reserved for archived changes", "must not start with `.` or `-`",
…), so the form says what to change.

### D3. The issue suggestion steps around a reserved name

`issueChangeName` already produces only `a-z`, `0-9` and inner `-`, so `archive` is the one reserved result. It then
returns `archive-<number>`, which is unique per issue and keeps the title's word. The dialog's live check still runs
`newChangeNameProblem` on whatever the user types.

### D4. The server stays the authority

`createChange` checks `isNewChangeName` before anything else and answers `400` with the reason; the existing "no
directory, file, git command" guarantee for a refusal covers it. `stageChangeDir` checks the same rule so it can never
stage the archive root.
