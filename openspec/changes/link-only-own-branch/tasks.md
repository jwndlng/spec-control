# Tasks

## 1. Scanner

- [x] 1.1 Add a read-only query to `RepoSource` for the change directories touched since `HEAD` forked from a base (`diff --name-only -z --no-relative --no-renames <base>...HEAD -- <changes dir>`), returning the change names, `undefined` on failure; verify with a `test/worktreeScan.test.ts` case against a temp git repository
- [x] 1.2 In `scanWorktree`, give a copy `branchMatch` of the worktree's branch only when it is a branch candidate or the worktree holds work on it (dirty files in its directory, or a touched directory from 1.1 against `baseRef`), else `findBranchMatch` across all checkouts; verify with `test/worktreeScan.test.ts` for the scenarios of the modified "Branch and worktree matching" (the reproduction with an unpulled main checkout, uncommitted work, committed work, a carried copy with the change's own worktree elsewhere, `wip/compliance`)
- [x] 1.3 In `mergeChanges`, keep the leading copy's `branchMatch` instead of the checkout branch; verify with `test/mergeChanges.test.ts` (a lead in a worktree without a match has no `branchMatch`)

## 2. Link and actions

- [x] 2.1 Verify the pull-requests scenarios with `test/pullRequestLink.test.ts` (the merged `#10` is linked, not `#20`) and `test/conflictActionState.test.ts` (no Resolve conflicts for the carried change)

## 3. Wrap-up

- [x] 3.1 Add a What's new entry at the top of `src/ui/changelog.ts`; verify with `bun run check`
- [~] 3.2 Run `bun run check` and `bun run build`, and verify in `dist/spec-control` against a scratch repository like the reproduction that the carried change shows its own pull request — done here: `bun run build`; in `dist/spec-control` a scratch reproduction (unpulled main checkout, `feat/add-login` worktree from `origin/main`) gives the carried `rotate-keys` no `branchMatch`, and `feat/add-login` once that worktree has uncommitted edits to it; `bun run check` passes lint and typecheck, and its only failures (`scanner.test.ts` timeouts, one `githubApi.test.ts` call count) fail identically on unmodified `origin/main` on this loaded machine. **You check:** in a repository on GitHub with a merged pull request for change A on `feat/A` and a worktree for change B cut from a newer `origin/main` than the main checkout, with B's pull request open, that A's card links A's merged pull request (not B's) and offers no Resolve conflicts, and that CI's `bun run check` is green
