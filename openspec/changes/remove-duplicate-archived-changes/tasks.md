# Tasks

## 1. Detection (server)

- [ ] 1.1 Add `DuplicateAfterArchive` (`archive`, `differing`, `differingCount`) as `duplicate?` on `ChangeSnapshot` in `src/shared/types.ts`; verify with `bun run typecheck`
- [ ] 1.2 Implement `findDuplicates` in `src/server/staleChanges.ts` on `baseRef` with `ls-tree`, `cat-file` (created date) and `diff --name-only` (cap 50), using the framework's changes layout and `newestArchive`; verify with `test/staleChanges.test.ts` against temp git repositories for the four detection scenarios and a failing git command
- [ ] 1.3 Call it from `src/server/scanner.ts` and attach the report to the archived change (or, when the main checkout has not pulled, to the change the board shows); verify with a scanner test that column, stage and counts are unchanged

## 2. Session (server)

- [ ] 2.1 Add the fixed `removeDuplicatePrompt` in `src/server/sessions/agents.ts` (change, archive directory, differing paths; confirm before carrying over; delete; commit, push, docs-only pull request), with the docs auto-merge archive instruction appended under the archive session's conditions; verify with prompt tests
- [ ] 2.2 Accept `removeDuplicate` in `SessionManager.open` (`src/server/sessions/manager.ts`) and `src/server/api.ts`: archive action only, duplicate from the last scan, refused while `chore/archive-<name>` exists or a worktree is on it or a session runs; verify with session tests for every refusal and the smuggled-field scenario

## 3. Board and detail (UI)

- [ ] 3.1 Add the duplicate reason to `staleReason`/`staleHint` in `src/ui/staleState.ts` (one badge, every reason) and the committed wording to `leftoverHint` in `src/ui/format.ts`; verify with `test/staleState.test.ts` and a format test
- [ ] 3.2 Show the duplicate notice with Remove duplicate, the not-offered reasons, the Pull hint and the by-hand text in `src/ui/changeDetail.tsx`; verify with `bun run check`
- [ ] 3.3 Add one duplicate to the demo data in `src/ui/demo/`; verify with the demo tests

## 4. Documentation

- [ ] 4.1 Add a What's new entry at the top of `src/ui/changelog.ts`: an archived change whose folder is still committed next to its archive is marked stale and offers Remove duplicate
