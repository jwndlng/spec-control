# Tasks

## 1. Writing git commands (server)

- [ ] 1.1 Add `src/server/gitWrite.ts` with `gitWrite` and `emptyHooksDir` (moved from `src/server/githubClone.ts`, same folder), as in design D1; verify with `test/gitWrite.test.ts`: a temp repository with executable `reference-transaction`, `post-index-change`, `post-checkout` and `post-merge` hooks and a global `core.hooksPath` holding the same, a `gitWrite` of `branch -D`, `add`, `worktree add` and `worktree remove` leaves the hook log empty
- [ ] 1.2 Route every writing command through `gitWrite`: `fetch`, `merge`, `rm --cached` and `add` in `src/server/pull.ts`; `branch -D`, `worktree remove`/`unlock`/`prune` in `src/server/cleanup.ts`; `worktree add`/`remove`/`unlock`/`prune`/`repair` in `src/server/sessions/worktree.ts`; `add` in `src/server/createChange.ts` and `src/server/dismissChange.ts`; verify with a source-scan test in `test/gitWrite.test.ts` that no writing subcommand is spawned elsewhere, and with hook-log scenarios in `test/pull.test.ts`, `test/autoFetch.test.ts`, `test/cleanup.test.ts`, `test/deleteBranch.test.ts`, `test/staleChanges.test.ts`, `test/createChange.test.ts`, `test/dismissChange.test.ts`, `test/worktree.test.ts` and `test/homeMigration.test.ts`
- [ ] 1.3 Add `--no-autostash` and `-c submodule.recurse=false` to both fast-forwards and `--no-prune --no-prune-tags` to the fetch (design D2); verify with `test/pull.test.ts` (`merge.autoStash=true` and an overlapping edit: refused, edit and index unchanged, `git stash list` empty) and `test/autoFetch.test.ts` (`fetch.prune=true` and `remote.origin.prune=true`: a remote-tracking ref of a deleted remote branch survives the automatic fetch and the pull)

## 2. Paths from a project in a subfolder (server)

- [ ] 2.1 Rewrite `contentIsInBase` with `--no-relative --no-renames`, `:(top,literal)` pathspecs, `--no-ext-diff --no-textconv` (design D3); verify with `test/workStatus.test.ts` for a project at `packages/tools`: an unmerged branch is not in base, a squash-merged one is, a rename whose source the base still holds is not, and `diff.relative=true` changes nothing
- [ ] 2.2 Verify cleanup and stale detection through it: `test/cleanup.test.ts` keeps an unmerged branch of a subfolder project with "commit(s) not in" and deletes nothing on a crafted confirmation; `test/deleteBranch.test.ts` previews it as not merged; `test/staleChanges.test.ts` reports its worktree and branch as kept and a stale cleanup confirmation removes neither
- [ ] 2.3 Read blocking files from the top level in `blockingReport` and `resolvePull` (design D4); verify with `test/pullResolve.test.ts` for a project at `packages/tools`: a staged leftover under `packages/tools/openspec/changes/add-login/` is offered and resolved, and a top-level `openspec/changes/add-login/prompt.md` blocking in the same repository is local work and is never copied, removed or restaged

## 3. Locks per git repository (server)

- [ ] 3.1 Key the pull/fetch lock and the cleanup lock by the realpath of the git common directory (design D5); verify with `test/pull.test.ts` (a pull of `packages/a` while one of `packages/b` in the same repository runs is refused as already pulling; an automatic fetch of `b` during a pull of `a` is skipped) and `test/cleanup.test.ts` (a cleanup of `b` while one of `a` runs is refused as busy)

## 4. Documentation and verification

- [ ] 4.1 Update invariant 1 in `CLAUDE.md` (every writing git command runs with hooks pointed at an empty folder; pull `--no-autostash`, fetch `--no-prune`); verify by reading it against the delta specs
- [ ] 4.2 Run `bun run check` and `bun run build`, and run a pull and a cleanup against a temp repository from `dist/spec-control` to verify the hooks folder is created and used in the compiled binary
