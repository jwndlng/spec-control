# Tasks

## 1. Activity events

- [x] 1.1 Key active changes by name and archives by name and archive date in `diffSnapshots`; record a new archive whose name had an active change that is now gone as archived from that change's column, without a removed event; verify with `test/activityEvents.test.ts` for "An active change beside an old archive of its name", "A reused name is archived again" and "A reused name is created", plus the existing created/archived/removed scenarios
- [x] 1.2 Skip a change whose leading checkout in one snapshot is listed as unread in the other; verify with `test/activityEvents.test.ts` for the three scenarios of "A worktree left unread is not activity" and for a previous snapshot without `unreadWorktrees`

## 2. Scanner

- [x] 2.1 Add the optional `unreadWorktrees` to `RepoSnapshot` and fill it in `scanWorktrees` with the paths left out by `WORKTREE_LIMIT` and those whose read failed or timed out; verify with `test/worktreeScan.test.ts` for "More worktrees than the cap", "One worktree fails" and "Every worktree read"

## 3. Dependencies

- [x] 3.1 Decide `met` in `resolveDependencies` from the active change of the name when there is one (Done in the main checkout, or an archive dated on or after its creation); verify with `test/dependencies.test.ts` for "A reused name is not met by its old archive", "A reused name is met once it is done" and the existing scenarios

## 4. Wrap-up

- [x] 4.1 Add a What's new entry at the top of `src/ui/changelog.ts`; verify with `bun run check`
- [x] 4.2 Run `bun run check` and `bun run build`, and verify in `dist/spec-control` against a scratch repository with an archive and an active change of the same name that repeated scans record no event for it
