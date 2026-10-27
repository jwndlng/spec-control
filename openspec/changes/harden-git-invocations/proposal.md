# Proposal

## Why

The git commands that write to a tracked repository were written for a repository whose project sits at the top level
and whose user has no git configuration of note. A review found that both assumptions break the guarantees of
invariant 1, and in two cases make the dashboard remove work it believes is merged:

- **A project in a subfolder sees every branch as merged.** `contentIsInBase` (`src/server/sessions/base.ts`) lists the
  files a branch changed with `git diff --name-only base...ref`, which prints paths relative to the repository's top
  level, and passes them back as pathspecs to `git diff --quiet base ref -- <files>`, which reads them relative to the
  working directory. Cleanup and stale detection call it with the project's folder (`cleanup.ts` `judgeBranch` and the
  deletion preview, `staleChanges.ts` `isMerged`). For `/w/acme/monorepo/packages/tools` a change to
  `packages/tools/src/a.ts` becomes the pathspec `packages/tools/packages/tools/src/a.ts`, nothing matches, the diff is
  empty, and the branch is "merged by content". Clean up then offers and runs `git branch -D` on unmerged work, a stale
  change's cleanup may `git worktree remove --force` and `git branch -D` it, and the deletion dialog says merged.
  Reproduced with a temporary repository.
- **The pull can stash.** `git merge --ff-only` obeys the user's `merge.autoStash=true`: with an overlapping local edit
  it stashes, fast-forwards, fails to re-apply, leaves `UU` conflict markers and a stash entry, and exits 0 — the pull
  reports "fast-forwarded". The spec says the pull never stashes and leaves the checkout unchanged when an uncommitted
  change would be overwritten. Reproduced.
- **Hooks run.** Only the pull's merge disables hooks (with `core.hooksPath=/dev/null`). The fetch shared by the pull
  and the per-minute automatic fetch, every `git branch -D`, the leftover `rm --cached` and restoring `add`, the
  create-change and dismissal `add`, and the worktree commands run the repository's hooks — a `reference-transaction`
  hook ran on both the fetch and `branch -D` in a repro. The repository-pull, automatic-fetch and repository-cleanup
  requirements say hooks never run.
- **The fetch can prune.** `fetch.prune`, `fetch.pruneTags` or `remote.<name>.prune` make the automatic fetch delete
  remote-tracking refs, which "fetch only" forbids. Reproduced.
- **Pull's leftover classification mixes path bases** (low). In a subfolder project `diff --name-only` and
  `status --porcelain` give top-level-relative paths, while `ls-tree`, `ls-files`, `hash-object --path` and
  `join(repoPath, …)` read them relative to the project: a leftover is never recognised there, and in a repository whose
  top level and subfolder hold the same relative path, Resolve and pull could judge and touch the wrong file.
- **Locks are per project, not per repository** (low). The pull/fetch lock (`pull.ts` `inFlight`) and the cleanup lock
  (`cleanup.ts` `running`) are keyed by project id. Two tracked
  projects in one git repository can fetch, fast-forward and clean up one checkout at the same time.

## What Changes

- **One way to run a writing git command.** Every git command the dashboard runs that writes to a tracked repository —
  the pull's and automatic fetch's `fetch`, `merge --ff-only`, leftover `rm --cached` and restoring `add`, the
  create-change and dismissal `add`, `branch -D`, and `worktree add`, `remove`, `unlock`, `prune` and `repair` — goes
  through one helper that points `core.hooksPath` at an empty folder under the dashboard home (the one the GitHub clone
  already uses) and turns off automatic maintenance. No hook of the repository, the user's global hooks folder or a
  template runs.
- **Flags that pin the effect.** The fast-forward runs `--no-autostash` with `submodule.recurse=false`; the fetch runs
  `--no-prune --no-prune-tags` (beside the existing `--no-recurse-submodules`). No user or repository setting can make
  either do more than the spec allows. These are options and `-c` settings of subcommands already in the list; no
  subcommand is added.
- **Merge checks address paths from the top level.** `contentIsInBase` lists changed paths with `--no-relative
  --no-renames` and compares them with `:(top,literal)` pathspecs and `--no-ext-diff --no-textconv`, so its answer is
  the same from any folder of the repository and whatever `diff.relative`, `diff.renames` or `diff.external` say.
- **Blocking files are classified from the top level.** Pull's blocking-file report reads and addresses every path
  relative to the repository's top level; a change leftover is a path under the project's own
  `openspec/changes/<name>/`; anything else, including paths outside the project, is local work.
- **Locks per git repository.** Pull, automatic fetch, Resolve and pull, cleanup, branch deletion and stale cleanup are
  serialised by the repository's git common directory (`rev-parse --git-common-dir`), so projects sharing one
  repository wait for, or are refused by, one another exactly as one project's actions are today.
- `CLAUDE.md` invariant 1 says every writing git command runs with hooks pointed at an empty folder.

## Non-goals

- **A compare-and-delete branch deletion.** `git branch -D` runs after a separate read of the branch's commit, so a
  branch that moves in between is deleted at its new commit. `git update-ref -d refs/heads/<name> <commit>` would close
  that window, but it is a new subcommand outside invariant 1's list and leaves the branch's config section behind. The
  window is milliseconds on a ref that only the user's own tools move; accepted, unchanged here.
- Settings that are the user's own tooling rather than the repository's effect (`core.fsmonitor`, credential helpers,
  `core.sshCommand`) and remote refspecs a user configured to write local branches.
- `shipsOnlyOpenSpec` in a subfolder project: it compares top-level-relative paths with `openspec/` and fails closed (no
  auto-merge instruction), which is safe; making docs auto-merge work there is a separate change.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `dashboard-api`: writing git commands run no hooks and only with options that pin their effect.
- `repository-pull`: no autostash, no prune, no hooks for fetch and Resolve; blocking files classified from the top level;
  one pull or fetch per git repository.
- `repository-cleanup`: merge checks from a project in a subfolder; hooks never run (scenario added to "Cleanup never
  touches more than it lists"); one cleanup or deletion per git repository.
- `stale-changes`: a leftover's merge check from a project in a subfolder.

## Order and overlaps

- No change on `origin/main` lists these files under Impact. Proposals written at the same time from the same review
  (for example `apply-what-was-previewed`) may touch `src/server/cleanup.ts` and `src/server/staleChanges.ts`; whichever
  is implemented second rebases onto the other. This change only alters how git is invoked and how locks are keyed, not
  what is previewed or confirmed.

## Impact

- `src/server/gitWrite.ts` (new): the writing-git helper and the empty hooks folder, moved from
  `src/server/githubClone.ts` (`emptyHooksDir`), which then imports it.
- `src/server/pull.ts`: fetch and merge flags, the helper for `fetch`, `merge`, `rm --cached` and `add`, top-level paths
  in `blockingReport` and `resolvePull`, the lock keyed by git common directory.
- `src/server/sessions/base.ts`: `contentIsInBase` pathspecs and flags.
- `src/server/cleanup.ts`: the helper for `worktree remove`/`unlock`/`prune` and `branch -D`, the lock keyed by git
  common directory.
- `src/server/staleChanges.ts`: unchanged logic; its `isMerged` is fixed through `base.ts` (verified by tests).
- `src/server/sessions/worktree.ts`: the helper for `worktree add`/`remove`/`prune`/`unlock`/`repair` (the home
  migration's repair goes through it).
- `src/server/createChange.ts`, `src/server/dismissChange.ts`: the helper for their `git add`.
- `src/server/githubClone.ts`: imports the moved hooks folder helper; behaviour unchanged.
- `CLAUDE.md`: invariant 1 wording.
- Tests: `test/pull.test.ts`, `test/autoFetch.test.ts`, `test/pullResolve.test.ts`, `test/cleanup.test.ts`,
  `test/deleteBranch.test.ts`, `test/staleChanges.test.ts`, `test/workStatus.test.ts`, `test/createChange.test.ts`,
  `test/dismissChange.test.ts`, `test/worktree.test.ts`, `test/homeMigration.test.ts`, and a new
  `test/gitWrite.test.ts`.
